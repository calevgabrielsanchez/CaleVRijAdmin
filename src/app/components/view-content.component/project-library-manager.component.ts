import { Component, ElementRef, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, ViewChild, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { AndroidDirectoryAccess } from '@calevrij/admin-android-directory-access';

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

class AndroidProjectFileHandle implements ProjectFileHandle {
  readonly kind = 'file' as const;

  constructor(private readonly uri: string, private readonly path: string) {}

  async getFile(): Promise<File> {
    const result = await AndroidDirectoryAccess.readFile({ uri: this.uri, path: this.path });
    const binary = atob(result.data);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
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

class AndroidProjectDirectoryHandle implements ProjectDirectoryHandle {
  readonly kind = 'directory' as const;

  constructor(readonly uri: string, private readonly path: string, readonly name: string) {}

  async *entries(): AsyncIterable<[string, ProjectDirectoryHandle | ProjectFileHandle]> {
    const { entries } = await AndroidDirectoryAccess.listDirectory({ uri: this.uri, path: this.path });
    for (const entry of entries) {
      const path = this.path ? `${this.path}/${entry.name}` : entry.name;
      const handle = entry.kind === 'directory'
        ? new AndroidProjectDirectoryHandle(this.uri, path, entry.name)
        : new AndroidProjectFileHandle(this.uri, path);
      yield [entry.name, handle];
    }
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<ProjectDirectoryHandle> {
    const path = this.path ? `${this.path}/${name}` : name;
    const result = await AndroidDirectoryAccess.getDirectory({ uri: this.uri, path, create: options?.create ?? false });
    return new AndroidProjectDirectoryHandle(this.uri, path, result.name);
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<ProjectFileHandle> {
    if (!options?.create) {
      const { entries } = await AndroidDirectoryAccess.listDirectory({ uri: this.uri, path: this.path });
      if (!entries.some(entry => entry.name === name && entry.kind === 'file')) {
        throw new DOMException(`File not found: ${name}`, 'NotFoundError');
      }
    }
    return new AndroidProjectFileHandle(this.uri, this.path ? `${this.path}/${name}` : name);
  }

  async removeEntry(name: string): Promise<void> {
    await AndroidDirectoryAccess.deleteEntry({ uri: this.uri, path: this.path ? `${this.path}/${name}` : name });
  }

  async queryPermission(): Promise<PermissionState> { return 'granted'; }
  async requestPermission(): Promise<PermissionState> { return 'granted'; }
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

interface FallbackNode { path: string; name: string; kind: 'directory' | 'file'; size: number; depth: number }

const PROJECT_ANDROID_ROOT_KEY = 'calevrij.project-library.android-root.v1';
const PROJECT_ROOT_DATABASE = 'calevrij-project-library';
const PROJECT_ROOT_STORE = 'roots';
const PROJECT_LAST_ROOT_KEY = 'last-used';

@Component({
  selector: 'app-project-library-manager',
  standalone: true,
  templateUrl: './project-library-manager.component.html',
  styleUrl: './project-library-manager.component.css',
  host: {
    '[class.active]': 'active',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'closeNodeMenu()'
  }
})
export class ProjectLibraryManagerComponent implements OnChanges, OnInit {
  @ViewChild('rootPicker') private rootPicker?: ElementRef<HTMLInputElement>;
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
  readonly fallbackMode = signal(false);
  readonly fallbackEntries = signal<FallbackNode[]>([]);
  readonly openMenuPath = signal<string | null>(null);
  readonly rootPermissionRequired = signal(false);
  private pendingBrowserRoot: ProjectDirectoryHandle | null = null;

  constructor() {}

  ngOnInit(): void { void this.restoreLastRoot(); }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['active'] && !changes['active'].currentValue) this.closeNodeMenu();
  }

  nodeMenuKey(node: ProjectLibraryNode): string {
    return node.path.join('/');
  }

  toggleNodeMenu(node: ProjectLibraryNode, event: MouseEvent): void {
    event.stopPropagation();
    const key = this.nodeMenuKey(node);
    this.openMenuPath.update(current => current === key ? null : key);
  }

  closeNodeMenu(): void {
    this.openMenuPath.set(null);
  }

  onDocumentClick(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Element && target.closest('.tree-menu, .tree-menu-button')) return;
    this.openMenuPath.set(null);
  }

  addChildFromMenu(node: ProjectLibraryNode, level: ProjectNodeLevel): void {
    this.closeNodeMenu();
    this.openCreateDialog(level, node.handle);
  }

  editNodeFromMenu(node: ProjectLibraryNode): void {
    this.closeNodeMenu();
    this.editNode(node);
  }

  manageImageFromMenu(node: ProjectLibraryNode): void {
    this.closeNodeMenu();
    void this.openImageDialog(node);
  }

  deleteNodeFromMenu(node: ProjectLibraryNode): void {
    this.closeNodeMenu();
    void this.deleteNode(node, node.parent);
  }

  async selectRoot(): Promise<void> {
    if (Capacitor.getPlatform() === 'android') {
      try {
        const selected = await AndroidDirectoryAccess.pickDirectory();
        await this.activateRoot(new AndroidProjectDirectoryHandle(selected.uri, '', selected.name));
        this.statusMessage.set('Carpeta raíz guardada con acceso de lectura y escritura.');
      } catch (error) {
        if ((error as { code?: string })?.code !== 'USER_CANCELLED') {
          this.statusMessage.set('No se pudo abrir o guardar la carpeta seleccionada.');
        }
      }
      return;
    }

    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      this.openRootFilePicker();
      return;
    }
    try {
      const handle = await picker.call(window, { mode: 'readwrite' });
      const permission = await handle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') { this.statusMessage.set('Se necesita permiso de lectura y escritura para usar esta carpeta.'); return; }
      await this.activateRoot(handle);
      this.statusMessage.set('Carpeta raíz guardada con acceso de lectura y escritura.');
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') this.statusMessage.set('No se pudo abrir o guardar la carpeta seleccionada.');
    }
  }

  private openRootFilePicker(): void {
    const input = this.rootPicker?.nativeElement;
    if (!input) {
      this.statusMessage.set('No se pudo abrir el selector de carpetas.');
      return;
    }

    this.statusMessage.set('Selecciona la carpeta raíz desde el selector del dispositivo.');
    try {
      if (typeof input.showPicker === 'function') input.showPicker();
      else input.click();
    } catch {
      // Algunos WebView no implementan showPicker; click conserva el gesto del usuario.
      input.click();
    }
  }

  private async activateRoot(handle: ProjectDirectoryHandle, label?: string): Promise<void> {
    this.rootHandle.set(handle);
    this.rootPath.set(label || handle.name);
    this.rootPermissionRequired.set(false);
    this.pendingBrowserRoot = null;
    this.fallbackMode.set(false);
    this.fallbackEntries.set([]);
    this.rootHandleChange.emit(handle);
    this.bookSelected.emit(null);
    await this.rememberRoot(handle);
    await this.refreshTree();
  }

  async authorizeSavedRoot(): Promise<void> {
    const handle = this.pendingBrowserRoot;
    if (!handle) return;
    try {
      const permission = await handle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        this.statusMessage.set('Se necesita permiso de lectura y escritura para usar esta carpeta.');
        return;
      }
      await this.activateRoot(handle);
      this.statusMessage.set('Carpeta raíz restaurada con acceso de lectura y escritura.');
    } catch {
      this.statusMessage.set('No se pudo autorizar la carpeta raíz guardada.');
    }
  }

  private async restoreLastRoot(): Promise<void> {
    if (Capacitor.getPlatform() === 'android') {
      let uri = '';
      try { uri = localStorage.getItem(PROJECT_ANDROID_ROOT_KEY) ?? ''; } catch { return; }
      if (!uri) return;
      try {
        const { name } = await AndroidDirectoryAccess.getDirectory({ uri, path: '', create: false });
        await this.activateRoot(new AndroidProjectDirectoryHandle(uri, '', name));
        this.statusMessage.set('Se restauró la última carpeta raíz.');
      } catch {
        this.statusMessage.set('No se pudo restaurar el acceso a la última carpeta raíz. Selecciónala de nuevo.');
      }
      return;
    }

    try {
      const handle = await this.loadBrowserRoot();
      if (!handle) return;
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        await this.activateRoot(handle);
        this.statusMessage.set('Se restauró la última carpeta raíz.');
      } else {
        this.pendingBrowserRoot = handle;
        this.rootPermissionRequired.set(true);
        this.statusMessage.set('El navegador requiere autorizar de nuevo la última carpeta raíz.');
      }
    } catch {
      this.statusMessage.set('No se pudo restaurar la carpeta raíz guardada por el navegador.');
    }
  }

  private async rememberRoot(handle: ProjectDirectoryHandle): Promise<void> {
    try {
      if (handle instanceof AndroidProjectDirectoryHandle) {
        localStorage.setItem(PROJECT_ANDROID_ROOT_KEY, handle.uri);
      } else {
        const database = await this.openRootDatabase();
        try {
          await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(PROJECT_ROOT_STORE, 'readwrite');
            transaction.objectStore(PROJECT_ROOT_STORE).put(handle, PROJECT_LAST_ROOT_KEY);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
          });
        } finally { database.close(); }
      }
    } catch { this.statusMessage.set('No se pudo guardar la ruta y el permiso de la carpeta raíz.'); }
  }

  private async loadBrowserRoot(): Promise<ProjectDirectoryHandle | null> {
    const database = await this.openRootDatabase();
    try {
      return await new Promise<ProjectDirectoryHandle | null>((resolve, reject) => {
        const request = database.transaction(PROJECT_ROOT_STORE, 'readonly')
          .objectStore(PROJECT_ROOT_STORE).get(PROJECT_LAST_ROOT_KEY);
        request.onsuccess = () => resolve((request.result as ProjectDirectoryHandle | undefined) ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  }

  private openRootDatabase(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB no está disponible.'));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(PROJECT_ROOT_DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(PROJECT_ROOT_STORE)) request.result.createObjectStore(PROJECT_ROOT_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('La base de datos de la biblioteca está bloqueada.'));
    });
  }

  selectRootFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;

    const firstPath = files[0].webkitRelativePath || files[0].name;
    const rootName = firstPath.split('/')[0] || 'Biblioteca';
    const entries = new Map<string, FallbackNode>();
    for (const file of files) {
      const parts = (file.webkitRelativePath || file.name).split('/').filter(Boolean).slice(1);
      let parentPath = '';
      for (let index = 0; index < parts.length; index++) {
        const name = parts[index];
        const path = parentPath ? `${parentPath}/${name}` : name;
        const isFile = index === parts.length - 1;
        if (!isFile || !entries.has(path)) {
          entries.set(path, {
            path,
            name,
            kind: isFile ? 'file' : 'directory',
            size: isFile ? file.size : 0,
            depth: index
          });
        }
        if (!isFile) parentPath = path;
      }
    }

    this.rootHandle.set(null);
    this.rootPath.set(rootName);
    this.rootPermissionRequired.set(false);
    this.pendingBrowserRoot = null;
    void this.clearRememberedRoot();
    this.libraries.set([]);
    this.fallbackMode.set(true);
    this.fallbackEntries.set([...entries.values()].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true })));
    this.rootHandleChange.emit(null);
    this.bookSelected.emit(null);
    this.statusMessage.set('Carpeta cargada en modo lectura. Para crear o editar elementos, selecciona una carpeta con permisos de escritura en un navegador compatible.');
  }

  private async clearRememberedRoot(): Promise<void> {
    if (Capacitor.getPlatform() === 'android') {
      try { localStorage.removeItem(PROJECT_ANDROID_ROOT_KEY); } catch { /* Almacenamiento bloqueado. */ }
      return;
    }
    try {
      const database = await this.openRootDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(PROJECT_ROOT_STORE, 'readwrite');
          transaction.objectStore(PROJECT_ROOT_STORE).delete(PROJECT_LAST_ROOT_KEY);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally { database.close(); }
    } catch { /* No hay una raíz que conservar. */ }
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

  private async refreshTree(): Promise<void> {
    const root = this.rootHandle();
    if (root) this.libraries.set(await this.readNodes(root, 'biblioteca'));
  }

  private async readNodes(parent: ProjectDirectoryHandle, level: ProjectNodeLevel, path: string[] = []): Promise<ProjectLibraryNode[]> {
    const next: Record<ProjectNodeLevel, ProjectNodeLevel | null> = { biblioteca: 'estante', estante: 'tema', tema: 'libro', libro: null };
    const nodes: ProjectLibraryNode[] = [];
    for await (const [name, entry] of parent.entries()) {
      if (name === '.calevri') continue;
      if (entry.kind !== 'directory') continue;
      const node: ProjectLibraryNode = { name, level, handle: entry, parent, path: [...path, name], children: [] };
      if (next[level]) node.children = await this.readNodes(entry, next[level]!, node.path);
      nodes.push(node);
    }
    return nodes.sort((a, b) => a.name.localeCompare(b.name));
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

}
