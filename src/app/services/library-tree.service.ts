import { Injectable, signal } from '@angular/core';

export interface LibraryDirectoryHandle {
  name: string;
  kind: 'directory';
  entries(): AsyncIterable<[string, LibraryDirectoryHandle | LibraryFileHandle]>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<LibraryDirectoryHandle>;
  getFileHandle(name: string): Promise<LibraryFileHandle>;
  removeEntry(name: string): Promise<void>;
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
}

export interface LibraryFileHandle {
  kind: 'file';
  getFile(): Promise<File>;
}

export interface LibraryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { mode?: 'readwrite' }) => Promise<LibraryDirectoryHandle>;
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
  readonly libraries = signal<LibraryRecord[]>([]);
  readonly nodes = signal<IndexedLibraryNode[]>([]);
  readonly progress = signal<LibraryScanProgress | null>(null);
  private dbPromise?: Promise<IDBDatabase>;
  private initializePromise?: Promise<void>;

  initialize(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = (async () => {
        const db = await this.openDb();
        const [libraries, nodes] = await Promise.all([
          this.request<LibraryRecord[]>(db.transaction('libraries').objectStore('libraries').getAll()),
          this.request<IndexedLibraryNode[]>(db.transaction('nodes').objectStore('nodes').getAll())
        ]);
        this.libraries.set(libraries);
        this.nodes.set(nodes.sort((a, b) => a.libraryId.localeCompare(b.libraryId) || a.path.localeCompare(b.path, undefined, { numeric: true })));
      })();
    }
    return this.initializePromise;
  }

  async addLibrary(): Promise<LibraryRecord | null> {
    const picker = (window as LibraryPickerWindow).showDirectoryPicker;
    if (!picker) throw new Error('El navegador no permite seleccionar carpetas. Usa Chrome o Edge en un contexto seguro.');
    const root = await picker.call(window, { mode: 'readwrite' });
    const permission = await root.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('Se requiere permiso de lectura y escritura.');
    const record: LibraryRecord = {
      id: crypto.randomUUID(), name: root.name, root,
      createdAt: new Date().toISOString(), lastScan: '', folderCount: 0, fileCount: 0, totalBytes: 0
    };
    await this.putRecord(record);
    this.libraries.update(items => [...items, record]);
    await this.scan(record);
    return this.libraries().find(item => item.id === record.id) ?? record;
  }

  async rescan(record: LibraryRecord): Promise<void> { await this.scan(record); }

  async removeLibrary(record: LibraryRecord): Promise<void> {
    const db = await this.openDb();
    await this.transaction(db, ['libraries', 'nodes'], 'readwrite', tx => {
      tx.objectStore('libraries').delete(record.id);
      const store = tx.objectStore('nodes');
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if ((cursor.value as IndexedLibraryNode).libraryId === record.id) cursor.delete();
        cursor.continue();
      };
    });
    this.libraries.update(items => items.filter(item => item.id !== record.id));
    this.nodes.update(items => items.filter(item => item.libraryId !== record.id));
  }

  async setCover(record: LibraryRecord, cover: Blob): Promise<void> {
    const updated = { ...record, cover };
    await this.putRecord(updated);
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
          const path = current.parentPath ? `${current.parentPath}/${name}` : name;
          if (entry.kind === 'directory') {
            folderCount++;
            nodes.push({ libraryId: record.id, path, parentPath: current.parentPath, name, kind: 'directory', extension: '', mimeType: '', size: 0, lastModified: 0, depth: current.depth, searchText: name.toLowerCase() });
            queue.push({ directory: entry, parentPath: path, depth: current.depth + 1 });
          } else {
            const file = await entry.getFile();
            fileCount++; totalBytes += file.size;
            const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
            const searchText = `${name} ${extension} ${file.type} ${file.size} ${this.formatBytes(file.size)} ${new Date(file.lastModified).toLocaleDateString()}`.toLowerCase();
            nodes.push({ libraryId: record.id, path, parentPath: current.parentPath, name, kind: 'file', extension, mimeType: file.type, size: file.size, lastModified: file.lastModified, depth: current.depth, searchText });
          }
          scanned++;
          if (scanned % 250 === 0) {
            this.progress.set({ libraryId: record.id, scanned, percent: Math.min(95, Math.floor(scanned / (scanned + queue.length * 500 + 1) * 100)), running: true });
            await new Promise<void>(resolve => setTimeout(resolve, 0));
          }
        }
      }
      const db = await this.openDb();
      await this.transaction(db, ['nodes'], 'readwrite', tx => {
        const store = tx.objectStore('nodes');
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            for (const node of nodes) store.put(node);
            return;
          }
          if ((cursor.value as IndexedLibraryNode).libraryId === record.id) cursor.delete();
          cursor.continue();
        };
      });
      const updated: LibraryRecord = { ...record, lastScan: new Date().toISOString(), folderCount, fileCount, totalBytes };
      await this.putRecord(updated);
      this.libraries.update(items => items.map(item => item.id === record.id ? updated : item));
      this.nodes.update(items => [...items.filter(item => item.libraryId !== record.id), ...nodes].sort((a, b) => a.libraryId.localeCompare(b.libraryId) || a.path.localeCompare(b.path, undefined, { numeric: true })));
      this.progress.set({ libraryId: record.id, scanned, percent: 100, running: false });
    } catch (error) {
      this.progress.set({ libraryId: record.id, scanned, percent: 0, running: false });
      throw error;
    }
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

  private async putRecord(record: LibraryRecord): Promise<void> {
    const db = await this.openDb();
    await this.transaction(db, ['libraries'], 'readwrite', tx => tx.objectStore('libraries').put(record));
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('calevri-library-tree', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('libraries')) db.createObjectStore('libraries', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('nodes')) db.createObjectStore('nodes', { keyPath: ['libraryId', 'path'] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.dbPromise;
  }

  private request<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private transaction(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      action(tx);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}
