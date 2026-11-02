import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

export interface ProjectFileHandle {
  kind: 'file';
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void> }>;
}

export interface ProjectDirectoryHandle {
  name: string;
  kind: 'directory';
  entries(): AsyncIterable<[string, ProjectDirectoryHandle | ProjectFileHandle]>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<ProjectDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<ProjectFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { mode?: 'readwrite' }) => Promise<ProjectDirectoryHandle>;
}

export type ProjectNodeLevel = 'biblioteca' | 'estante' | 'tema' | 'libro';
export interface ProjectLibraryNode {
  name: string;
  level: ProjectNodeLevel;
  handle: ProjectDirectoryHandle;
  parent: ProjectDirectoryHandle;
  path: string[];
  children: ProjectLibraryNode[];
}

@Component({
  selector: 'app-project-library-manager',
  standalone: true,
  templateUrl: './project-library-manager.component.html',
  styleUrl: './project-library-manager.component.css',
  host: { '[class.active]': 'active' }
})
export class ProjectLibraryManagerComponent {
  @Input() active = false;
  @Output() readonly bookSelected = new EventEmitter<ProjectLibraryNode | null>();
  @Output() readonly rootHandleChange = new EventEmitter<ProjectDirectoryHandle | null>();

  readonly rootHandle = signal<ProjectDirectoryHandle | null>(null);
  readonly rootPath = signal('');
  readonly libraries = signal<ProjectLibraryNode[]>([]);
  readonly modalOpen = signal(false);
  readonly libraryName = signal('');
  readonly libraryDetails = signal('');
  readonly statusMessage = signal('');
  readonly modalLevel = signal<ProjectNodeLevel>('biblioteca');
  readonly modalParent = signal<ProjectDirectoryHandle | null>(null);
  readonly editingNode = signal<ProjectLibraryNode | null>(null);
  readonly imageTarget = signal<ProjectLibraryNode | null>(null);
  readonly imageDialogOpen = signal(false);
  readonly imagePreviewUrl = signal('');
  readonly currentImageName = signal('');

  constructor() { void this.restoreRoot(); }

