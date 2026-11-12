import { Injectable, signal } from '@angular/core';
import { ProjectDirectoryHandle, ProjectFileHandle } from '../view-content.component/project-library-manager.component';
import type { LibraryDeletion } from '../../services/library-tree.service';

export type P2PState =
  | 'idle'
  | 'creating-invitation'
  | 'waiting-answer'
  | 'waiting-connection'
  | 'connected'
  | 'syncing'
  | 'completed'
  | 'error';

export type P2PRole = 'none' | 'offerer' | 'answerer';

export type SyncRootKind = 'main' | 'player';

export interface SyncRoot {
  kind: SyncRootKind;
  id: string;
  name: string;
  root: ProjectDirectoryHandle;
}

interface RootInfo {
  kind: SyncRootKind;
  id: string;
  name: string;
}

interface SyncFileMeta {
  root: SyncRootKind;
  path: string;
  size: number;
  lastModified: number;
  contentHash?: string;
  normalized?: boolean;
}

interface SyncMetadataEntry {
  lastModified: number;
  receivedAt: number;
}

const LIBRARY_DELETIONS_FILE = '.calevri/library-deletions.json';

interface SignalPayload {
  type: 'offer' | 'answer';
  sdp: RTCSessionDescriptionInit;
}

type WritableFile = Awaited<ReturnType<ProjectFileHandle['createWritable']>>;

