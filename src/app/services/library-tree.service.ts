import { Injectable, effect, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { AndroidDirectoryAccess } from '@calevrij/admin-android-directory-access';
import { ConfigService, PlayerLibraryConfig } from './config.service';

export interface LibraryDirectoryHandle {
  name: string;
  kind: 'directory';
  entries(): AsyncIterable<[string, LibraryDirectoryHandle | LibraryFileHandle]>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<LibraryDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<LibraryFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
}

export interface LibraryFileHandle {
  kind: 'file';
  size?: number;
  lastModified?: number;
  mimeType?: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void> }>;
}

export interface LibraryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { mode?: 'readwrite' }) => Promise<LibraryDirectoryHandle>;
}

export interface LibraryMediaSource {
  source: 'android';
  name: string;
  type: string;
  size: number;
  lastModified: number;
  url: string;
}

const ANDROID_ROOTS_STORAGE_KEY = 'calevrij.library-tree.android-roots.v1';
const ANDROID_LAST_ROOT_STORAGE_KEY = 'calevrij.library-tree.android-last-root.v1';
const BROWSER_ROOT_DATABASE = 'calevrij-library-tree';
const BROWSER_ROOT_STORE = 'roots';
const BROWSER_LAST_ROOT_KEY = 'last-used';

class AndroidLibraryFileHandle implements LibraryFileHandle {
  readonly kind = 'file' as const;

  constructor(
    private readonly uri: string,
    private readonly path: string,
    readonly size?: number,
    readonly lastModified?: number,
    readonly mimeType?: string
  ) {}

  async getFile(): Promise<File> {
    const result = await AndroidDirectoryAccess.readFile({ uri: this.uri, path: this.path });
    const bytes = Uint8Array.from(atob(result.data), character => character.charCodeAt(0));
    return new File([bytes], result.name, { type: result.mimeType, lastModified: result.lastModified });
  }

  async createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void> }> {
    let content: string | Blob = '';
    return {
      write: async data => { content = data; },
      close: async () => {
        const blob = typeof content === 'string' ? new Blob([content]) : content;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        await AndroidDirectoryAccess.writeFile({
          uri: this.uri,
          path: this.path,
          data: btoa(binary),
          mimeType: blob.type || 'application/octet-stream'
        });
      }
    };
  }
}

class AndroidLibraryDirectoryHandle implements LibraryDirectoryHandle {
  readonly kind = 'directory' as const;

  constructor(readonly uri: string, private readonly path: string, readonly name: string) {}

  persistedRoot(): string { return this.uri; }

  async prepareForPlayback(path: string): Promise<LibraryMediaSource> {
    const cached = await AndroidDirectoryAccess.getFileUri({ uri: this.uri, path });
    return {
      source: 'android',
      name: cached.name,
      type: cached.mimeType,
      size: cached.size,
      lastModified: cached.lastModified,
      url: Capacitor.convertFileSrc(cached.uri)
    };
  }

