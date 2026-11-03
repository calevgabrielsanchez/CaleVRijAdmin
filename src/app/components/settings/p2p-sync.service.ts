import { Injectable, signal } from '@angular/core';
import { ProjectDirectoryHandle, ProjectFileHandle } from '../view-content.component/project-library-manager.component';

export type P2PState =
  | 'idle'
  | 'creating-invitation'
  | 'waiting-answer'
  | 'waiting-connection'
  | 'connected'
  | 'syncing'
  | 'completed'
  | 'error';

interface SyncFileMeta {
  path: string;
  size: number;
  lastModified: number;
}

interface SyncMetadataEntry {
  lastModified: number;
  receivedAt: number;
}

interface SignalPayload {
  type: 'offer' | 'answer';
  sdp: RTCSessionDescriptionInit;
}

type WritableFile = Awaited<ReturnType<ProjectFileHandle['createWritable']>>;

@Injectable({ providedIn: 'root' })
export class P2PSyncService {
  readonly state = signal<P2PState>('idle');
  readonly message = signal('');
  readonly connected = signal(false);
  readonly syncing = signal(false);
  readonly invitationCode = signal('');
  readonly answerCode = signal('');
  readonly log = signal<string[]>([]);
  readonly peerId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private root: ProjectDirectoryHandle | null = null;
  private remotePeerId = '';
  private remoteFiles: SyncFileMeta[] | null = null;
  private localFiles: SyncFileMeta[] = [];
  private localMeta = new Map<string, SyncFileMeta>();
  private incomingManifest: SyncFileMeta[] | null = null;
  private localReady = false;
  private planStarted = false;
  private incoming: {
    path: string;
    name: string;
    directory: ProjectDirectoryHandle;
    size: number;
    sourceLastModified: number;
    received: number;
    writer: WritableFile;
  } | null = null;
  private metadata = new Map<string, SyncMetadataEntry>();
  private metadataSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private messageQueue: Promise<void> = Promise.resolve();
  private sendQueue: Promise<void> = Promise.resolve();
  private readonly queuedSends = new Set<string>();
  private readonly requestedPaths = new Set<string>();
  private readonly sentPaths = new Set<string>();
  private pendingSends = 0;
  private sentCount = 0;
  private receivedCount = 0;
  private idleSent = false;
  private remoteIdle = false;
  private disposed = false;
  private readonly metadataFileName = '.calevri-sync.json';

  async createInvitation(root: ProjectDirectoryHandle): Promise<void> {
    this.closeConnection();
    this.root = root;
    this.resetSyncState();
    this.state.set('creating-invitation');
    this.message.set('Creando la invitación P2P…');
    this.invitationCode.set('');
    this.answerCode.set('');
    try {
      const pc = this.createPeerConnection();
      const channel = pc.createDataChannel('calevri-sync', { ordered: true });
      this.configureChannel(channel);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.waitForIce(pc);
      this.invitationCode.set(this.encode({ type: 'offer', sdp: pc.localDescription }));
      this.state.set('waiting-answer');
      this.message.set('Comparte el código de invitación con el otro dispositivo.');
      this.addLog('Invitación creada.');
    } catch (error) {
      this.fail(error);
    }
  }