@Injectable({ providedIn: 'root' })
export class P2PSyncService {
  readonly state = signal<P2PState>('idle');
  readonly role = signal<P2PRole>('none');
  readonly message = signal('');
  readonly connected = signal(false);
  readonly syncing = signal(false);
  readonly invitationCode = signal('');
  readonly answerCode = signal('');
  readonly remoteLibraryNames = signal<string[]>([]);
  readonly mediaContainerName = signal('');
  readonly log = signal<string[]>([]);
  readonly peerId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private roots = new Map<SyncRootKind, SyncRoot>();
  private mediaRoots: SyncRoot[] = [];
  private remoteRoots = new Map<string, RootInfo>();
  private remoteRootsReady = false;
  private remotePeerId = '';
  private remoteFiles: SyncFileMeta[] | null = null;
  private remoteDeletions: LibraryDeletion[] | null = null;
  private localDeletions = new Map<string, LibraryDeletion>();
  private remoteDeletionsReady = false;
  private localFiles: SyncFileMeta[] = [];
  private localMeta = new Map<string, SyncFileMeta>();
  private localSourcePaths = new Map<string, string>();
  private incomingManifest: SyncFileMeta[] | null = null;
  private localReady = false;
  private planStarted = false;
  private incoming: {
    key: string;
    root: SyncRootKind;
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
  private connectionWasEstablished = false;
  private readonly metadataFileName = '.calevri/sync.json';

  async createInvitation(roots: SyncRoot[]): Promise<void> {
    this.closeConnection();
    this.setRoots(roots);
    this.resetSyncState();
    this.role.set('offerer');
    this.state.set('creating-invitation');
    this.message.set('Creando la invitación P2P…');
    this.invitationCode.set('');
    this.answerCode.set('');
    if (!this.roots.has('main')) {
      this.fail(new Error('Selecciona la carpeta de la biblioteca principal antes de crear la invitación.'));
      return;
    }
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

  async acceptInvitation(roots: SyncRoot[], code: string): Promise<void> {
    if (this.role() === 'offerer' && this.pc?.signalingState === 'have-local-offer') {
      throw new Error('Este dispositivo ya creó una invitación. Genera la respuesta en el otro dispositivo o pulsa Cancelar para cambiar de rol.');
    }
    this.closeConnection();
    this.setRoots(roots);
    this.resetSyncState();
    this.role.set('answerer');
    this.state.set('waiting-connection');
    this.message.set('Procesando la invitación…');
    this.invitationCode.set('');
    this.answerCode.set('');
    if (!this.roots.has('main')) {
      this.fail(new Error('Selecciona la carpeta de la biblioteca principal antes de generar la respuesta.'));
      return;
    }
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
    if (this.role() !== 'offerer' || !this.pc) {
      throw new Error('Este dispositivo no creó la invitación. El código de respuesta debe pegarse en el Dispositivo A, que es el que creó la invitación.');
    }
    if (this.pc.signalingState !== 'have-local-offer') {
      if (this.connected() || this.pc.connectionState === 'connected') {
        throw new Error('La conexión P2P ya está establecida.');
      }
      throw new Error('La invitación ya no está pendiente. Crea una nueva invitación en el Dispositivo A.');
    }
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
    this.remoteDeletions = null;
    this.remoteDeletionsReady = false;
    this.incomingManifest = null;
    this.remoteRoots.clear();
    this.remoteLibraryNames.set([]);
    this.remoteRootsReady = false;
    this.remotePeerId = '';
    this.localFiles = [];
    this.localMeta.clear();
    this.localSourcePaths.clear();
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

  private setRoots(roots: SyncRoot[]): void {
    this.roots = new Map();
    this.mediaRoots = [];
    this.mediaContainerName.set('');
    for (const root of roots) {
      if (!root.root) continue;
      if (root.kind === 'player') {
        if (this.mediaRoots.some(item => item.name.toLocaleLowerCase() === root.name.toLocaleLowerCase())) continue;
        this.mediaRoots.push(root);
      } else {
        this.roots.set(root.kind, root);
      }
    }
    if (this.mediaRoots.length) this.roots.set('player', this.mediaRoots[0]);
    this.mediaContainerName.set(this.mediaRoots[0]?.name ?? '');
  }

  private createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
    });
    pc.ondatachannel = event => this.configureChannel(event.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.connectionWasEstablished = true;
        this.connected.set(true);
      } else if (pc.connectionState === 'failed') {
        const message = this.connectionWasEstablished
          ? `La conexión P2P se perdió durante la transferencia (ICE: ${pc.iceConnectionState}). Los archivos confirmados se conservaron; crea una nueva invitación para continuar.`
          : `No se pudo establecer la conexión directa (ICE: ${pc.iceConnectionState}). Puede que la red bloquee WebRTC.`;
        this.fail(new Error(message));
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
    if (!this.roots.has('main')) {
      this.fail(new Error('No hay una carpeta raíz seleccionada.'));
      return;
    }
    this.syncing.set(true);
    this.state.set('syncing');
    this.remoteFiles = null;
    this.remoteDeletions = null;
    this.remoteDeletionsReady = false;
    this.incomingManifest = null;
    this.remoteRoots.clear();
    this.remoteLibraryNames.set([]);
    this.remoteRootsReady = false;
    this.remotePeerId = '';
    this.localReady = false;
    this.planStarted = false;
    this.sentCount = 0;
    this.receivedCount = 0;
    this.idleSent = false;
    this.remoteIdle = false;
    this.message.set('Indexando archivos locales…');
    try {
      await this.loadMetadata(this.roots.get('main')!.root);
      this.localFiles = await this.scanRoots();
      await this.loadLocalDeletions();
      this.localMeta = new Map(this.localFiles.map(file => [this.keyOf(file.root, file.path), file]));
      this.localReady = true;
      this.addLog(`${this.localFiles.length} archivos locales indexados en ${this.mediaRoots.length + (this.roots.has('main') ? 1 : 0)} biblioteca(s).`);
      this.sendRoots();
      this.sendDeletions();
      this.sendManifest();
      this.message.set('Esperando el índice del otro dispositivo…');
      await this.maybeRunPlan();
    } catch (error) {
      this.fail(error);
    }
  }

  private async scanRoots(): Promise<SyncFileMeta[]> {
    const files = new Map<string, SyncFileMeta>();
    this.localSourcePaths.clear();
    const roots = [...this.roots.values()].filter(root => root.kind === 'main').concat(this.mediaRoots);
    for (const root of roots) {
      await this.scanRoot(root, files);
    }
    return [...files.values()];
  }

  private async loadLocalDeletions(): Promise<void> {
    this.localDeletions.clear();
    const parts = LIBRARY_DELETIONS_FILE.split('/');
    const fileName = parts.pop()!;
    for (const root of this.mediaRoots) {
      try {
        let directory = root.root;
        for (const part of parts) directory = await directory.getDirectoryHandle(part);
        const file = await (await directory.getFileHandle(fileName)).getFile();
        const parsed = JSON.parse(await file.text()) as unknown;
        if (!Array.isArray(parsed)) continue;
        for (const deletion of parsed) {
          if (!this.isLibraryDeletion(deletion)) continue;
          const key = this.deletionKey(deletion);
          const current = this.localDeletions.get(key);
          if (!current || deletion.deletedAt > current.deletedAt) this.localDeletions.set(key, deletion);
        }
      } catch { /* Esta biblioteca todavía no tiene eliminaciones registradas. */ }
    }

    for (const [key, deletion] of this.localDeletions) {
      const file = this.localFiles.find(item => item.root === 'player' && item.path === `${deletion.libraryName}/${deletion.path}`);
      if (file && file.lastModified > deletion.deletedAt) this.localDeletions.delete(key);
    }
  }

  private async scanRoot(root: SyncRoot, files: Map<string, SyncFileMeta>): Promise<void> {
    const queue: Array<{ directory: ProjectDirectoryHandle; prefix: string; physicalPrefix: string; normalized: boolean }> = [
      { directory: root.root, prefix: '', physicalPrefix: '', normalized: true }
    ];
    while (queue.length) {
      const current = queue.shift()!;
      for await (const [name, entry] of current.directory.entries()) {
        const path = current.prefix ? `${current.prefix}/${name}` : name;
        const physicalPath = current.physicalPrefix ? `${current.physicalPrefix}/${name}` : name;
        if (entry.kind === 'directory') {
          if (root.kind === 'player' && !current.prefix && this.mediaRoots.some(other => other.id !== root.id && other.name.toLocaleLowerCase() === name.toLocaleLowerCase())) continue;
          const legacyLibraryFolder = root.kind === 'player' && !current.prefix && name.toLocaleLowerCase() === root.name.toLocaleLowerCase();
          queue.push({
            directory: entry,
            prefix: legacyLibraryFolder ? '' : path,
            physicalPrefix: physicalPath,
            normalized: current.normalized && !legacyLibraryFolder
          });
        } else {
          if (root.kind === 'main' && path === this.metadataFileName) continue;
          if (root.kind === 'player' && path === LIBRARY_DELETIONS_FILE) continue;
          const virtualPath = current.prefix ? path : name;
          const syncPath = root.kind === 'player' ? `${root.name}/${virtualPath}` : path;
          const handle = entry as ProjectFileHandle & { size?: number; lastModified?: number };
          const fallback = handle.size === undefined || handle.lastModified === undefined ? await entry.getFile() : null;
          const key = this.keyOf(root.kind, syncPath);
          const metadata = this.metadata.get(key);
          const size = handle.size ?? fallback?.size ?? 0;
          const fileLastModified = handle.lastModified ?? fallback?.lastModified ?? 0;
          const effectiveLastModified = metadata && fileLastModified <= metadata.receivedAt + 2000
            ? metadata.lastModified
            : fileLastModified;
          const contentHash = root.kind === 'main' && path === '.calevri/creatividad.json'
            ? await this.hashFile(fallback ?? await entry.getFile())
            : undefined;
          const file: SyncFileMeta = {
            root: root.kind, path: syncPath, size, lastModified: effectiveLastModified,
            contentHash, normalized: current.normalized
          };
          const existing = files.get(key);
          if (!existing || file.lastModified > existing.lastModified
            || (file.lastModified === existing.lastModified && file.normalized && !existing.normalized)) {
            files.set(key, file);
            this.localSourcePaths.set(key, physicalPath);
          }
          if (files.size % 100 === 0) {
            this.message.set(`Indexando… ${files.size} archivos locales.`);
            await new Promise<void>(resolve => setTimeout(resolve, 0));
          }
        }
      }
    }
  }

  private sendRoots(): void {
    const roots: RootInfo[] = [...this.roots.values()].filter(root => root.kind === 'main').concat(this.mediaRoots)
      .map(root => ({ kind: root.kind, id: root.id, name: root.name }));
    this.send({ type: 'roots', roots });
  }

  private sendDeletions(): void {
    this.send({ type: 'deletions', items: [...this.localDeletions.values()] });
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
      case 'roots':
        this.handleRemoteRoots(message['roots']);
        break;
      case 'deletions':
        this.remoteDeletions = Array.isArray(message['items'])
          ? (message['items'] as LibraryDeletion[]).filter(item => this.isLibraryDeletion(item))
          : [];
        this.remoteDeletionsReady = true;
        await this.maybeRunPlan();
        break;
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
        const manifestLibraryNames = this.remoteFiles
          .filter(file => file.root === 'player')
          .map(file => file.path.split('/')[0])
          .filter(Boolean);
        this.remoteLibraryNames.set([...new Set([...this.remoteLibraryNames(), ...manifestLibraryNames])]);
        this.addLog(`${this.remoteFiles.length} archivos recibidos del otro dispositivo.`);
        this.message.set('Comparando archivos…');
        await this.maybeRunPlan();
        break;
      case 'request': {
        const root = this.rootKind(message['root']);
        const requestedPath = String(message['path']);
        if (!root || !this.roots.has(root)) {
          this.send({ type: 'file-skip', root: message['root'], path: requestedPath, reason: 'missing-root' });
          break;
        }
        const key = this.keyOf(root, requestedPath);
        if (this.sentPaths.has(key)) {
          this.send({ type: 'file-skip', root, path: requestedPath, reason: 'already-sent' });
        } else {
          this.enqueueSend(root, requestedPath);
        }
        break;
      }
      case 'file-start':
        await this.beginReceive({
          root: this.rootKind(message['root']),
          path: String(message['path']),
          size: Number(message['size'] ?? 0),
          lastModified: typeof message['lastModified'] === 'number' ? message['lastModified'] : undefined
        });
        break;
      case 'file-end':
        await this.finishReceive(this.rootKind(message['root']), String(message['path']));
        break;
      case 'file-skip': {
        const root = this.rootKind(message['root']);
        if (root) this.requestedPaths.delete(this.keyOf(root, String(message['path'])));
        if (message['reason'] !== 'already-sent') {
          this.addLog(`El otro dispositivo no pudo enviar: ${message['path']}`);
        }
        this.checkIdle();
        break;
      }
      case 'idle':
        this.remoteIdle = true;
        this.checkIdle();
        break;
    }
  }

