import { ChangeDetectionStrategy, Component, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { TextPlusComponent } from './components/text-plus.component/text-plus.component';
import { LibraryTreeComponent } from './components/library-tree.component/library-tree.component';
import { MainMenuComponent } from './components/main-menu.component/main-menu.component';
import { CellFormat, SheetData, SpreadsheetSectionComponent, SpreadsheetViewModel } from './components/spreadsheet-section.component/spreadsheet-section.component';
import { ReproductorComponent } from './components/reproductor-section.component/reproductor.component';
import { DataSectionComponent } from './components/data-section.component';
import { SettingsComponent } from './components/settings/settings.component';
import { ViewContentComponent, ViewContentMode } from './components/view-content.component/view-content.component';
import { ProjectDirectoryHandle as DirectoryHandle, ProjectLibraryManagerComponent, ProjectLibraryNode as TreeNode } from './components/view-content.component/project-library-manager.component';
import { CreatividadComponent } from './components/creatividad.component/creatividad.component';
import { CreatividadNuevaComponent } from './components/menu.creatividad.component/creatividad-nueva.component';
import { ConfigService } from './services/config.service';
import { LibraryTreeService } from './services/library-tree.service';
import { CloudLibrarySyncService } from './services/cloud-library-sync.service';
import { P2PSyncService } from './components/settings/p2p-sync.service';
import type { LibraryMediaSource } from './services/library-tree.service';

interface AppSection {
  key: string;
  label: string;
  icon: string;
  title: string;
  description: string;
  cardTitle: string;
  cardText: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [TextPlusComponent, LibraryTreeComponent, MainMenuComponent, SpreadsheetSectionComponent, ReproductorComponent, DataSectionComponent, SettingsComponent, ViewContentComponent, ProjectLibraryManagerComponent, CreatividadComponent, CreatividadNuevaComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  @ViewChild(TextPlusComponent) private textPlusInstance?: TextPlusComponent;
  @ViewChild(CreatividadComponent) private creatividadInstance?: CreatividadComponent;
  private readonly config = inject(ConfigService);
  private readonly sync = inject(P2PSyncService);
  readonly cloudLibrarySync = inject(CloudLibrarySyncService);
  readonly loadingMessage = computed(() => {
    if (this.cloudLibrarySync.manualSyncing()) return 'Sincronizando la biblioteca de libros con Supabase…';
    if (this.sync.syncing()) return 'Sincronizando bibliotecas…';
    if (this.bookLoading()) return `Cargando libro «${this.loadingBookName()}»…`;
    const scan = this.libraryTree.progress();
    if (scan?.running) return `Cargando biblioteca… ${scan.scanned} elementos (${scan.percent}%)`;
    return '';
  });
  readonly syncDialogOpen = signal(false);
  readonly syncDialogMessage = computed(() => this.cloudLibrarySync.manualSyncing()
    ? this.cloudLibrarySync.status()
    : this.cloudLibrarySync.result());
  readonly syncDialogActive = computed(() => this.cloudLibrarySync.manualSyncing() || !this.cloudLibrarySync.completed());
  readonly syncProgress = computed(() => this.cloudLibrarySync.progress());
  private readonly libraryTree = inject(LibraryTreeService);
  readonly appName = 'CaleVRijAdmin';
  readonly version = 'v1.2.1';
  readonly sections: readonly AppSection[] = [
    { key: 'inicio', label: 'Libro', icon: '▤', title: 'Libro', description: 'Abre un libro desde el árbol de bibliotecas para editar sus hojas.', cardTitle: 'Tus hojas', cardText: 'Cada libro conserva sus celdas, formatos y hojas.' },
    { key: 'reproductor', label: 'Reproductor', icon: '⏯', title: 'Reproductor', description: 'Reproductor multimedia.', cardTitle: 'Reproducción', cardText: 'Controles y contenido multimedia.' },
    { key: 'mente', label: 'Mente', icon: '♠', title: 'Mente', description: 'Organiza personalidades, valores, miedos y emociones.', cardTitle: 'Mente', cardText: 'Datos guardados localmente dentro de la raíz de biblioteca.' },
    { key: 'settings', label: 'Settings', icon: '⚙', title: 'Settings', description: 'Configuración y sincronización de bibliotecas.', cardTitle: 'Sincronización P2P', cardText: 'Sincroniza los archivos de la biblioteca directamente entre dispositivos.' }
   
  ];
  readonly activeKey = signal('status');
  readonly menuReturnKey = signal(this.sections[0].key);
  readonly activeSection = computed(() => this.sections.find((section) => section.key === this.activeKey()) ?? this.sections[0]);
  readonly navigationCurrentKey = computed(() => {
    const active = this.activeKey();
    const remembered = this.menuReturnKey() === 'libro' ? 'inicio' : this.menuReturnKey();
    const key = ['status', 'menu', 'library-tree'].includes(active) ? remembered : active;
    return this.sections.some(section => section.key === key) ? key : this.sections[0].key;
  });
  readonly activeIndex = computed(() => this.sections.findIndex((section) => section.key === this.activeKey()));
  readonly viewContentMode = computed<ViewContentMode>(() => this.activeKey() === 'inicio' || this.activeKey() === 'libro' ? 'spreadsheet' : this.activeKey() === 'library-tree' ? 'library-tree' : this.activeKey() === 'reproductor' ? 'player' : this.activeKey() === 'settings' ? 'settings' : 'standard');
  readonly paused = signal(false);
  readonly creatividadNuevaVisible = signal(false);
  readonly actionMessage = signal('');
  readonly selectedLibraryFile = signal<File | LibraryMediaSource | null>(null);
  readonly currentPlayerFileName = signal('');
  columns = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));
  rowNumbers = Array.from({ length: 50 }, (_, index) => index + 1);
  readonly clipboardMessage = signal('');
  readonly sheets = signal<SheetData[]>([{ name: 'Hoja 1', cells: {}, extraTexts: {}, formats: {}, merges: {}, columnWidths: {}, rowHeights: {} }]);
  readonly currentSheetIndex = signal(0);
  readonly currentBook = signal<TreeNode | null>(null);
  readonly bookLoading = signal(false);
  readonly loadingBookName = signal('');
  private bookOpenRequest = 0;
  readonly projectLibraryRoot = signal<DirectoryHandle | null>(null);
  readonly selectionAnchor = signal<[number, number]>([0, 0]);
  readonly selectionEnd = signal<[number, number]>([0, 0]);
  readonly backgroundColor = signal('#ffffff');
  readonly textColor = signal('#000000');
  readonly spreadsheetVm = computed<SpreadsheetViewModel>(() => ({
    columns: this.columns,
    rowNumbers: this.rowNumbers,
    sheets: this.sheets(),
    currentSheetIndex: this.currentSheetIndex(),
    isWorkbook: this.activeKey() === 'none',
    backgroundColor: this.backgroundColor(),
    textColor: this.textColor(),
    cellValue: (row, col) => this.cellValue(row, col),
    cellFormat: (row, col) => this.cellFormat(row, col),
    columnWidth: col => this.columnWidth(col),
    rowHeight: row => this.rowHeight(row),
    isCellSelected: (row, col) => this.isCellSelected(row, col),
    mergedRange: (row, col) => this.mergedRange(row, col),
    isCoveredCell: (row, col) => this.isCoveredCell(row, col),
    hasCellExtraText: (row, col) => this.hasCellExtraText(row, col),
    selectedCellText: () => this.selectedCellText(),
    pasteFromClipboard: () => this.pasteFromClipboard(),
    clipboardMessage: () => this.clipboardMessage(),
    saveAndMoveCell: (value, direction) => this.saveAndMoveCell(value, direction),
    startResize: (axis, index, event) => this.startResize(axis, index, event),
    resizeDimension: event => this.resizeDimension(event),
    stopResize: () => this.stopResize(),
    mergeSelection: () => this.mergeSelection(),
    unmergeSelection: () => this.unmergeSelection(),
    formatSelection: change => this.formatSelection(change),
    selectCell: (row, col, event) => this.selectCell(row, col, event),
    updateSelectedCellText: event => this.updateSelectedCellText(event),
    openTextPlus: () => this.openTextPlus(),
    selectSheet: index => this.selectSheet(index),
    addSheet: () => this.addSheet(),
    removeSheet: () => { void this.removeSheet(); },
    updateSheetProperties: (name, details) => this.updateSheetProperties(name, details),
    updateBackground: event => {
      const value = (event.target as HTMLInputElement).value;
      this.backgroundColor.set(value); this.formatSelection({ background: value });
    },
    updateTextColor: event => {
      const value = (event.target as HTMLInputElement).value;
      this.textColor.set(value); this.formatSelection({ color: value });
    }
  }));
  readonly textPlusOpen = signal(false);
  textPlusContent = '';
  private textPlusTarget: [number, number] = [0, 0];
  private resizeState: { axis: 'column' | 'row'; index: number; start: number; size: number } | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor() {
    effect(() => {
      if (this.cloudLibrarySync.manualSyncing()) this.syncDialogOpen.set(true);
    });
    void this.libraryTree.initialize().then(() => {
      if (this.activeKey() === this.sections[0].key && this.libraryTree.lastUsedLibraryId()) {
        this.activeKey.set('library-tree');
      }
    });
  }

  acceptSyncDialog(): void {
    if (this.cloudLibrarySync.completed()) this.syncDialogOpen.set(false);
  }

  navigate(key: string): void {
    if (this.sections.some((section) => section.key === key)) {
      this.creatividadNuevaVisible.set(false);
      if (key === 'library-tree') {
        if (this.activeKey() !== 'menu' && this.activeKey() !== 'library-tree') this.menuReturnKey.set(this.activeKey());
      } else this.menuReturnKey.set(key);
      if (key !== 'reproductor') this.currentPlayerFileName.set('');
      this.activeKey.set(key);
      this.actionMessage.set('');
    }
  }

  openStatus(): void {
    const active = this.activeKey();
    if (active === 'mente') {
      this.menuReturnKey.set('mente');
      this.creatividadNuevaVisible.set(true);
      this.activeKey.set('status');
    } else if (active === 'reproductor') {
      this.currentPlayerFileName.set('');
      this.menuReturnKey.set('reproductor');
      this.activeKey.set('library-tree');
    } else if (active === 'menu' || active === 'library-tree' || active === 'status') {
      if (active === 'status' && this.creatividadNuevaVisible()) this.creatividadNuevaVisible.set(false);
      this.activeKey.set(this.menuReturnKey() || this.sections[0].key);
    } else if (active === 'inicio' || active === 'libro') {
      this.menuReturnKey.set(active);
      this.activeKey.set('status');
    } else {
      this.menuReturnKey.set(active);
      this.activeKey.set('status');
    }
    this.actionMessage.set('');
  }

  onProjectBookSelected(book: TreeNode | null): void {
    if (!book) { this.currentBook.set(null); return; }
    void this.openBook(book);
  }

  setProjectLibraryRoot(root: DirectoryHandle | null): void {
    this.projectLibraryRoot.set(root);
    void this.config.configure(root);
    void this.cloudLibrarySync.setRoot(root);
  }

  playLibraryFile(file: File | LibraryMediaSource): void {
    this.selectedLibraryFile.set(file);
    this.currentPlayerFileName.set(file.name);
    this.menuReturnKey.set('reproductor');
    this.activeKey.set('reproductor');
  }

  playReferencedMedia(file: File | LibraryMediaSource): void {
    this.textPlusOpen.set(false);
    this.playLibraryFile(file);
  }

  readonly flushCreatividadStorage = async (): Promise<void> => {
    await this.creatividadInstance?.flushBeforeSync();
  };

  setCurrentPlayerFileName(name: string): void {
    this.currentPlayerFileName.set(name);
  }

  clearSelectedLibraryFile(): void {
    this.selectedLibraryFile.set(null);
  }

  runExampleAction(): void {
    this.actionMessage.set(`Acción ejecutada en «${this.activeSection().label}».`);
  }

  currentSheet(): SheetData { return this.sheets()[this.currentSheetIndex()]; }

  selectSheet(index: number): void {
    this.currentSheetIndex.set(index);
    this.scheduleWorkbookSave();
  }

  cellKey(row: number, col: number): string { return `${row}:${col}`; }

  cellValue(row: number, col: number): string { return this.currentSheet()?.cells[this.cellKey(row, col)] ?? ''; }

  cellExtraText(row: number, col: number): string { return this.currentSheet()?.extraTexts[this.cellKey(row, col)] ?? ''; }

  hasCellExtraText(row: number, col: number): boolean { return Boolean(this.cellExtraText(row, col)); }

  cellFormat(row: number, col: number): CellFormat { return this.currentSheet()?.formats[this.cellKey(row, col)] ?? {}; }

  columnWidth(col: number): number { return this.currentSheet()?.columnWidths[col] ?? 80; }

  rowHeight(row: number): number { return this.currentSheet()?.rowHeights[row] ?? 28; }

  startResize(axis: 'column' | 'row', index: number, event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.resizeState = {
      axis,
      index,
      start: axis === 'column' ? event.clientX : event.clientY,
      size: axis === 'column' ? this.columnWidth(index) : this.rowHeight(index)
    };
  }

  resizeDimension(event: PointerEvent): void {
    if (!this.resizeState) return;
    const { axis, index, start, size } = this.resizeState;
    const delta = (axis === 'column' ? event.clientX : event.clientY) - start;
    const nextSize = Math.max(axis === 'column' ? 42 : 20, Math.min(axis === 'column' ? 400 : 120, size + delta));
    this.updateCurrentSheet(sheet => {
      if (axis === 'column') sheet.columnWidths[index] = nextSize;
      else sheet.rowHeights[index] = nextSize;
    });
  }

  stopResize(): void { this.resizeState = null; }

  isCellSelected(row: number, col: number): boolean {
    const [ar, ac] = this.selectionAnchor();
    const [br, bc] = this.selectionEnd();
    return row >= Math.min(ar, br) && row <= Math.max(ar, br) && col >= Math.min(ac, bc) && col <= Math.max(ac, bc);
  }

  selectCell(row: number, col: number, event: { shiftKey: boolean }): void {
    if (event.shiftKey) this.selectionEnd.set([row, col]);
    else { this.selectionAnchor.set([row, col]); this.selectionEnd.set([row, col]); }
  }

  selectedCellText(): string {
    const [row, col] = this.selectionEnd();
    return this.cellValue(row, col);
  }

  updateSelectedCellText(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    const [row, col] = this.selectionEnd();
    this.updateCurrentSheet(sheet => { sheet.cells[this.cellKey(row, col)] = value; });
  }

  saveAndMoveCell(value: string, direction: 'vertical' | 'horizontal'): void {
    const [row, col] = this.selectionEnd();
    // Commit the current editor value and queue the normal debounced file save before moving.
    this.updateCurrentSheet(sheet => { sheet.cells[this.cellKey(row, col)] = value; });

    let nextRow = row;
    let nextCol = col;
    if (direction === 'vertical') nextRow = Math.min(this.rowNumbers.length - 1, row + 1);
    else nextCol = Math.min(this.columns.length - 1, col + 1);
    this.selectionAnchor.set([nextRow, nextCol]);
    this.selectionEnd.set([nextRow, nextCol]);
  }

  openTextPlus(): void {
    this.textPlusTarget = [...this.selectionEnd()];
    this.textPlusContent = this.cellExtraText(...this.textPlusTarget);
    this.textPlusOpen.set(true);
  }

  closeTextPlus(): void { this.textPlusOpen.set(false); }

  acceptTextPlus(text?: string): void {
    const [row, col] = this.textPlusTarget;
    const value = text ?? this.textPlusInstance?.textoArea ?? this.textPlusContent;
    this.updateCurrentSheet(sheet => { sheet.extraTexts[this.cellKey(row, col)] = value; });
    this.textPlusOpen.set(false);
  }

  formatSelection(change: Partial<CellFormat>): void {
    const [ar, ac] = this.selectionAnchor(); const [br, bc] = this.selectionEnd();
    this.updateCurrentSheet(sheet => {
      for (let row = Math.min(ar, br); row <= Math.max(ar, br); row++) for (let col = Math.min(ac, bc); col <= Math.max(ac, bc); col++) {
        const key = this.cellKey(row, col);
        sheet.formats[key] = { ...sheet.formats[key], ...change };
      }
    });
  }

  mergeSelection(): void {
    const [ar, ac] = this.selectionAnchor(); const [br, bc] = this.selectionEnd();
    let startRow = Math.min(ar, br), endRow = Math.max(ar, br);
    let startCol = Math.min(ac, bc), endCol = Math.max(ac, bc);
    if (startRow === endRow && startCol === endCol) return;

    this.updateCurrentSheet(sheet => {
      let expanded: boolean;
      do {
        expanded = false;
        for (const [key, range] of Object.entries(sheet.merges)) {
          const [mergeStartRow, mergeStartCol] = key.split(':').map(Number);
          const intersects = startRow <= range.endRow && endRow >= mergeStartRow
            && startCol <= range.endCol && endCol >= mergeStartCol;
          if (!intersects) continue;

          const nextStartRow = Math.min(startRow, mergeStartRow);
          const nextEndRow = Math.max(endRow, range.endRow);
          const nextStartCol = Math.min(startCol, mergeStartCol);
          const nextEndCol = Math.max(endCol, range.endCol);
          expanded ||= nextStartRow !== startRow || nextEndRow !== endRow
            || nextStartCol !== startCol || nextEndCol !== endCol;
          startRow = nextStartRow;
          endRow = nextEndRow;
          startCol = nextStartCol;
          endCol = nextEndCol;
          delete sheet.merges[key];
        }
      } while (expanded);

      sheet.merges[this.cellKey(startRow, startCol)] = { endRow, endCol };
    });
  }

  unmergeSelection(): void {
    const [row, col] = this.selectionAnchor();
    this.updateCurrentSheet(sheet => {
      const key = this.cellKey(row, col);
      if (sheet.merges[key]) { delete sheet.merges[key]; return; }
      for (const [mergeKey, range] of Object.entries(sheet.merges)) {
        const [startRow, startCol] = mergeKey.split(':').map(Number);
        if (row >= startRow && row <= range.endRow && col >= startCol && col <= range.endCol) delete sheet.merges[mergeKey];
      }
    });
  }

  mergedRange(row: number, col: number): { rowSpan: number; colSpan: number } | null {
    const merge = this.currentSheet()?.merges[this.cellKey(row, col)];
    return merge ? { rowSpan: merge.endRow - row + 1, colSpan: merge.endCol - col + 1 } : null;
  }

  isCoveredCell(row: number, col: number): boolean {
    for (const [key, range] of Object.entries(this.currentSheet()?.merges ?? {})) {
      const [startRow, startCol] = key.split(':').map(Number);
      if (row >= startRow && row <= range.endRow && col >= startCol && col <= range.endCol
        && (row !== startRow || col !== startCol)) return true;
    }
    return false;
  }

  addSheet(): void {
    const occupiedNames = new Set(this.sheets().flatMap(sheet => [sheet.name, sheet.storageFolderName ?? sheet.name].map(name => name.toLocaleLowerCase())));
    let next = 1;
    while (occupiedNames.has(`hoja ${next}`.toLocaleLowerCase())) next++;
    this.sheets.update(sheets => [...sheets, { name: `Hoja ${next}`, storageFolderName: `Hoja ${next}`, cells: {}, extraTexts: {}, formats: {}, merges: {}, columnWidths: {}, rowHeights: {} }]);
    this.currentSheetIndex.set(this.sheets().length - 1);
    this.selectionAnchor.set([0, 0]); this.selectionEnd.set([0, 0]);
    this.scheduleWorkbookSave();
  }

  async removeSheet(): Promise<void> {
    if (this.sheets().length <= 1) return;
    try { await this.flushWorkbookSave(); } catch { /* Se conserva la eliminación elegida aunque falle el guardado anterior. */ }
    const removedSheet = this.sheets()[this.currentSheetIndex()];
    const book = this.currentBook();
    this.sheets.update(sheets => sheets.filter((_, index) => index !== this.currentSheetIndex()));
    this.currentSheetIndex.set(Math.max(0, this.currentSheetIndex() - 1));
    if (book) {
      const folderName = removedSheet.storageFolderName ?? removedSheet.name;
      try {
        const folder = await book.handle.getDirectoryHandle(folderName);
        await this.cloudLibrarySync.markDeleted(folder, folderName);
        await book.handle.removeEntry(folderName, { recursive: true });
      } catch {
        this.actionMessage.set(`No se pudo eliminar de forma permanente la carpeta de «${removedSheet.name}».`);
      }
    }
    this.scheduleWorkbookSave();
  }

  updateSheetProperties(name: string, details: string): string | null {
    const trimmedName = name.trim();
    const sheet = this.sheets()[this.currentSheetIndex()];
    if (!sheet) return 'No hay una hoja seleccionada.';
    if (!trimmedName) return 'El nombre de la hoja es obligatorio.';
    if (/[\\/:*?"<>|]/.test(trimmedName) || trimmedName === '.' || trimmedName === '..') {
      return 'El nombre contiene caracteres no permitidos.';
    }
    if (this.sheets().some((item, index) => index !== this.currentSheetIndex() && item.name.toLowerCase() === trimmedName.toLowerCase())) {
      return 'Ya existe otra hoja con ese nombre.';
    }
    this.sheets.update(items => items.map((item, index) => index === this.currentSheetIndex()
      ? { ...item, name: trimmedName, details }
      : item));
    this.scheduleWorkbookSave();
    return null;
  }

  private updateCurrentSheet(update: (sheet: SheetData) => void): void {
    this.sheets.update(sheets => sheets.map((sheet, index) => {
      if (index !== this.currentSheetIndex()) return sheet;
      const copy = { ...sheet, cells: { ...sheet.cells }, extraTexts: { ...sheet.extraTexts }, formats: { ...sheet.formats }, merges: { ...sheet.merges }, columnWidths: { ...sheet.columnWidths }, rowHeights: { ...sheet.rowHeights } };
      update(copy);
      return copy;
    }));
    this.scheduleWorkbookSave();
  }

  async openBook(book: TreeNode): Promise<void> {
    const request = ++this.bookOpenRequest;
    this.bookLoading.set(true);
    this.loadingBookName.set(book.name);
    let previousSaveFailed = false;
    try {
      try { await this.flushWorkbookSave(); }
      catch { previousSaveFailed = true; }
      const loaded: SheetData[] = [];
      for await (const [name, entry] of book.handle.entries()) {
        if (entry.kind !== 'directory') continue;
        const isLegacySheetFolder = /^Hoja\s+\d+$/i.test(name);
        const folder = entry;
        try {
          const file = await (await folder.getFileHandle('hoja.json')).getFile();
          const data = JSON.parse(await file.text()) as Partial<SheetData>;
          loaded.push({
            name: typeof data.name === 'string' && data.name.trim() ? data.name : name,
            storageFolderName: name,
            details: typeof data.details === 'string' ? data.details : '',
            cells: data.cells ?? {},
            extraTexts: data.extraTexts ?? {},
            formats: data.formats ?? {},
            merges: data.merges ?? {},
            columnWidths: data.columnWidths ?? {},
            rowHeights: data.rowHeights ?? {}
          });
        } catch {
          if (isLegacySheetFolder) loaded.push({ name, storageFolderName: name, cells: {}, extraTexts: {}, formats: {}, merges: {}, columnWidths: {}, rowHeights: {} });
        }
      }
      loaded.sort((a, b) => {
        const aNumber = a.name.match(/^Hoja\s+(\d+)$/i)?.[1];
        const bNumber = b.name.match(/^Hoja\s+(\d+)$/i)?.[1];
        if (aNumber && bNumber) return Number(aNumber) - Number(bNumber);
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });
      if (!loaded.length) loaded.push({ name: 'Hoja 1', storageFolderName: 'Hoja 1', cells: {}, extraTexts: {}, formats: {}, merges: {}, columnWidths: {}, rowHeights: {} });
      this.sheets.set(loaded);
      let savedSheetIndex = 0;
      try {
        const metadata = await (await book.handle.getFileHandle('libro.json')).getFile();
        const parsed = JSON.parse(await metadata.text()) as { activeSheet?: string };
        const savedIndex = loaded.findIndex(sheet => sheet.name === parsed.activeSheet);
        if (savedIndex >= 0) savedSheetIndex = savedIndex;
      } catch { /* Libro creado antes de guardar la hoja activa. */ }
      if (request !== this.bookOpenRequest) return;
      this.currentBook.set(book);
      this.actionMessage.set(previousSaveFailed ? 'No se pudieron guardar los cambios del libro anterior.' : '');
      this.currentSheetIndex.set(savedSheetIndex);
      this.selectionAnchor.set([0, 0]);
      this.selectionEnd.set([0, 0]);
      this.activeKey.set('libro');
      try { await this.persistWorkbook(book, loaded, savedSheetIndex); }
      catch { this.actionMessage.set(`El libro «${book.name}» se abrió, pero no se pudieron guardar sus cambios.`); }
    } catch {
      if (request === this.bookOpenRequest) this.actionMessage.set(`No se pudo abrir el libro «${book.name}».`);
    } finally {
      if (request === this.bookOpenRequest) {
        this.bookLoading.set(false);
        this.loadingBookName.set('');
      }
    }
  }

  async pasteFromClipboard(): Promise<void> {
    this.clipboardMessage.set('');
    if (!navigator.clipboard?.readText) {
      this.clipboardMessage.set('El navegador no permite leer el portapapeles. Abre la app en un contexto seguro (HTTPS) y concede permiso.');
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text) { this.clipboardMessage.set('El portapapeles está vacío. Copia primero un rango de Excel.'); return; }
      const matrix = this.parseClipboardTable(text);
      const maxRows = 1000, maxColumns = 200;
      const sourceRows = matrix.slice(0, maxRows).map(row => row.slice(0, maxColumns));
      const [startRow, startCol] = this.selectionEnd();
      const endRow = startRow + sourceRows.length - 1;
      const endCol = startCol + Math.max(0, ...sourceRows.map(row => row.length - 1));
      if (endRow >= this.rowNumbers.length) this.rowNumbers = Array.from({ length: endRow + 1 }, (_, index) => index + 1);
      if (endCol >= this.columns.length) this.columns = Array.from({ length: endCol + 1 }, (_, index) => this.columnLabel(index));
      this.updateCurrentSheet(sheet => {
        for (let rowOffset = 0; rowOffset < sourceRows.length; rowOffset++) {
          for (let colOffset = 0; colOffset < sourceRows[rowOffset].length; colOffset++) {
            const key = this.cellKey(startRow + rowOffset, startCol + colOffset);
            const value = sourceRows[rowOffset][colOffset];
            if (value === '') delete sheet.cells[key];
            else sheet.cells[key] = value;
          }
        }
      });
      this.selectionAnchor.set([startRow, startCol]);
      this.selectionEnd.set([endRow, endCol]);
      const truncated = matrix.length > maxRows || matrix.some(row => row.length > maxColumns);
      this.clipboardMessage.set(`Pegadas ${sourceRows.length} filas × ${Math.max(0, ...sourceRows.map(row => row.length))} columnas${truncated ? ` (límite: ${maxRows} × ${maxColumns})` : ''}.`);
    } catch (error) {
      this.clipboardMessage.set(error instanceof Error ? `No se pudo leer el portapapeles: ${error.message}` : 'No se pudo leer el portapapeles. Revisa los permisos del navegador.');
    }
  }

  private parseClipboardTable(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [], value = '', quoted = false;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (char === '"') {
        if (quoted && text[index + 1] === '"') { value += '"'; index++; }
        else quoted = !quoted;
      } else if (!quoted && char === '\t') {
        row.push(value); value = '';
      } else if (!quoted && (char === '\r' || char === '\n')) {
        row.push(value); rows.push(row); row = []; value = '';
        if (char === '\r' && text[index + 1] === '\n') index++;
      } else value += char;
    }
    row.push(value);
    if (row.length > 1 || row[0] !== '' || rows.length === 0) rows.push(row);
    return rows;
  }

  private columnLabel(index: number): string {
    let label = '', value = index + 1;
    while (value > 0) { value--; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26); }
    return label;
  }

  closeBook(): void {
    this.currentBook.set(null);
    this.activeKey.set('status');
  }

  private scheduleWorkbookSave(): void {
    if (!this.currentBook()) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const book = this.currentBook()!;
    const snapshot = this.sheets().map(sheet => ({
      ...sheet,
      cells: { ...sheet.cells }, extraTexts: { ...sheet.extraTexts }, formats: { ...sheet.formats }, merges: { ...sheet.merges },
      columnWidths: { ...sheet.columnWidths }, rowHeights: { ...sheet.rowHeights }
    }));
    const activeSheetIndex = this.currentSheetIndex();
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveQueue = this.saveQueue.then(() => this.persistWorkbook(book, snapshot, activeSheetIndex)).catch(() => {
        this.actionMessage.set(`No se pudo guardar el libro «${book.name}».`);
      });
    }, 250);
  }

  private async flushWorkbookSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      const book = this.currentBook();
      if (book) {
        const snapshot = this.sheets().map(sheet => ({
          ...sheet,
          cells: { ...sheet.cells }, extraTexts: { ...sheet.extraTexts }, formats: { ...sheet.formats }, merges: { ...sheet.merges },
          columnWidths: { ...sheet.columnWidths }, rowHeights: { ...sheet.rowHeights }
        }));
        const activeSheetIndex = this.currentSheetIndex();
        this.saveQueue = this.saveQueue.then(() => this.persistWorkbook(book, snapshot, activeSheetIndex));
      }
    }
    await this.saveQueue;
  }

  private async persistWorkbook(book: TreeNode, sheets: SheetData[], activeSheetIndex: number): Promise<void> {
    const existingFolders = new Set<string>();
    for await (const [name, entry] of book.handle.entries()) if (entry.kind === 'directory') existingFolders.add(name.toLocaleLowerCase());
    const usedFolders = new Set<string>();
    for (const sheet of sheets) {
      let folderName = sheet.storageFolderName ?? sheet.name;
      if (usedFolders.has(folderName.toLocaleLowerCase())) {
        let next = 1;
        do { folderName = `Hoja ${next++}`; }
        while (usedFolders.has(folderName.toLocaleLowerCase()) || existingFolders.has(folderName.toLocaleLowerCase()));
        sheet.storageFolderName = folderName;
      }
      usedFolders.add(folderName.toLocaleLowerCase());
    }
    if (this.currentBook()?.handle === book.handle) {
      const storageNames = new Map(sheets.map(sheet => [sheet.name, sheet.storageFolderName ?? sheet.name]));
      this.sheets.update(items => items.map(sheet => storageNames.has(sheet.name)
        ? { ...sheet, storageFolderName: storageNames.get(sheet.name) }
        : sheet));
    }
    for (const sheet of sheets) {
      const folder = await book.handle.getDirectoryHandle(sheet.storageFolderName ?? sheet.name, { create: true });
      const file = await folder.getFileHandle('hoja.json', { create: true });
      const writer = await file.createWritable();
      const { storageFolderName: _storageFolderName, ...data } = sheet;
      await writer.write(JSON.stringify(data, null, 2));
      await writer.close();
    }
    const metadataHandle = await book.handle.getFileHandle('libro.json', { create: true });
    const metadataWriter = await metadataHandle.createWritable();
    await metadataWriter.write(JSON.stringify({ activeSheet: sheets[activeSheetIndex]?.name ?? sheets[0]?.name ?? 'Hoja 1' }));
    await metadataWriter.close();
  }

}