  async *entries(): AsyncIterable<[string, LibraryDirectoryHandle | LibraryFileHandle]> {
    const { entries } = await AndroidDirectoryAccess.listDirectory({ uri: this.uri, path: this.path });
    for (const entry of entries) {
      const path = this.path ? `${this.path}/${entry.name}` : entry.name;
      const handle = entry.kind === 'directory'
        ? new AndroidLibraryDirectoryHandle(this.uri, path, entry.name)
        : new AndroidLibraryFileHandle(this.uri, path, entry.size, entry.lastModified, entry.mimeType);
      yield [entry.name, handle];
    }
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<LibraryDirectoryHandle> {
    const path = this.path ? `${this.path}/${name}` : name;
    const result = await AndroidDirectoryAccess.getDirectory({ uri: this.uri, path, create: options?.create ?? false });
    return new AndroidLibraryDirectoryHandle(this.uri, path, result.name);
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<LibraryFileHandle> {
    if (!options?.create) {
      const { entries } = await AndroidDirectoryAccess.listDirectory({ uri: this.uri, path: this.path });
      if (!entries.some(entry => entry.name === name && entry.kind === 'file')) {
        throw new DOMException(`File not found: ${name}`, 'NotFoundError');
      }
    }
    return new AndroidLibraryFileHandle(this.uri, this.path ? `${this.path}/${name}` : name);
  }

  async removeEntry(name: string): Promise<void> {
    await AndroidDirectoryAccess.deleteEntry({ uri: this.uri, path: this.path ? `${this.path}/${name}` : name });
  }

  async queryPermission(): Promise<PermissionState> { return 'granted'; }
  async requestPermission(): Promise<PermissionState> { return 'granted'; }
}

export interface LibraryRecord {
  id: string;
  name: string;
  root: LibraryDirectoryHandle;
  createdAt: string;
  lastScan: string;
  folderCount: number;
  fileCount: number;
  totalBytes: number;
  cover?: Blob;
}

export interface IndexedLibraryNode {
  libraryId: string;
  path: string;
  parentPath: string;
  name: string;
  kind: 'directory' | 'file';
  extension: string;
  mimeType: string;
  size: number;
  lastModified: number;
  depth: number;
  searchText?: string;
}

export interface LibraryScanProgress { libraryId: string; scanned: number; percent: number; running: boolean }

@Injectable({ providedIn: 'root' })
export class LibraryTreeService {
  private readonly config = inject(ConfigService);
  private readonly androidRootsRestored = signal(Capacitor.getPlatform() !== 'android');
  readonly libraries = signal<LibraryRecord[]>([]);
  readonly nodes = signal<IndexedLibraryNode[]>([]);
  readonly progress = signal<LibraryScanProgress | null>(null);
  readonly lastUsedLibraryId = signal('');
  readonly browserPermissionRequired = signal(false);
  private initializePromise?: Promise<void>;

  constructor() {
    effect(() => {
      if (!this.config.ready() || !this.androidRootsRestored()) return;
      this.mergeRegistry(this.config.playerLibraries());
    });
  }

  initialize(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = (async () => {
        await this.config.whenReady();
        if (Capacitor.getPlatform() === 'android') {
          const roots = await this.restoreAndroidRoots();
          this.androidRootsRestored.set(true);
          void this.rescanRestoredRoots(roots);
        } else {
          const root = await this.restoreBrowserRoot();
          if (root) {
            this.libraries.set([root]);
            this.lastUsedLibraryId.set(root.id);
            if (!this.browserPermissionRequired()) void this.rescanRestoredRoots([root]);
          }
        }
        this.mergeRegistry(this.config.playerLibraries());
      })();
    }
    return this.initializePromise;
  }

  primaryLibrary(): LibraryRecord | null {
    return this.libraries()[0] ?? null;
  }

  async addLibraryFromHandle(root: LibraryDirectoryHandle, name?: string): Promise<LibraryRecord> {
    if (root instanceof AndroidLibraryDirectoryHandle) {
      const existing = this.libraries().find(library =>
        library.root instanceof AndroidLibraryDirectoryHandle && library.root.uri === root.uri
      );
      if (existing) {
        await this.rescan(existing);
        return this.libraries().find(library => library.id === existing.id) ?? existing;
      }
    }
    const record: LibraryRecord = {
      id: crypto.randomUUID(), name: name?.trim() || root.name, root,
      createdAt: new Date().toISOString(), lastScan: '', folderCount: 0, fileCount: 0, totalBytes: 0
    };
    this.libraries.update(items => [...items, record]);
    this.persistAndroidRoots();
    if (root instanceof AndroidLibraryDirectoryHandle) void this.rememberLastUsedLibrary(record);
    await this.scan(record);
    const saved = this.libraries().find(item => item.id === record.id) ?? record;
    this.persistRegistry();
    return saved;
  }

  exportRegistry(): PlayerLibraryConfig[] {
    return this.libraries().map(library => ({
      id: library.id,
      name: library.name,
      createdAt: library.createdAt
    }));
  }

  persistRegistry(): void {
    const merged = [...this.config.playerLibraries()];
    for (const library of this.exportRegistry()) {
      if (!merged.some(item => item.id === library.id || item.name === library.name)) merged.push(library);
    }
    this.config.savePlayerLibraries(merged);
  }

  async refreshFromConfig(): Promise<void> {
    await this.config.reload();
    this.mergeRegistry(this.config.playerLibraries());
    this.persistRegistry();
  }

  async rescan(record: LibraryRecord): Promise<void> {
    await this.scan(record);
    this.persistRegistry();
  }

  async rememberLastUsedLibrary(library: LibraryRecord): Promise<void> {
    this.lastUsedLibraryId.set(library.id);
    if (library.root instanceof AndroidLibraryDirectoryHandle) {
      try { localStorage.setItem(ANDROID_LAST_ROOT_STORAGE_KEY, library.root.uri); }
      catch { this.config.message.set('No se pudo recordar la última biblioteca en este dispositivo.'); }
      return;
    }
    try { await this.storeBrowserRoot(library.root); }
    catch { this.config.message.set('El navegador no pudo guardar el acceso a la última biblioteca.'); }
  }

  async requestLastBrowserRootPermission(): Promise<boolean> {
    const library = this.libraries().find(item => item.id === this.lastUsedLibraryId());
    if (!library || library.root instanceof AndroidLibraryDirectoryHandle) return false;
    const permission = await library.root.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') return false;
    this.browserPermissionRequired.set(false);
    await this.rescan(library);
    return true;
  }

  private mergeRegistry(registry: PlayerLibraryConfig[]): void {
    if (!registry.length) return;
    const existing = new Set(this.libraries().map(library => library.name));
    const known = new Set(this.libraries().map(library => library.id));
    const missing = registry.filter(item => !known.has(item.id) && !existing.has(item.name));
    if (missing.length) {
      this.config.message.set(`Hay ${missing.length} biblioteca(s) del reproductor registradas en la configuración. Selecciona su carpeta en Settings para usarlas en este dispositivo.`);
    }
  }

  async addLibrary(): Promise<LibraryRecord | null> {
    let root: LibraryDirectoryHandle;
    if (Capacitor.getPlatform() === 'android') {
      try {
        const selected = await AndroidDirectoryAccess.pickDirectory();
        root = new AndroidLibraryDirectoryHandle(selected.uri, '', selected.name);
      } catch (error) {
        if ((error as { code?: string })?.code === 'USER_CANCELLED') return null;
        throw new Error('No se pudo seleccionar la carpeta de la biblioteca en Android.');
      }
    } else {
      const picker = (window as LibraryPickerWindow).showDirectoryPicker;
      if (!picker) throw new Error('El navegador no permite seleccionar carpetas. Usa Chrome o Edge en un contexto seguro, o crea la biblioteca en el almacenamiento del navegador.');
      root = await picker.call(window, { mode: 'readwrite' });
    }
    const permission = await root.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('Se requiere permiso de lectura y escritura.');
    return this.addLibraryFromHandle(root);
  }

  async removeLibrary(record: LibraryRecord): Promise<void> {
    this.libraries.update(items => items.filter(item => item.id !== record.id));
    this.nodes.update(items => items.filter(item => item.libraryId !== record.id));
    this.persistAndroidRoots();
    if (this.lastUsedLibraryId() === record.id) {
      const next = this.libraries()[0];
      if (next) await this.rememberLastUsedLibrary(next);
      else await this.clearLastUsedLibrary();
    }
    const remaining = this.config.playerLibraries().filter(item => item.id !== record.id && item.name !== record.name);
    for (const library of this.exportRegistry()) {
      if (!remaining.some(item => item.id === library.id || item.name === library.name)) remaining.push(library);
    }
    this.config.savePlayerLibraries(remaining);
  }

  async setCover(record: LibraryRecord, cover: Blob): Promise<void> {
    const updated = { ...record, cover };
    this.libraries.update(items => items.map(item => item.id === record.id ? updated : item));
  }

  async deleteFile(record: LibraryRecord, node: IndexedLibraryNode): Promise<void> {
    const parts = node.path.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) return;
    const parent = await this.resolveDirectory(record.root, parts);
    await parent.removeEntry(name);
    await this.rescan(record);
  }