  private handleRemoteRoots(value: unknown): void {
    this.remoteRoots.clear();
    const remoteNames: string[] = [];
    if (Array.isArray(value)) {
      for (const item of value as RootInfo[]) {
        const kind = this.rootKind(item?.kind);
        if (kind) {
          const root = { kind, id: String(item.id ?? ''), name: String(item.name ?? '') };
          this.remoteRoots.set(`${kind}:${root.id}`, root);
          if (kind === 'player' && root.name) remoteNames.push(root.name);
        }
      }
    }
    this.remoteLibraryNames.set([...new Set(remoteNames)]);
    this.remoteRootsReady = true;
    const localNames = new Set(this.mediaRoots.map(root => root.name.toLocaleLowerCase()));
    const missing = [...this.remoteRoots.values()].filter(root => root.kind === 'player' && !localNames.has(root.name.toLocaleLowerCase()));
    if (missing.length) {
      this.addLog(`Se crearán en la biblioteca local las carpetas de medios recibidas: ${missing.map(root => root.name).join(', ')}.`);
    }
    void this.maybeRunPlan();
  }

  private async applyRemoteDeletions(): Promise<void> {
    for (const deletion of this.remoteDeletions ?? []) {
      const key = this.deletionKey(deletion);
      const current = this.localDeletions.get(key);
      const manifestPath = `${deletion.libraryName}/${deletion.path}`;
      const localFile = this.localMeta.get(this.keyOf('player', manifestPath));
      const remoteFile = this.remoteFiles?.find(file => file.root === 'player' && file.path === manifestPath);
      const newestFileTime = Math.max(localFile?.lastModified ?? 0, remoteFile?.lastModified ?? 0);
      const merged = current && current.deletedAt > deletion.deletedAt ? current : deletion;
      if (newestFileTime > merged.deletedAt) {
        this.localDeletions.delete(key);
        continue;
      }
      this.localDeletions.set(key, merged);

      const root = await this.resolveMediaRoot(deletion.libraryName, true);
      const parts = this.pathParts(deletion.path);
      const name = parts.pop()!;
      let directory = root.root;
      try {
        for (const part of parts) directory = await directory.getDirectoryHandle(part);
        await directory.removeEntry(name);
        this.addLog(`Eliminado en todos los dispositivos: ${manifestPath}`);
      } catch { /* El archivo ya no existe en este dispositivo. */ }
    }

    const names = new Set([...this.localDeletions.values()].map(deletion => deletion.libraryName));
    for (const name of names) {
      const root = await this.resolveMediaRoot(name, true);
      const deletions = [...this.localDeletions.values()].filter(deletion => deletion.libraryName === name);
      const parts = LIBRARY_DELETIONS_FILE.split('/');
      const fileName = parts.pop()!;
      let directory = root.root;
      for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
      const handle = await directory.getFileHandle(fileName, { create: true });
      const writer = await handle.createWritable();
      await writer.write(JSON.stringify(deletions));
      await writer.close();
    }
  }