  async acceptInvitation(root: ProjectDirectoryHandle, code: string): Promise<void> {
    this.closeConnection();
    this.root = root;
    this.resetSyncState();
    this.state.set('waiting-connection');
    this.message.set('Procesando la invitación…');
    this.invitationCode.set('');
    this.answerCode.set('');
    try {
      const payload = this.decode<SignalPayload>(code);
      if (payload.type !== 'offer' || !payload.sdp) throw new Error('El código no es una invitación válida.');
      const pc = this.createPeerConnection();
      await pc.setRemoteDescription(payload.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.waitForIce(pc);
      this.answerCode.set(this.encode({ type: 'answer', sdp: pc.localDescription }));
      this.state.set('waiting-connection');
      this.message.set('Envía el código de respuesta al dispositivo que creó la invitación.');
      this.addLog('Respuesta creada.');
    } catch (error) {
      this.fail(error);
    }
  }

  async acceptAnswer(code: string): Promise<void> {
    if (!this.pc) throw new Error('Primero crea una invitación en este dispositivo.');
    this.message.set('Conectando con el otro dispositivo…');
    try {
      const payload = this.decode<SignalPayload>(code);
      if (payload.type !== 'answer' || !payload.sdp) throw new Error('El código no es una respuesta válida.');
      await this.pc.setRemoteDescription(payload.sdp);
      this.state.set('waiting-connection');
      this.addLog('Respuesta aplicada. Esperando el canal P2P.');
    } catch (error) {
      this.fail(error);
    }
  }

  async resync(): Promise<void> {
    if (!this.connected()) throw new Error('No hay una conexión P2P activa.');
    if (this.syncing()) throw new Error('La sincronización ya está en curso.');
    this.remoteFiles = null;
    this.incomingManifest = null;
    this.remotePeerId = '';
    this.localFiles = [];
    this.localMeta.clear();
    this.localReady = false;
    this.planStarted = false;
    this.queuedSends.clear();
    this.requestedPaths.clear();
    this.sentPaths.clear();
    this.pendingSends = 0;
    this.sentCount = 0;
    this.receivedCount = 0;
    this.idleSent = false;
    this.remoteIdle = false;
    await this.startSync();
  }

  disconnect(): void {
    this.closeConnection();
    void this.saveMetadata();
    this.state.set('idle');
    this.message.set('Conexión P2P cerrada.');
    this.syncing.set(false);
    this.invitationCode.set('');
    this.answerCode.set('');
    this.addLog('Desconectado.');
  }

  private createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
    });
    pc.ondatachannel = event => this.configureChannel(event.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.connected.set(true);
      } else if (pc.connectionState === 'failed') {
        this.fail(new Error('No se pudo establecer la conexión directa. Puede que la red bloquee WebRTC.'));
      } else if (pc.connectionState === 'disconnected') {
        this.connected.set(false);
        if (this.state() !== 'completed') this.message.set('Conexión P2P interrumpida. Intentando reconectar…');
      }
    };
    this.pc = pc;
    return pc;
  }

  private configureChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 1024 * 1024;
    channel.onopen = () => {
      this.connected.set(true);
      this.state.set('connected');
      this.message.set('Conectado. Preparando la sincronización…');
      this.addLog('Conexión P2P establecida.');
      void this.startSync();
    };
    channel.onclose = () => {
      if (this.disposed) return;
      this.connected.set(false);
      this.syncing.set(false);
      if (this.state() !== 'error') {
        this.state.set('idle');
        this.message.set('La conexión se cerró.');
      }
      this.addLog('Canal P2P cerrado.');
    };
    channel.onerror = () => this.fail(new Error('Error en el canal de datos P2P.'));
    channel.onmessage = event => {
      this.messageQueue = this.messageQueue
        .then(() => this.handleMessage(event.data))
        .catch(error => this.fail(error));
    };
  }

  private async startSync(): Promise<void> {
    if (!this.root) {
      this.fail(new Error('No hay una carpeta raíz seleccionada.'));
      return;
    }
    this.syncing.set(true);
    this.state.set('syncing');
    this.remoteFiles = null;
    this.incomingManifest = null;
    this.remotePeerId = '';
    this.localReady = false;
    this.planStarted = false;
    this.sentCount = 0;
    this.receivedCount = 0;
    this.idleSent = false;
    this.remoteIdle = false;
    this.message.set('Indexando archivos locales…');
    try {
      await this.loadMetadata(this.root);
      this.localFiles = await this.scanLocal(this.root);
      this.localMeta = new Map(this.localFiles.map(file => [file.path, file]));
      this.localReady = true;
      this.addLog(`${this.localFiles.length} archivos locales indexados.`);
      this.sendManifest();
      this.message.set('Esperando el índice del otro dispositivo…');
      await this.maybeRunPlan();
    } catch (error) {
      this.fail(error);
    }
  }

  private async scanLocal(root: ProjectDirectoryHandle): Promise<SyncFileMeta[]> {
    const files: SyncFileMeta[] = [];
    const queue: Array<{ directory: ProjectDirectoryHandle; prefix: string }> = [{ directory: root, prefix: '' }];
    while (queue.length) {
      const current = queue.shift()!;
      for await (const [name, entry] of current.directory.entries()) {
        const path = current.prefix ? `${current.prefix}/${name}` : name;
        if (entry.kind === 'directory') {
          queue.push({ directory: entry, prefix: path });
        } else {
          if (path === this.metadataFileName) continue;
          const file = await entry.getFile();
          const metadata = this.metadata.get(path);
          const effectiveLastModified = metadata && file.lastModified <= metadata.receivedAt + 2000
            ? metadata.lastModified
            : file.lastModified;
          files.push({ path, size: file.size, lastModified: effectiveLastModified });
          if (files.length % 100 === 0) {
            this.message.set(`Indexando… ${files.length} archivos locales.`);
            await new Promise<void>(resolve => setTimeout(resolve, 0));
          }
        }
      }
    }
    return files;
  }

  private sendManifest(): void {
    this.send({ type: 'manifest-start', peerId: this.peerId, total: this.localFiles.length });
    const chunkSize = 250;
    for (let index = 0; index < this.localFiles.length; index += chunkSize) {
      this.send({ type: 'manifest-part', files: this.localFiles.slice(index, index + chunkSize) });
    }
    this.send({ type: 'manifest-end' });
  }

  private async handleMessage(data: string | ArrayBuffer): Promise<void> {
    if (data instanceof ArrayBuffer) {
      await this.receiveChunk(data);
      return;
    }
    if (typeof data !== 'string') return;
    const message = JSON.parse(data) as Record<string, any>;
    switch (message['type']) {
      case 'manifest-start':
        this.incomingManifest = [];
        this.remotePeerId = String(message['peerId'] ?? '');
        break;
      case 'manifest-part':
        if (this.incomingManifest && Array.isArray(message['files'])) {
          this.incomingManifest.push(...(message['files'] as SyncFileMeta[]));
        }
        break;
      case 'manifest-end':
        this.remoteFiles = this.incomingManifest ?? [];
        this.incomingManifest = null;
        this.addLog(`${this.remoteFiles.length} archivos recibidos del otro dispositivo.`);
        this.message.set('Comparando archivos…');
        await this.maybeRunPlan();
        break;
      case 'request': {
        const requestedPath = String(message['path']);
        if (this.sentPaths.has(requestedPath)) {
          this.send({ type: 'file-skip', path: requestedPath, reason: 'already-sent' });
        } else {
          this.enqueueSend(requestedPath);
        }
        break;
      }
      case 'file-start':
        await this.beginReceive(message as { path: string; size: number; lastModified?: number });
        break;
      case 'file-end':
        await this.finishReceive(String(message['path']));
        break;
      case 'file-skip':
        this.requestedPaths.delete(String(message['path']));
        if (message['reason'] !== 'already-sent') {
          this.addLog(`El otro dispositivo no pudo enviar: ${message['path']}`);
        }
        this.checkIdle();
        break;
      case 'idle':
        this.remoteIdle = true;
        this.checkIdle();
        break;
    }
  }

  private async maybeRunPlan(): Promise<void> {
    if (!this.localReady || !this.remoteFiles || this.planStarted || !this.root) return;
    this.planStarted = true;
    await this.runPlan();
  }

  private async runPlan(): Promise<void> {
    if (!this.remoteFiles || !this.root) return;
    const remote = new Map(this.remoteFiles.map(file => [file.path, file]));
    const local = new Map(this.localFiles.map(file => [file.path, file]));
    const paths = [...new Set([...local.keys(), ...remote.keys()])].sort();
    const requests: string[] = [];

    for (const path of paths) {
      const localFile = local.get(path);
      const remoteFile = remote.get(path);
      if (!localFile && remoteFile) {
        requests.push(path);
      } else if (localFile && remoteFile) {
        if (localFile.size === remoteFile.size && localFile.lastModified === remoteFile.lastModified) continue;
        if (remoteFile.lastModified > localFile.lastModified) requests.push(path);
        else if (remoteFile.lastModified === localFile.lastModified && this.peerId > this.remotePeerId) requests.push(path);
      }
    }

    this.addLog(`Plan: ${requests.length} archivos para recibir.`);
    this.message.set(requests.length
      ? `Sincronizando: ${requests.length} archivos por recibir…`
      : 'Comprobando si el otro dispositivo necesita archivos…');

    for (const path of requests) {
      this.requestedPaths.add(path);
      this.send({ type: 'request', path });
    }
    this.checkIdle();
  }

  private enqueueSend(path: string): void {
    if (path === this.metadataFileName || this.queuedSends.has(path) || this.sentPaths.has(path)) return;
    this.queuedSends.add(path);
    this.pendingSends++;
    this.sendQueue = this.sendQueue
      .then(() => this.sendFile(path))
      .then(() => {
        this.sentPaths.add(path);
        this.sentCount++;
        this.addLog(`Enviado: ${path}`);
      })
      .catch(error => {
        this.addLog(`No se pudo enviar ${path}: ${this.errorMessage(error)}`);
        this.send({ type: 'file-skip', path });
      })
      .finally(() => {
        this.queuedSends.delete(path);
        this.pendingSends--;
        this.updateProgress();
        this.checkIdle();
      });
  }

  private async sendFile(path: string): Promise<void> {
    const file = await this.getLocalFile(path);
    const lastModified = this.localMeta.get(path)?.lastModified ?? file.lastModified;
    this.send({ type: 'file-start', path, size: file.size, lastModified });
    const chunkSize = 64 * 1024;
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
      await this.waitForBuffer();
      if (!this.channel || this.channel.readyState !== 'open') throw new Error('La conexión se cerró durante el envío.');
      this.channel.send(chunk);
    }
    this.send({ type: 'file-end', path });
  }

  private async getLocalFile(path: string): Promise<File> {
    if (!this.root) throw new Error('No hay una carpeta raíz seleccionada.');
    const parts = this.pathParts(path);
    const name = parts.pop()!;
    let directory = this.root;
    for (const part of parts) directory = await directory.getDirectoryHandle(part);
    return (await directory.getFileHandle(name)).getFile();
  }

  private async beginReceive(message: { path: string; size: number; lastModified?: number }): Promise<void> {
    if (!this.root) throw new Error('No hay una carpeta raíz seleccionada.');
    if (message.path === this.metadataFileName) {
      this.addLog('Se ignoró el archivo de metadatos de sincronización.');
      return;
    }
    const parts = this.pathParts(message.path);
    const name = parts.pop()!;
    let directory = this.root;
    for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
    const handle = await directory.getFileHandle(name, { create: true });
    const writer = await handle.createWritable();
    this.incoming = {
      path: message.path,
      name,
      directory,
      size: message.size,
      sourceLastModified: message.lastModified ?? Date.now(),
      received: 0,
      writer
    };
    this.requestedPaths.delete(message.path);
    this.addLog(`Recibiendo: ${message.path}`);
    this.message.set(`Recibiendo ${message.path}…`);
  }

  private async receiveChunk(data: ArrayBuffer): Promise<void> {
    const incoming = this.incoming;
    if (!incoming) return;
    incoming.received += data.byteLength;
    const blob = new Blob([data]);
    this.writeQueue = this.writeQueue.then(() => incoming.writer.write(blob));
    await this.writeQueue;
    this.message.set(`Recibiendo ${incoming.path} (${this.formatBytes(incoming.received)} / ${this.formatBytes(incoming.size)})…`);
  }

  private async finishReceive(path: string): Promise<void> {
    const incoming = this.incoming;
    if (!incoming || incoming.path !== path) return;
    await this.writeQueue;
    await incoming.writer.close();
    this.incoming = null;
    this.metadata.set(path, { lastModified: incoming.sourceLastModified, receivedAt: Date.now() });
    this.scheduleMetadataSave();
    this.receivedCount++;
    this.addLog(`Recibido: ${path}`);
    this.updateProgress();
    this.checkIdle();
  }

  private checkIdle(): void {
    if (!this.syncing() || this.state() === 'completed') return;
    const localIdle = this.pendingSends === 0 && this.requestedPaths.size === 0 && !this.incoming;
    if (!localIdle) return;
    if (!this.idleSent) {
      this.idleSent = true;
      this.send({ type: 'idle' });
    }
    if (this.remoteIdle) {
      this.finishSync(`Sincronización completada: ${this.sentCount} enviados, ${this.receivedCount} recibidos.`);
    }
  }

  private finishSync(message: string): void {
    if (this.state() === 'completed') return;
    this.syncing.set(false);
    this.state.set('completed');
    this.message.set(message);
    this.addLog(message);
    void this.saveMetadata();
  }

  private updateProgress(): void {
    if (!this.syncing() || this.state() === 'completed') return;
    this.message.set(`Sincronizando… ${this.sentCount} enviados, ${this.receivedCount} recibidos.`);
  }

  private waitForBuffer(): Promise<void> {
    const channel = this.channel;
    if (!channel || channel.bufferedAmount < 4 * 1024 * 1024) return Promise.resolve();
    return new Promise<void>(resolve => {
      const onLow = () => {
        channel.removeEventListener('bufferedamountlow', onLow);
        resolve();
      };
      channel.addEventListener('bufferedamountlow', onLow);
    });
  }

  private waitForIce(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise<void>(resolve => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const done = () => {
        if (settled) return;
        settled = true;
        pc.removeEventListener('icegatheringstatechange', check);
        clearTimeout(timer);
        resolve();
      };
      const check = () => {
        if (pc.iceGatheringState === 'complete') done();
      };
      pc.addEventListener('icegatheringstatechange', check);
      timer = setTimeout(done, 8000);
    });
  }

  private send(payload: unknown): void {
    const channel = this.channel;
    if (!channel || channel.readyState !== 'open') return;
    channel.send(JSON.stringify(payload));
  }

  private encode(payload: unknown): string {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = '';
    bytes.forEach(byte => binary += String.fromCharCode(byte));
    return btoa(binary);
  }

  private decode<T>(code: string): T {
    const normalized = code.trim().replace(/\s+/g, '');
    if (!normalized) throw new Error('El código está vacío.');
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }

  private resetSyncState(): void {
    this.remoteFiles = null;
    this.incomingManifest = null;
    this.remotePeerId = '';
    this.localFiles = [];
    this.localMeta.clear();
    this.localReady = false;
    this.planStarted = false;
    this.incoming = null;
    this.metadata = new Map<string, SyncMetadataEntry>();
    if (this.metadataSaveTimer) { clearTimeout(this.metadataSaveTimer); this.metadataSaveTimer = null; }
    this.writeQueue = Promise.resolve();
    this.messageQueue = Promise.resolve();
    this.sendQueue = Promise.resolve();
    this.queuedSends.clear();
    this.requestedPaths.clear();
    this.sentPaths.clear();
    this.pendingSends = 0;
    this.sentCount = 0;
    this.receivedCount = 0;
    this.idleSent = false;
    this.remoteIdle = false;
    this.syncing.set(false);
  }

  private closeConnection(): void {
    this.cleanupIncoming();
    this.disposed = true;
    if (this.channel) {
      this.channel.onopen = null;
      this.channel.onclose = null;
      this.channel.onerror = null;
      this.channel.onmessage = null;
      try { this.channel.close(); } catch { /* already closed */ }
      this.channel = null;
    }
    if (this.pc) {
      this.pc.ondatachannel = null;
      this.pc.onconnectionstatechange = null;
      try { this.pc.close(); } catch { /* already closed */ }
      this.pc = null;
    }
    this.connected.set(false);
    this.disposed = false;
  }

  private fail(error: unknown): void {
    const message = this.errorMessage(error);
    this.cleanupIncoming();
    this.state.set('error');
    this.message.set(message);
    this.syncing.set(false);
    this.addLog(`Error: ${message}`);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Error inesperado durante la sincronización.';
  }

  private cleanupIncoming(): void {
    const incoming = this.incoming;
    if (!incoming) return;
    this.incoming = null;
    void incoming.writer.close()
      .then(() => incoming.directory.removeEntry(incoming.name))
      .catch(() => { /* the partial file may already be gone */ });
  }

  private async loadMetadata(root: ProjectDirectoryHandle): Promise<void> {
    this.metadata = new Map<string, SyncMetadataEntry>();
    try {
      const handle = await root.getFileHandle(this.metadataFileName);
      const file = await handle.getFile();
      const parsed = JSON.parse(await file.text()) as { files?: Record<string, unknown> };
      if (parsed && parsed.files && typeof parsed.files === 'object') {
        for (const [path, value] of Object.entries(parsed.files)) {
          const entry = value as Partial<SyncMetadataEntry> | null;
          if (typeof entry?.lastModified === 'number' && typeof entry.receivedAt === 'number') {
            this.metadata.set(path, { lastModified: entry.lastModified, receivedAt: entry.receivedAt });
          }
        }
      }
    } catch {
      // The metadata file does not exist yet.
    }
  }

  private scheduleMetadataSave(): void {
    if (this.metadataSaveTimer) clearTimeout(this.metadataSaveTimer);
    this.metadataSaveTimer = setTimeout(() => {
      this.metadataSaveTimer = null;
      void this.saveMetadata();
    }, 500);
  }

  private async saveMetadata(): Promise<void> {
    if (!this.root) return;
    try {
      const handle = await this.root.getFileHandle(this.metadataFileName, { create: true });
      const writer = await handle.createWritable();
      await writer.write(JSON.stringify({ files: Object.fromEntries(this.metadata) }));
      await writer.close();
    } catch (error) {
      this.addLog(`No se pudo guardar el estado de sincronización: ${this.errorMessage(error)}`);
    }
  }

  private pathParts(path: string): string[] {
    const parts = path.split('/').filter(Boolean);
    if (!parts.length || parts.some(part => part === '.' || part === '..' || part.includes('\\') || part.includes(':') || part.includes('\0'))) {
      throw new Error('Ruta de archivo no válida.');
    }
    return parts;
  }

  private addLog(entry: string): void {
    const time = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.log.update(items => [...items.slice(-49), `[${time}] ${entry}`]);
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
