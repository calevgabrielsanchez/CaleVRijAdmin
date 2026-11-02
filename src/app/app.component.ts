import { ChangeDetectionStrategy, Component, ViewChild, computed, signal } from '@angular/core';
import { TextPlusComponent } from './components/text-plus.component/text-plus.component';
import { LibraryTreeComponent } from './components/library-tree.component/library-tree.component';
import { MainMenuComponent } from './components/main-menu.component/main-menu.component';
import { CellFormat, SheetData, SpreadsheetSectionComponent, SpreadsheetViewModel } from './components/spreadsheet-section.component/spreadsheet-section.component';
import { ReproductorComponent } from './components/reproductor-section.component/reproductor.component';
import { DataSectionComponent } from './components/data-section.component';
import { AboutSectionComponent } from './components/about-section.component';
import { ViewContentComponent, ViewContentMode } from './components/view-content.component/view-content.component';
import { ProjectDirectoryHandle as DirectoryHandle, ProjectLibraryManagerComponent, ProjectLibraryNode as TreeNode } from './components/view-content.component/project-library-manager.component';
import { CreatividadComponent } from './components/creatividad.component/creatividad.component';

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
  imports: [TextPlusComponent, LibraryTreeComponent, MainMenuComponent, SpreadsheetSectionComponent, ReproductorComponent, DataSectionComponent, AboutSectionComponent, ViewContentComponent, ProjectLibraryManagerComponent, CreatividadComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  @ViewChild(TextPlusComponent) private textPlusInstance?: TextPlusComponent;
  readonly appName = 'CaleVRijAdmin';
  readonly version = 'v1.0.0';
  readonly sections: readonly AppSection[] = [
    { key: 'inicio', label: 'Libro', icon: '▤', title: 'Libro', description: 'Abre un libro desde el árbol de bibliotecas para editar sus hojas.', cardTitle: 'Tus hojas', cardText: 'Cada libro conserva sus celdas, formatos y hojas.' },
    { key: 'reproductor', label: 'Reproductor', icon: '⏯', title: 'Reproductor', description: 'Reproductor multimedia.', cardTitle: 'Reproducción', cardText: 'Controles y contenido multimedia.' },
    { key: 'mente', label: 'Mente', icon: '♠', title: 'Mente', description: 'Organiza personalidades, valores, miedos y emociones.', cardTitle: 'Mente', cardText: 'Datos guardados localmente dentro de la raíz de biblioteca.' },
    { key: 'acerca', label: 'Acerca', icon: 'ⓘ', title: 'Acerca de esta plantilla', description: 'Plantilla Angular y Capacitor con carcasa retro metálica.', cardTitle: 'Estilo homologado', cardText: 'Conserva la estructura visual y personaliza colores, secciones y funciones.' }
   
  ];
  readonly activeKey = signal(this.sections[0].key);
  readonly menuReturnKey = signal(this.sections[0].key);
  readonly activeSection = computed(() => this.sections.find((section) => section.key === this.activeKey()) ?? this.sections[0]);
  readonly activeIndex = computed(() => this.sections.findIndex((section) => section.key === this.activeKey()));
  readonly viewContentMode = computed<ViewContentMode>(() => this.activeKey() === 'inicio' || this.activeKey() === 'libro' ? 'spreadsheet' : this.activeKey() === 'library-tree' ? 'library-tree' : this.activeKey() === 'reproductor' ? 'player' : 'standard');
  readonly paused = signal(false);
  readonly actionMessage = signal('');
  readonly selectedLibraryFile = signal<File | null>(null);
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
    startResize: (axis, index, event) => this.startResize(axis, index, event),
    resizeDimension: event => this.resizeDimension(event),
    stopResize: () => this.stopResize(),
    mergeSelection: () => this.mergeSelection(),
    unmergeSelection: () => this.unmergeSelection(),
    formatSelection: change => this.formatSelection(change),
    selectCell: (row, col, event) => this.selectCell(row, col, event),
    updateCell: (row, col, event) => this.updateCell(row, col, event),
    updateSelectedCellText: event => this.updateSelectedCellText(event),
    openTextPlus: () => this.openTextPlus(),
    selectSheet: index => this.selectSheet(index),
    addSheet: () => this.addSheet(),
    removeSheet: () => this.removeSheet(),
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

  navigate(key: string): void {
    if (this.sections.some((section) => section.key === key)) {
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
    if (active === 'reproductor') {
      this.currentPlayerFileName.set('');
      this.menuReturnKey.set('reproductor');
      this.activeKey.set('library-tree');
    } else if (active === 'menu' || active === 'library-tree' || active === 'status') {
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

  setProjectLibraryRoot(root: DirectoryHandle | null): void { this.projectLibraryRoot.set(root); }

  playLibraryFile(file: File): void {
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

  private openHandlesDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('calevri-admin', 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('settings')) request.result.createObjectStore('settings'); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
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

  selectCell(row: number, col: number, event: MouseEvent): void {
    if (event.shiftKey) this.selectionEnd.set([row, col]);
    else { this.selectionAnchor.set([row, col]); this.selectionEnd.set([row, col]); }
  }

  updateCell(row: number, col: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.updateCurrentSheet(sheet => { sheet.cells[this.cellKey(row, col)] = value; });
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

  openTextPlus(): void {
    this.textPlusTarget = [...this.selectionEnd()];
    this.textPlusContent = this.cellExtraText(...this.textPlusTarget);
    this.textPlusOpen.set(true);
  }

  closeTextPlus(): void { this.textPlusOpen.set(false); }

  acceptTextPlus(): void {
    const [row, col] = this.textPlusTarget;
    const value = this.textPlusInstance?.textoArea ?? this.textPlusContent;
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
    const startRow = Math.min(ar, br), endRow = Math.max(ar, br), startCol = Math.min(ac, bc), endCol = Math.max(ac, bc);
    if (startRow === endRow && startCol === endCol) return;
    const key = this.cellKey(startRow, startCol);
    this.updateCurrentSheet(sheet => { sheet.merges[key] = { endRow, endCol }; });
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
      if ((row > startRow || col > startCol) && row >= startRow && row <= range.endRow && col >= startCol && col <= range.endCol) return true;
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
        if (entry.kind !== 'directory' || !/^Hoja\s+\d+$/i.test(name)) continue;
        const folder = entry;
        try {
          const file = await (await folder.getFileHandle('hoja.json')).getFile();
          const data = JSON.parse(await file.text()) as Partial<SheetData>;
          loaded.push({
            name,
            cells: data.cells ?? {},
            extraTexts: data.extraTexts ?? {},
            formats: data.formats ?? {},
            merges: data.merges ?? {},
            columnWidths: data.columnWidths ?? {},
            rowHeights: data.rowHeights ?? {}
          });
        } catch {
          loaded.push({ name, cells: {}, extraTexts: {}, formats: {}, merges: {}, columnWidths: {}, rowHeights: {} });
        }
      }
      loaded.sort((a, b) => Number(a.name.match(/\d+/)?.[0]) - Number(b.name.match(/\d+/)?.[0]));
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
      await this.setLastBookPath(book.path);
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

  private async setLastBookPath(path: string[] | null): Promise<void> {
    const db = await this.openHandlesDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put(path, 'lastBookPath');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  private async getLastBookPath(): Promise<string[] | null> {
    const db = await this.openHandlesDb();
    const path = await new Promise<string[] | null>((resolve, reject) => {
      const request = db.transaction('settings').objectStore('settings').get('lastBookPath');
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return path;
  }
}