  private async resolveMediaRoot(libraryName: string, create: boolean): Promise<SyncRoot> {
    const existing = this.mediaRoots.find(root => root.name.toLocaleLowerCase() === libraryName.toLocaleLowerCase());
    if (existing) return existing;
    const container = this.mediaRoots[0];
    if (!container) throw new Error('No hay una carpeta local para recibir las bibliotecas multimedia.');
    return {
      ...container,
      id: `${container.id}:${libraryName}`,
      name: libraryName,
      root: await container.root.getDirectoryHandle(libraryName, { create })
    };
  }

  private isLibraryDeletion(value: unknown): value is LibraryDeletion {
    if (!value || typeof value !== 'object') return false;
    const item = value as Partial<LibraryDeletion>;
    if (typeof item.libraryName !== 'string' || !item.libraryName.trim()
      || typeof item.path !== 'string' || !Number.isFinite(item.deletedAt)) return false;
    try { this.pathParts(item.path); return true; }
    catch { return false; }
  }

  private deletionKey(deletion: LibraryDeletion): string {
    return `${deletion.libraryName.toLocaleLowerCase()}:${deletion.path}`;
  }

  private async maybeRunPlan(): Promise<void> {
    if (!this.remoteRootsReady || !this.remoteDeletionsReady || !this.localReady || !this.remoteFiles || this.planStarted) return;
    this.planStarted = true;
    await this.applyRemoteDeletions();
    await this.runPlan();
  }