  async selectRoot(): Promise<void> {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      this.statusMessage.set('La selección de carpetas requiere un navegador compatible (Chrome o Edge) y conexión segura.');
      return;
    }
    try {
      const handle = await picker.call(window, { mode: 'readwrite' });
      const permission = await handle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') { this.statusMessage.set('Se necesita permiso de lectura y escritura para usar esta carpeta.'); return; }
      this.rootHandle.set(handle);
      this.rootPath.set(handle.name);
      this.rootHandleChange.emit(handle);
      this.bookSelected.emit(null);
      await this.setSetting('root', handle);
      await this.setSetting('lastBookPath', null);
      await this.refreshTree();
      this.statusMessage.set('Carpeta raíz guardada con acceso de lectura y escritura.');
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') this.statusMessage.set('No se pudo abrir o guardar la carpeta seleccionada.');
    }
  }

  openCreateDialog(level: ProjectNodeLevel, parent: ProjectDirectoryHandle): void {
    this.modalLevel.set(level); this.modalParent.set(parent); this.editingNode.set(null);
    this.libraryName.set(''); this.libraryDetails.set(''); this.modalOpen.set(true);
  }

  editNode(node: ProjectLibraryNode): void {
    this.modalLevel.set(node.level); this.modalParent.set(null); this.editingNode.set(node);
    this.libraryName.set(node.name); this.libraryDetails.set('');
    void node.handle.getFileHandle('detalles.txt').then(handle => handle.getFile()).then(file => file.text()).then(text => this.libraryDetails.set(text)).catch(() => undefined);
    this.modalOpen.set(true);
  }

  async saveNode(): Promise<void> {
    const parent = this.modalParent(), editing = this.editingNode(), name = this.libraryName().trim();
    if ((!parent && !editing) || !name) return;
    if (/[\\/:*?"<>|]/.test(name) || name === '.' || name === '..') { this.statusMessage.set('El nombre contiene caracteres no permitidos.'); return; }
    try {
      const destinationParent = editing?.parent ?? parent!;
      if (name !== editing?.name) for await (const [existingName] of destinationParent.entries()) {
        if (existingName === name) { this.statusMessage.set(`Ya existe un elemento llamado «${name}».`); return; }
      }
      let folder: ProjectDirectoryHandle;
      if (editing && name !== editing.name) {
        folder = await this.renameFolder(editing.handle, editing.parent, name);
        editing.name = name; editing.handle = folder;
      } else if (editing) folder = editing.handle;
      else folder = await parent!.getDirectoryHandle(name, { create: true });
      const file = await folder.getFileHandle('detalles.txt', { create: true });
      const writer = await file.createWritable(); await writer.write(this.libraryDetails()); await writer.close();
      await this.refreshTree(); this.modalOpen.set(false);
      this.statusMessage.set(editing ? `Se actualizó «${name}».` : `Se creó «${name}».`);
    } catch { this.statusMessage.set('No se pudo crear la biblioteca. Comprueba los permisos de escritura.'); }
  }

  async deleteNode(node: ProjectLibraryNode, parent: ProjectDirectoryHandle): Promise<void> {
    if (!confirm(`¿Eliminar «${node.name}» y todo su contenido?`)) return;
    try { await parent.removeEntry(node.name, { recursive: true }); await this.refreshTree(); this.statusMessage.set(`Se eliminó «${node.name}».`); }
    catch { this.statusMessage.set('No se pudo eliminar el elemento.'); }
  }

  async openImageDialog(node: ProjectLibraryNode): Promise<void> {
    this.imageTarget.set(node); this.currentImageName.set(''); this.setImagePreview(''); this.imageDialogOpen.set(true);
    try {
      for await (const [name, entry] of node.handle.entries()) {
        if (entry.kind !== 'file') continue;
        const file = await entry.getFile();
        if (file.type.startsWith('image/')) { this.currentImageName.set(name); this.setImagePreview(URL.createObjectURL(file)); return; }
      }
    } catch { this.statusMessage.set('No se pudo leer la imagen guardada.'); }
  }

  selectReplacement(input: HTMLInputElement): void { input.value = ''; input.click(); }

  async saveImage(event: Event): Promise<void> {
    const image = (event.target as HTMLInputElement).files?.[0], node = this.imageTarget();
    if (!image || !node) return;
    if (!image.type.startsWith('image/')) { this.statusMessage.set('Selecciona un archivo de imagen válido.'); return; }
    try {
      const previousName = this.currentImageName();
      if (previousName && previousName !== image.name) await node.handle.removeEntry(previousName);
      const file = await node.handle.getFileHandle(image.name, { create: true });
      const writer = await file.createWritable(); await writer.write(image); await writer.close();
      this.currentImageName.set(image.name); this.setImagePreview(URL.createObjectURL(image));
      this.statusMessage.set(`Imagen guardada en «${node.name}».`);
    } catch { this.statusMessage.set('No se pudo guardar la imagen.'); }
  }

  async deleteImage(): Promise<void> {
    const node = this.imageTarget(), name = this.currentImageName();
    if (!node || !name) return;
    try { await node.handle.removeEntry(name); this.currentImageName.set(''); this.setImagePreview(''); this.statusMessage.set(`Se eliminó la imagen de «${node.name}».`); }
    catch { this.statusMessage.set('No se pudo eliminar la imagen.'); }
  }

  closeImageDialog(): void { this.imageDialogOpen.set(false); this.setImagePreview(''); this.imageTarget.set(null); }

  private setImagePreview(url: string): void {
    const oldUrl = this.imagePreviewUrl();
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    this.imagePreviewUrl.set(url);
  }

  private async restoreRoot(): Promise<void> {
    try {
      const handle = await this.getSetting<ProjectDirectoryHandle>('root');
      if (!handle) return;
      let permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') permission = await handle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') { this.statusMessage.set('Vuelve a seleccionar la carpeta raíz para conceder acceso.'); return; }
      this.rootHandle.set(handle); this.rootPath.set(handle.name); this.rootHandleChange.emit(handle); await this.refreshTree();
      const lastPath = await this.getSetting<string[]>('lastBookPath');
      const lastBook = lastPath ? this.findBookByPath(lastPath) : null;
      if (lastBook) this.bookSelected.emit(lastBook);
    } catch { /* IndexedDB o la API de archivos pueden no estar disponibles. */ }
  }

  private async refreshTree(): Promise<void> {
    const root = this.rootHandle();
    if (root) this.libraries.set(await this.readNodes(root, 'biblioteca'));
  }

  private async readNodes(parent: ProjectDirectoryHandle, level: ProjectNodeLevel, path: string[] = []): Promise<ProjectLibraryNode[]> {
    const next: Record<ProjectNodeLevel, ProjectNodeLevel | null> = { biblioteca: 'estante', estante: 'tema', tema: 'libro', libro: null };
    const nodes: ProjectLibraryNode[] = [];
    for await (const [name, entry] of parent.entries()) {
      if (entry.kind !== 'directory') continue;
      const node: ProjectLibraryNode = { name, level, handle: entry, parent, path: [...path, name], children: [] };
      if (next[level]) node.children = await this.readNodes(entry, next[level]!, node.path);
      nodes.push(node);
    }
    return nodes.sort((a, b) => a.name.localeCompare(b.name));
  }

  private findBookByPath(path: string[]): ProjectLibraryNode | null {
    let candidates = this.libraries();
    let match: ProjectLibraryNode | undefined;
    for (const name of path) { match = candidates.find(node => node.name === name); if (!match) return null; candidates = match.children; }
    return match?.level === 'libro' ? match : null;
  }

  private async renameFolder(oldFolder: ProjectDirectoryHandle, parent: ProjectDirectoryHandle, newName: string): Promise<ProjectDirectoryHandle> {
    const target = await parent.getDirectoryHandle(newName, { create: true });
    await this.copyContents(oldFolder, target); await parent.removeEntry(oldFolder.name, { recursive: true });
    return target;
  }

  private async copyContents(source: ProjectDirectoryHandle, destination: ProjectDirectoryHandle): Promise<void> {
    for await (const [name, entry] of source.entries()) {
      if (entry.kind === 'directory') { const child = await destination.getDirectoryHandle(name, { create: true }); await this.copyContents(entry, child); }
      else { const file = await entry.getFile(), copy = await destination.getFileHandle(name, { create: true }); const writer = await copy.createWritable(); await writer.write(file); await writer.close(); }
    }
  }

  private async setSetting<T>(key: string, value: T): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put(value, key);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  private async getSetting<T>(key: string): Promise<T | null> {
    const db = await this.openDb();
    const result = await new Promise<T | null>((resolve, reject) => {
      const request = db.transaction('settings').objectStore('settings').get(key);
      request.onsuccess = () => resolve(request.result ?? null); request.onerror = () => reject(request.error);
    });
    db.close(); return result;
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('calevri-admin', 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('settings')) request.result.createObjectStore('settings'); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
}