  async getFileDetails(record: LibraryRecord, node: IndexedLibraryNode): Promise<Array<{ label: string; value: string }>> {
    const file = await this.resolveFile(record.root, node.path);
    const details = [
      { label: 'Nombre', value: file.name },
      { label: 'Ruta', value: `${record.name}/${node.path}` },
      { label: 'Tipo', value: node.mimeType || this.typeName(node.extension) },
      { label: 'Tamaño', value: `${file.size} bytes (${this.formatBytes(file.size)})` },
      { label: 'Creación', value: 'No disponible en el navegador' },
      { label: 'Modificación', value: new Date(file.lastModified).toLocaleString() },
      { label: 'Último acceso', value: 'No disponible en el navegador' }
    ];
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      try {
        const image = new Image(); image.src = url; await image.decode();
        details.push({ label: 'Resolución', value: `${image.naturalWidth} × ${image.naturalHeight}` });
      } catch { details.push({ label: 'Resolución', value: 'No disponible' }); }
      finally { URL.revokeObjectURL(url); }
      details.push({ label: 'EXIF / cámara / GPS / autor', value: 'No disponible sin lector EXIF integrado' });
    } else if (file.type.startsWith('audio/') || file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file);
      try {
        const media = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
        media.src = url;
        await new Promise<void>((resolve, reject) => {
          media.onloadedmetadata = () => resolve(); media.onerror = () => reject();
        });
        details.push({ label: 'Duración', value: `${media.duration.toFixed(1)} s` });
        if (media instanceof HTMLVideoElement) details.push({ label: 'Resolución', value: `${media.videoWidth} × ${media.videoHeight}` });
      } catch { details.push({ label: 'Metadatos multimedia', value: 'No disponibles' }); }
      finally { URL.revokeObjectURL(url); }
      details.push({ label: 'Códec / bitrate / etiquetas', value: 'No disponible sin extractor multimedia' });
    } else if (/\.(docx?|xlsx?|pptx?|pdf)$/i.test(file.name)) {
      details.push({ label: 'Metadatos de documento', value: 'El navegador no expone estos metadatos sin un lector de documentos' });
    }
    return details;
  }

  async getFile(record: LibraryRecord, node: IndexedLibraryNode): Promise<File> {
    if (node.kind !== 'file' || node.libraryId !== record.id) {
      throw new Error('El elemento seleccionado no es un archivo de esta biblioteca.');
    }
    return this.resolveFile(record.root, node.path);
  }

  async getPlaybackSource(record: LibraryRecord, node: IndexedLibraryNode): Promise<File | LibraryMediaSource> {
    if (node.kind !== 'file' || node.libraryId !== record.id) {
      throw new Error('El elemento seleccionado no es un archivo de esta biblioteca.');
    }
    if (record.root instanceof AndroidLibraryDirectoryHandle) {
      return record.root.prepareForPlayback(node.path);
    }
    return this.resolveFile(record.root, node.path);
  }

  formatBytes(size: number): string {
    if (!size) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    return `${(size / 1024 ** index).toFixed(index ? 2 : 0)} ${units[index]}`;
  }

  private async scan(record: LibraryRecord): Promise<void> {
    const queue: Array<{ directory: LibraryDirectoryHandle; parentPath: string; depth: number }> = [{ directory: record.root, parentPath: '', depth: 0 }];
    const nodes: IndexedLibraryNode[] = [];
    let folderCount = 0, fileCount = 0, totalBytes = 0, scanned = 0;
    this.progress.set({ libraryId: record.id, scanned: 0, percent: 0, running: true });
    try {
      let queueIndex = 0;
      while (queueIndex < queue.length) {
        const current = queue[queueIndex++];
        for await (const [name, entry] of current.directory.entries()) {
          if (name === '.calevri') continue;
          const path = current.parentPath ? `${current.parentPath}/${name}` : name;
          if (entry.kind === 'directory') {
            folderCount++;
            nodes.push({ libraryId: record.id, path, parentPath: current.parentPath, name, kind: 'directory', extension: '', mimeType: '', size: 0, lastModified: 0, depth: current.depth, searchText: name.toLowerCase() });
            queue.push({ directory: entry, parentPath: path, depth: current.depth + 1 });
          } else {
            const file = entry as LibraryFileHandle & { size?: number; lastModified?: number; mimeType?: string };
            const needsFallback = file.size === undefined || file.mimeType === undefined || file.lastModified === undefined;
            const fallback = needsFallback ? await entry.getFile() : null;
            const size = file.size ?? fallback?.size ?? 0;
            const mimeType = file.mimeType ?? fallback?.type ?? '';
            const lastModified = file.lastModified ?? fallback?.lastModified ?? 0;
            fileCount++; totalBytes += size;
            const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
            const searchText = `${name} ${extension} ${mimeType} ${size} ${this.formatBytes(size)} ${new Date(lastModified).toLocaleDateString()}`.toLowerCase();
            nodes.push({ libraryId: record.id, path, parentPath: current.parentPath, name, kind: 'file', extension, mimeType, size, lastModified, depth: current.depth, searchText });
          }
          scanned++;
          if (scanned % 25 === 0) {
            this.progress.set({ libraryId: record.id, scanned, percent: Math.min(95, Math.floor(scanned / (scanned + queue.length * 500 + 1) * 100)), running: true });
            await new Promise<void>(resolve => setTimeout(resolve, 0));
          }
        }
      }
      const updated: LibraryRecord = { ...record, lastScan: new Date().toISOString(), folderCount, fileCount, totalBytes };
      this.libraries.update(items => items.map(item => item.id === record.id ? updated : item));
      this.nodes.update(items => [...items.filter(item => item.libraryId !== record.id), ...nodes].sort((a, b) => a.libraryId.localeCompare(b.libraryId) || a.path.localeCompare(b.path, undefined, { numeric: true })));
      this.progress.set({ libraryId: record.id, scanned, percent: 100, running: false });
    } catch (error) {
      this.progress.set({ libraryId: record.id, scanned, percent: 0, running: false });
      throw error;
    }
  }

  private async restoreAndroidRoots(): Promise<LibraryRecord[]> {
    let persisted: string[] = [];
    let lastRootUri = '';
    try {
      const raw = localStorage.getItem(ANDROID_ROOTS_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) persisted = parsed.filter((item): item is string => typeof item === 'string');
      lastRootUri = localStorage.getItem(ANDROID_LAST_ROOT_STORAGE_KEY) ?? '';
    } catch {
      try { localStorage.removeItem(ANDROID_ROOTS_STORAGE_KEY); } catch { /* Almacenamiento bloqueado. */ }
    }

    const roots: LibraryRecord[] = [];
    for (const uri of persisted) {
      let name = 'Biblioteca';
      try { name = (await AndroidDirectoryAccess.getDirectory({ uri, path: '', create: false })).name; } catch { /* El escaneo avisará si el permiso ya no existe. */ }
      roots.push({
        id: crypto.randomUUID(), name, root: new AndroidLibraryDirectoryHandle(uri, '', name),
        createdAt: new Date().toISOString(), lastScan: '', folderCount: 0, fileCount: 0, totalBytes: 0
      });
    }
    this.libraries.set(roots);
    const lastRoot = roots.find(root => root.root instanceof AndroidLibraryDirectoryHandle && root.root.uri === lastRootUri) ?? roots[0];
    this.lastUsedLibraryId.set(lastRoot?.id ?? '');
    return roots;
  }

  private async restoreBrowserRoot(): Promise<LibraryRecord | null> {
    try {
      const root = await this.loadBrowserRoot();
      if (!root || root.kind !== 'directory') return null;
      const permission = await root.queryPermission({ mode: 'readwrite' });
      this.browserPermissionRequired.set(permission !== 'granted');
      if (permission !== 'granted') {
        this.config.message.set('Autoriza de nuevo el acceso a la última biblioteca para abrirla.');
      }
      return {
        id: crypto.randomUUID(), name: root.name, root,
        createdAt: new Date().toISOString(), lastScan: '', folderCount: 0, fileCount: 0, totalBytes: 0
      };
    } catch {
      this.browserPermissionRequired.set(true);
      this.config.message.set('No se pudo restaurar el permiso de la última biblioteca guardada por el navegador.');
      return null;
    }
  }

  private async rescanRestoredRoots(roots: LibraryRecord[]): Promise<void> {
    for (const root of roots) {
      try { await this.scan(root); }
      catch { this.config.message.set(`No se pudo recuperar el acceso a «${root.name}». Vuelve a seleccionarla en Library Tree.`); }
    }
  }

  private persistAndroidRoots(): void {
    if (Capacitor.getPlatform() !== 'android') return;
    const roots = this.libraries().flatMap(library =>
      library.root instanceof AndroidLibraryDirectoryHandle ? [library.root.persistedRoot()] : []
    );
    try { localStorage.setItem(ANDROID_ROOTS_STORAGE_KEY, JSON.stringify(roots)); }
    catch { this.config.message.set('No se pudo guardar la ruta de la biblioteca en este dispositivo.'); }
  }

  private async storeBrowserRoot(root: LibraryDirectoryHandle): Promise<void> {
    const database = await this.openBrowserRootDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(BROWSER_ROOT_STORE, 'readwrite');
        transaction.objectStore(BROWSER_ROOT_STORE).put(root, BROWSER_LAST_ROOT_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { database.close(); }
  }

  private async loadBrowserRoot(): Promise<LibraryDirectoryHandle | null> {
    const database = await this.openBrowserRootDatabase();
    try {
      return await new Promise<LibraryDirectoryHandle | null>((resolve, reject) => {
        const request = database.transaction(BROWSER_ROOT_STORE, 'readonly')
          .objectStore(BROWSER_ROOT_STORE).get(BROWSER_LAST_ROOT_KEY);
        request.onsuccess = () => resolve((request.result as LibraryDirectoryHandle | undefined) ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  }

  private async clearLastUsedLibrary(): Promise<void> {
    this.lastUsedLibraryId.set('');
    if (Capacitor.getPlatform() === 'android') {
      try { localStorage.removeItem(ANDROID_LAST_ROOT_STORAGE_KEY); } catch { /* Almacenamiento bloqueado. */ }
      return;
    }
    try {
      const database = await this.openBrowserRootDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(BROWSER_ROOT_STORE, 'readwrite');
          transaction.objectStore(BROWSER_ROOT_STORE).delete(BROWSER_LAST_ROOT_KEY);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally { database.close(); }
    } catch { /* No hay una raíz que conservar. */ }
  }

  private openBrowserRootDatabase(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB no está disponible.'));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(BROWSER_ROOT_DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(BROWSER_ROOT_STORE)) request.result.createObjectStore(BROWSER_ROOT_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('La base de datos de bibliotecas está bloqueada.'));
    });
  }

  private typeName(extension: string): string {
    const groups: Record<string, string> = {
      pdf: 'PDF', doc: 'Word', docx: 'Word', xls: 'Excel', xlsx: 'Excel', ppt: 'PowerPoint', pptx: 'PowerPoint',
      zip: 'Comprimido', rar: 'Comprimido', '7z': 'Comprimido', mp3: 'Audio', wav: 'Audio', mp4: 'Video', mov: 'Video',
      png: 'Imagen', jpg: 'Imagen', jpeg: 'Imagen', gif: 'Imagen', ts: 'Código', js: 'Código', html: 'Código', css: 'Código', txt: 'Texto'
    };
    return groups[extension] ?? 'Archivo';
  }

  private async resolveDirectory(root: LibraryDirectoryHandle, parts: string[]): Promise<LibraryDirectoryHandle> {
    let current = root;
    for (const part of parts) current = await current.getDirectoryHandle(part);
    return current;
  }

  private async resolveFile(root: LibraryDirectoryHandle, path: string): Promise<File> {
    const parts = path.split('/').filter(Boolean), fileName = parts.pop();
    if (!fileName) throw new Error('Ruta de archivo inválida');
    const directory = await this.resolveDirectory(root, parts);
    return (await directory.getFileHandle(fileName)).getFile();
  }

}
