import { ChangeDetectionStrategy, Component, ViewChild, computed, inject, signal } from '@angular/core';
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
  readonly loadingMessage = computed(() => {
    if (this.sync.syncing()) return 'Sincronizando bibliotecas…';
    const scan = this.libraryTree.progress();
    if (scan?.running) return `Cargando biblioteca… ${scan.scanned} elementos (${scan.percent}%)`;
    return '';
  });
  private readonly libraryTree = inject(LibraryTreeService);
  readonly appName = 'CaleVRijAdmin';
  readonly version = 'v1.0.0';
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
  readonly columns = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));
  readonly rowNumbers = Array.from({ length: 50 }, (_, index) => index + 1);
  readonly sheets = signal<SheetData[]>([{ name: 'Hoja 1', cells: {}, extraTexts: {}, formats: {}, merges: {}, columnWidths: {}, rowHeights: {} }]);
  readonly currentSheetIndex = signal(0);
  readonly currentBook = signal<TreeNode | null>(null);
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
    removeSheet: () => this.removeSheet(),
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
    void this.libraryTree.initialize().then(() => {
      if (this.activeKey() === this.sections[0].key && this.libraryTree.lastUsedLibraryId()) {
        this.activeKey.set('library-tree');
      }
    });
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
  }

  playLibraryFile(file: File | LibraryMediaSource): void {
    this.selectedLibraryFile.set(file);
    this.currentPlayerFileName.set(file.name);
    this.menuReturnKey.set('reproductor');
    this.activeKey.set('reproductor');
  }

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
    const next = Math.max(0, ...this.sheets().map(sheet => Number(sheet.name.match(/\d+/)?.[0] ?? 0))) + 1;
    this.sheets.update(sheets => [...sheets, { name: `Hoja ${next}`, cells: {}, extraTexts: {}, formats: {}, merges: {}, columnWidths: {}, rowHeights: {} }]);
    this.currentSheetIndex.set(this.sheets().length - 1);
    this.selectionAnchor.set([0, 0]); this.selectionEnd.set([0, 0]);
    this.scheduleWorkbookSave();
  }

  removeSheet(): void {
    if (this.sheets().length <= 1) return;
    this.sheets.update(sheets => sheets.filter((_, index) => index !== this.currentSheetIndex()));
    this.currentSheetIndex.set(Math.max(0, this.currentSheetIndex() - 1));
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
    await this.flushWorkbookSave();
    this.currentBook.set(book);
    this.actionMessage.set('');
    try {
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
            details: typeof data.details === 'string' ? data.details : '',
            cells: data.cells ?? {},
            extraTexts: data.extraTexts ?? {},
            formats: data.formats ?? {},
            merges: data.merges ?? {},
            columnWidths: data.columnWidths ?? {},
            rowHeights: data.rowHeights ?? {}
          });
        } catch {
          if (isLegacySheetFolder) loaded.push({ name, cells: {}, extraTexts: {}, formats: {}, merges: {}, columnWidths: {}, rowHeights: {} });
        }
      }
      loaded.sort((a, b) => {
        const aNumber = a.name.match(/^Hoja\s+(\d+)$/i)?.[1];
        const bNumber = b.name.match(/^Hoja\s+(\d+)$/i)?.[1];
        if (aNumber && bNumber) return Number(aNumber) - Number(bNumber);
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });
      if (!loaded.length) loaded.push({ name: 'Hoja 1', cells: {}, extraTexts: {}, formats: {}, merges: {}, columnWidths: {}, rowHeights: {} });
      this.sheets.set(loaded);
      let savedSheetIndex = 0;
      try {
        const metadata = await (await book.handle.getFileHandle('libro.json')).getFile();
        const parsed = JSON.parse(await metadata.text()) as { activeSheet?: string };
        const savedIndex = loaded.findIndex(sheet => sheet.name === parsed.activeSheet);
        if (savedIndex >= 0) savedSheetIndex = savedIndex;
      } catch { /* Libro creado antes de guardar la hoja activa. */ }
      this.currentSheetIndex.set(savedSheetIndex);
      this.selectionAnchor.set([0, 0]);
      this.selectionEnd.set([0, 0]);
      this.activeKey.set('libro');
      await this.persistWorkbook(book, loaded, savedSheetIndex);
    } catch {
      this.actionMessage.set(`No se pudo abrir el libro «${book.name}».`);
    }
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
    const validFolders = new Set(sheets.map(sheet => sheet.name));
    for await (const [name, entry] of book.handle.entries()) {
      if (entry.kind === 'directory' && /^Hoja\s+\d+$/i.test(name) && !validFolders.has(name)) {
        await book.handle.removeEntry(name, { recursive: true });
      }
    }
    for (const sheet of sheets) {
      const folder = await book.handle.getDirectoryHandle(sheet.name, { create: true });
      const file = await folder.getFileHandle('hoja.json', { create: true });
      const writer = await file.createWritable();
      await writer.write(JSON.stringify(sheet, null, 2));
      await writer.close();
    }
    const metadataHandle = await book.handle.getFileHandle('libro.json', { create: true });
    const metadataWriter = await metadataHandle.createWritable();
    await metadataWriter.write(JSON.stringify({ activeSheet: sheets[activeSheetIndex]?.name ?? sheets[0]?.name ?? 'Hoja 1' }));
    await metadataWriter.close();
  }

}
