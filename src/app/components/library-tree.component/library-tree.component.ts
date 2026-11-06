import { Component, EventEmitter, Output, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { IndexedLibraryNode, LibraryRecord, LibraryTreeService } from '../../services/library-tree.service';
import type { LibraryMediaSource } from '../../services/library-tree.service';

@Component({
  selector: 'app-library-tree',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './library-tree.component.html',
  styleUrl: './library-tree.component.css'
})
export class LibraryTreeComponent {
  @Output() readonly fileSelected = new EventEmitter<File | LibraryMediaSource>();

  readonly service = inject(LibraryTreeService);
  readonly selectedId = signal('');
  readonly search = signal('');
  readonly expandedPaths = signal<Set<string>>(new Set(['']));
  readonly visibleLimit = signal(250);
  readonly message = signal('');
  readonly libraryDetailTarget = signal<LibraryRecord | null>(null);
  readonly fileDetailTarget = signal<IndexedLibraryNode | null>(null);
  readonly fileDetails = signal<Array<{ label: string; value: string }>>([]);
  readonly fileDetailsOpen = signal(false);
  readonly libraryDetailsOpen = signal(false);
  readonly coverUrls = signal<Record<string, string>>({});
  readonly visibleNodes = computed(() => {
    const nodes = this.service.nodes().filter(node => node.libraryId === this.selectedId());
    const query = this.search().trim().toLowerCase();
    if (!query) return nodes.filter(node => this.expandedPaths().has(node.parentPath));
    const matches = nodes.filter(node => (node.searchText ?? `${node.name} ${node.extension} ${node.mimeType} ${node.size}`).toLowerCase().includes(query));
    const paths = new Set<string>();
    for (const match of matches) {
      paths.add(match.path);
      let parent = match.parentPath;
      while (parent) { paths.add(parent); parent = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : ''; }
    }
    return nodes.filter(node => paths.has(node.path));
  });
  private coverTargetId = '';

  constructor() {
    void this.service.initialize().then(() => {
      const remembered = this.service.libraries().find(library => library.id === this.service.lastUsedLibraryId());
      const initial = remembered ?? this.service.libraries()[0];
      if (initial) {
        this.selectedId.set(initial.id);
        void this.service.rememberLastUsedLibrary(initial);
      }
      return this.refreshCoverUrls();
    }).catch(() => this.message.set('No se pudo cargar el índice local de bibliotecas.'));
  }

  selectedLibrary(): LibraryRecord | null { return this.service.libraries().find(item => item.id === this.selectedId()) ?? null; }
  coverUrl(library: LibraryRecord): string { return this.coverUrls()[library.id] ?? ''; }
  nodeMatches(node: IndexedLibraryNode): boolean {
    const query = this.search().trim().toLowerCase();
    return !!query && (node.searchText ?? `${node.name} ${node.extension} ${node.mimeType} ${node.size}`).toLowerCase().includes(query);
  }

  async addLibrary(): Promise<void> {
    this.message.set('');
    try {
      const library = await this.service.addLibrary();
      if (!library) return;
      this.selectedId.set(library.id);
      void this.service.rememberLastUsedLibrary(library);
      this.expandedPaths.set(new Set(['']));
      this.message.set(`Escaneo terminado: ${library.fileCount} archivos y ${library.folderCount} carpetas.`);
      await this.refreshCoverUrls();
    } catch (error) { this.message.set(error instanceof Error ? error.message : 'No se pudo agregar la biblioteca.'); }
  }

  selectLibrary(library: LibraryRecord): void {
    this.selectedId.set(library.id);
    void this.service.rememberLastUsedLibrary(library);
    this.expandedPaths.set(new Set(['']));
    this.visibleLimit.set(250);
    this.search.set('');
  }

  async requestLastLibraryPermission(): Promise<void> {
    this.message.set('');
    try {
      const granted = await this.service.requestLastBrowserRootPermission();
      this.message.set(granted ? 'Biblioteca restaurada.' : 'No se concedió el permiso para abrir la última biblioteca.');
    } catch {
      this.message.set('No se pudo volver a autorizar la última biblioteca.');
    }
  }

  async rescan(library: LibraryRecord): Promise<void> {
    this.message.set('');
    try { await this.service.rescan(library); this.message.set(`Escaneo actualizado: ${library.name}.`); }
    catch { this.message.set(`No se pudo escanear «${library.name}».`); }
  }

  async removeLibrary(library: LibraryRecord): Promise<void> {
    if (!confirm(`¿Eliminar el registro de «${library.name}»? Los archivos de la carpeta no se eliminarán.`)) return;
    await this.service.removeLibrary(library);
    if (this.selectedId() === library.id) this.selectedId.set(this.service.libraries()[0]?.id ?? '');
    this.message.set(`Se eliminó el registro de «${library.name}».`);
    await this.refreshCoverUrls();
  }

  toggleDirectory(node: IndexedLibraryNode): void {
    if (node.kind !== 'directory') return;
    const expanded = new Set(this.expandedPaths());
    if (expanded.has(node.path)) expanded.delete(node.path); else expanded.add(node.path);
    this.expandedPaths.set(expanded);
  }

  async playFile(node: IndexedLibraryNode): Promise<void> {
    if (node.kind !== 'file') return;
    const library = this.service.libraries().find(item => item.id === node.libraryId);
    if (!library) {
      this.message.set(`No se encontró la biblioteca de «${node.name}».`);
      return;
    }

    this.message.set('');
    try {
      const file = await this.service.getPlaybackSource(library, node);
      this.fileSelected.emit(file);
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : `No se pudo abrir «${node.name}».`);
    }
  }

  onFileRowKeydown(event: KeyboardEvent, node: IndexedLibraryNode): void {
    if (node.kind !== 'file' || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    void this.playFile(node);
  }

  nodeIcon(node: IndexedLibraryNode): string {
    if (node.kind === 'directory') return this.expandedPaths().has(node.path) ? '📂' : '📁';
    const ext = node.extension;
    if (ext === 'pdf') return '📕';
    if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return '🎬';
    if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) return '🎵';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return '🖼️';
    if (['doc', 'docx', 'odt'].includes(ext)) return '📘';
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return '📗';
    if (['ppt', 'pptx', 'odp'].includes(ext)) return '📙';
    if (['zip', 'rar', '7z', 'gz', 'tar'].includes(ext)) return '🗜️';
    if (['ts', 'js', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp'].includes(ext)) return '⌨️';
    if (['txt', 'md', 'log'].includes(ext)) return '📄';
    return '📃';
  }

  async showFileDetails(node: IndexedLibraryNode): Promise<void> {
    const library = this.service.libraries().find(item => item.id === node.libraryId);
    if (!library) return;
    try {
      this.fileDetailTarget.set(node);
      this.fileDetails.set(await this.service.getFileDetails(library, node));
      this.fileDetailsOpen.set(true);
    } catch { this.message.set(`No se pudieron leer los detalles de «${node.name}».`); }
  }

  async deleteFile(node: IndexedLibraryNode): Promise<void> {
    const library = this.service.libraries().find(item => item.id === node.libraryId);
    if (!library || !confirm(`¿Eliminar el archivo «${node.name}» del disco?`)) return;
    try { await this.service.deleteFile(library, node); this.message.set(`Se eliminó «${node.name}».`); }
    catch { this.message.set(`No se pudo eliminar «${node.name}».`); }
  }

  showLibraryDetails(library: LibraryRecord): void { this.libraryDetailTarget.set(library); this.libraryDetailsOpen.set(true); }

  chooseCover(library: LibraryRecord, input: HTMLInputElement): void { this.coverTargetId = library.id; input.value = ''; input.click(); }

  async saveCover(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    const library = this.service.libraries().find(item => item.id === this.coverTargetId);
    if (!file?.type.startsWith('image/') || !library) return;
    await this.service.setCover(library, file);
    await this.refreshCoverUrls();
  }

  loadMore(): void { this.visibleLimit.update(limit => limit + 250); }

  private async refreshCoverUrls(): Promise<void> {
    const next: Record<string, string> = {};
    for (const library of this.service.libraries()) if (library.cover) next[library.id] = URL.createObjectURL(library.cover);
    for (const url of Object.values(this.coverUrls())) URL.revokeObjectURL(url);
    this.coverUrls.set(next);
  }
}