  private async runPlan(): Promise<void> {
    if (!this.remoteFiles || !this.roots.has('main')) return;
    const remote = new Map(this.remoteFiles.map(file => [this.keyOf(file.root, file.path), file]));
    const local = new Map(this.localFiles.map(file => [this.keyOf(file.root, file.path), file]));
    const deletions = new Map<string, LibraryDeletion>();
    for (const deletion of [...this.localDeletions.values(), ...(this.remoteDeletions ?? [])]) {
      const key = this.deletionKey(deletion);
      const current = deletions.get(key);
      if (!current || deletion.deletedAt > current.deletedAt) deletions.set(key, deletion);
    }
    for (const [deletionKey, deletion] of deletions) {
      const key = this.keyOf('player', `${deletion.libraryName}/${deletion.path}`);
      const localFile = local.get(key);
      const remoteFile = remote.get(key);
      const newestFileTime = Math.max(localFile?.lastModified ?? 0, remoteFile?.lastModified ?? 0);
      if (newestFileTime > deletion.deletedAt) {
        this.localDeletions.delete(deletionKey);
        continue;
      }
      local.delete(key);
      remote.delete(key);
    }
    const paths = [...new Set([...local.keys(), ...remote.keys()])].sort();
    const requests: SyncFileMeta[] = [];
    let skipped = 0;

    for (const key of paths) {
      const localFile = local.get(key);
      const remoteFile = remote.get(key);
      if (remoteFile && !this.roots.has(remoteFile.root)) {
        if (localFile || !this.roots.has(remoteFile.root)) skipped++;
        continue;
      }
      if (!localFile && remoteFile) {
        requests.push(remoteFile);
      } else if (localFile && remoteFile) {
        const sameContent = localFile.size === remoteFile.size
          && localFile.lastModified === remoteFile.lastModified
          && (!localFile.contentHash || !remoteFile.contentHash || localFile.contentHash === remoteFile.contentHash);
        if (sameContent) {
          const localIsNormalized = localFile.normalized !== false;
          const remoteIsNormalized = remoteFile.normalized !== false;
          if (localIsNormalized && remoteIsNormalized) continue;
          if (localIsNormalized !== remoteIsNormalized) {
            if (localIsNormalized) this.enqueueSend(localFile.root, localFile.path);
            else requests.push(remoteFile);
          } else {
            this.enqueueSend(localFile.root, localFile.path);
          }
          continue;
        }
        if (remoteFile.lastModified > localFile.lastModified) requests.push(remoteFile);
        else if (localFile.lastModified > remoteFile.lastModified) {
          this.enqueueSend(localFile.root, localFile.path);
        } else if (this.peerId > this.remotePeerId) {
          requests.push(remoteFile);
        } else {
          this.enqueueSend(localFile.root, localFile.path);
        }
      }
    }

    this.addLog(`Plan: ${requests.length} archivos para recibir${skipped ? `, ${skipped} omitidos por falta de carpeta local` : ''}.`);
    this.message.set(requests.length
      ? `Sincronizando: ${requests.length} archivos por recibir y los cambios locales más recientes…`
      : 'Comprobando si el otro dispositivo necesita archivos…');

    for (const file of requests) {
      this.requestedPaths.add(this.keyOf(file.root, file.path));
      this.send({ type: 'request', root: file.root, path: file.path });
    }
    this.checkIdle();
  }

  private enqueueSend(root: SyncRootKind, path: string): void {
    const key = this.keyOf(root, path);
    if ((root === 'main' && path === this.metadataFileName) || this.queuedSends.has(key) || this.sentPaths.has(key)) return;
    this.queuedSends.add(key);
    this.pendingSends++;
    this.sendQueue = this.sendQueue
      .then(() => this.sendFile(root, path))
      .then(() => {
        this.sentPaths.add(key);
        this.sentCount++;
        this.addLog(`Enviado: ${root === 'player' ? 'reproductor/' : ''}${path}`);
      })
      .catch(error => {
        this.addLog(`No se pudo enviar ${path}: ${this.errorMessage(error)}`);
        this.send({ type: 'file-skip', root, path });
      })
      .finally(() => {
        this.queuedSends.delete(key);
        this.pendingSends--;
        this.updateProgress();
        this.checkIdle();
      });
  }

  private async sendFile(root: SyncRootKind, path: string): Promise<void> {
    const handle = await this.getLocalFileHandle(root, path);
    const lastModified = this.localMeta.get(this.keyOf(root, path))?.lastModified ?? handle.lastModified ?? Date.now();
    const chunkSize = 64 * 1024;
    if (handle.openReader) {
      const reader = await handle.openReader();
      try {
        this.send({ type: 'file-start', root, path, size: reader.size, lastModified });
        for (let offset = 0; offset < reader.size;) {
          const chunk = await reader.readChunk(Math.min(chunkSize, reader.size - offset));
          if (!chunk?.byteLength) throw new Error(`El archivo se interrumpió al leer ${path}.`);
          await this.waitForBuffer();
          if (!this.channel || this.channel.readyState !== 'open') throw new Error('La conexión se cerró durante el envío.');
          this.channel.send(chunk);
          offset += chunk.byteLength;
          if (offset % (4 * 1024 * 1024) < chunk.byteLength) {
            this.message.set(`Enviando ${path} (${this.formatBytes(offset)} / ${this.formatBytes(reader.size)})…`);
          }
        }
      } finally {
        await reader.close().catch(() => undefined);
      }
    } else {
      const file = await handle.getFile();
      this.send({ type: 'file-start', root, path, size: file.size, lastModified });
      for (let offset = 0; offset < file.size; offset += chunkSize) {
        const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
        await this.waitForBuffer();
        if (!this.channel || this.channel.readyState !== 'open') throw new Error('La conexión se cerró durante el envío.');
        this.channel.send(chunk);
      }
    }
    this.send({ type: 'file-end', root, path });
  }

  private async getLocalFileHandle(root: SyncRootKind, path: string): Promise<ProjectFileHandle> {
    const parts = this.pathParts(path);
    const syncRoot = root === 'player'
      ? this.mediaRoots.find(item => item.name.toLocaleLowerCase() === parts[0]?.toLocaleLowerCase())
      : this.roots.get(root);
    if (!syncRoot) throw new Error('No hay una carpeta local para esta biblioteca.');
    const sourcePath = this.localSourcePaths.get(this.keyOf(root, path)) ?? (root === 'player' ? parts.slice(1).join('/') : path);
    const sourceParts = this.pathParts(sourcePath);
    const name = sourceParts.pop()!;
    let directory = syncRoot.root;
    for (const part of sourceParts) directory = await directory.getDirectoryHandle(part);
    return directory.getFileHandle(name);
  }

  private async hashFile(file: File): Promise<string | undefined> {
    const bytes = await file.arrayBuffer();
    if (globalThis.crypto?.subtle) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    let hash = 2166136261;
    for (const byte of new Uint8Array(bytes)) hash = Math.imul(hash ^ byte, 16777619);
    return `fnv1a-${(hash >>> 0).toString(16)}`;
  }

  private async beginReceive(message: { root: SyncRootKind | null; path: string; size: number; lastModified?: number }): Promise<void> {
    if (!message.root) {
      this.send({ type: 'file-skip', root: message.root, path: message.path, reason: 'missing-root' });
      return;
    }
    let syncRoot = this.roots.get(message.root);
    if (!syncRoot) {
      this.send({ type: 'file-skip', root: message.root, path: message.path, reason: 'missing-root' });
      return;
    }
    if (message.root === 'main' && message.path === this.metadataFileName) {
      this.addLog('Se ignoró el archivo de metadatos de sincronización.');
      return;
    }
    const parts = this.pathParts(message.path);
    if (message.root === 'player') {
      const libraryName = parts.shift()!;
      const matchingRoot = this.mediaRoots.find(item => item.name.toLocaleLowerCase() === libraryName.toLocaleLowerCase());
      if (matchingRoot) {
        syncRoot = matchingRoot;
      } else {
        const container = this.mediaRoots[0];
        if (!container) {
          this.send({ type: 'file-skip', root: message.root, path: message.path, reason: 'missing-root' });
          return;
        }
        syncRoot = { ...container, root: await container.root.getDirectoryHandle(libraryName, { create: true }), name: libraryName };
      }
    }
    const name = parts.pop()!;
    let directory = syncRoot.root;
    for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
    const handle = await directory.getFileHandle(name, { create: true });
    const writer = await handle.createWritable();
    const key = this.keyOf(message.root, message.path);
    this.incoming = {
      key,
      root: message.root,
      path: message.path,
      name,
      directory,
      size: message.size,
      sourceLastModified: message.lastModified ?? Date.now(),
      received: 0,
      writer
    };
    this.requestedPaths.delete(key);
    this.addLog(`Recibiendo: ${message.root === 'player' ? 'reproductor/' : ''}${message.path}`);
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

  private async finishReceive(root: SyncRootKind | null, path: string): Promise<void> {
    const incoming = this.incoming;
    if (!incoming || !root || incoming.key !== this.keyOf(root, path)) return;
    await this.writeQueue;
    await incoming.writer.close();
    this.incoming = null;
    this.metadata.set(incoming.key, { lastModified: incoming.sourceLastModified, receivedAt: Date.now() });
    this.scheduleMetadataSave();
    this.receivedCount++;
    this.addLog(`Recibido: ${incoming.root === 'player' ? 'reproductor/' : ''}${incoming.path}`);
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
    const highWaterMark = 4 * 1024 * 1024;
    if (!channel || channel.readyState !== 'open') return Promise.reject(new Error('La conexión se cerró durante el envío.'));
    if (channel.bufferedAmount < highWaterMark) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      const cleanup = () => {
        channel.removeEventListener('bufferedamountlow', onLow);
        channel.removeEventListener('close', onClose);
        if (pollTimer) clearInterval(pollTimer);
      };
      const onLow = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(new Error('La conexión se cerró durante el envío.'));
      };
      channel.addEventListener('bufferedamountlow', onLow);
      channel.addEventListener('close', onClose);
      pollTimer = setInterval(() => {
        if (channel.readyState !== 'open') onClose();
        else if (channel.bufferedAmount < highWaterMark) onLow();
      }, 500);

      // Recheck after registering: the buffer can drain before the listener is attached.
      if (channel.readyState !== 'open') onClose();
      else if (channel.bufferedAmount < highWaterMark) onLow();
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
    this.remoteDeletions = null;
    this.remoteDeletionsReady = false;
    this.incomingManifest = null;
    this.remoteRoots.clear();
    this.remoteLibraryNames.set([]);
    this.remoteRootsReady = false;
    this.remotePeerId = '';
    this.localFiles = [];
    this.localMeta.clear();
    this.localSourcePaths.clear();
    this.localDeletions.clear();
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
    this.role.set('none');
    this.connectionWasEstablished = false;
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
      const parts = this.metadataFileName.split('/');
      const fileName = parts.pop()!;
      let directory = root;
      for (const part of parts) directory = await directory.getDirectoryHandle(part);
      const handle = await directory.getFileHandle(fileName);
      const file = await handle.getFile();
      const parsed = JSON.parse(await file.text()) as { files?: Record<string, unknown> };
      if (parsed && parsed.files && typeof parsed.files === 'object') {
        for (const [rawKey, value] of Object.entries(parsed.files)) {
          const entry = value as Partial<SyncMetadataEntry> | null;
          if (typeof entry?.lastModified === 'number' && typeof entry?.receivedAt === 'number') {
            const key = rawKey.includes(':') ? rawKey : `main:${rawKey}`;
            this.metadata.set(key, { lastModified: entry.lastModified, receivedAt: entry.receivedAt });
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
    const main = this.roots.get('main');
    if (!main) return;
    try {
      const parts = this.metadataFileName.split('/');
      const fileName = parts.pop()!;
      let directory = main.root;
      for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
      const handle = await directory.getFileHandle(fileName, { create: true });
      const writer = await handle.createWritable();
      await writer.write(JSON.stringify({ files: Object.fromEntries(this.metadata) }));
      await writer.close();
    } catch (error) {
      this.addLog(`No se pudo guardar el estado de sincronización: ${this.errorMessage(error)}`);
    }
  }

  private keyOf(root: SyncRootKind, path: string): string {
    return `${root}:${path}`;
  }

  private rootKind(value: unknown): SyncRootKind | null {
    return value === 'main' || value === 'player' ? value : null;
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
