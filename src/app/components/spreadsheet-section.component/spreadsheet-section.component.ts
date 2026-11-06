import { Component, HostListener, Input } from '@angular/core';

export interface CellFormat { background?: string; color?: string; align?: 'left' | 'center' | 'right' }
export interface SheetData {
  name: string;
  details?: string;
  cells: Record<string, string>;
  extraTexts: Record<string, string>;
  formats: Record<string, CellFormat>;
  merges: Record<string, { endRow: number; endCol: number }>;
  columnWidths: Record<number, number>;
  rowHeights: Record<number, number>;
}
export interface SpreadsheetViewModel {
  columns: readonly string[];
  rowNumbers: readonly number[];
  sheets: SheetData[];
  currentSheetIndex: number;
  isWorkbook: boolean;
  backgroundColor: string;
  textColor: string;
  cellValue: (row: number, col: number) => string;
  cellFormat: (row: number, col: number) => CellFormat;
  columnWidth: (col: number) => number;
  rowHeight: (row: number) => number;
  isCellSelected: (row: number, col: number) => boolean;
  mergedRange: (row: number, col: number) => { rowSpan: number; colSpan: number } | null;
  isCoveredCell: (row: number, col: number) => boolean;
  hasCellExtraText: (row: number, col: number) => boolean;
  selectedCellText: () => string;
  startResize: (axis: 'column' | 'row', index: number, event: PointerEvent) => void;
  resizeDimension: (event: PointerEvent) => void;
  stopResize: () => void;
  mergeSelection: () => void;
  unmergeSelection: () => void;
  formatSelection: (change: Partial<CellFormat>) => void;
  selectCell: (row: number, col: number, event: { shiftKey: boolean }) => void;
  updateSelectedCellText: (event: Event) => void;
  openTextPlus: () => void;
  selectSheet: (index: number) => void;
  addSheet: () => void;
  removeSheet: () => void;
  updateSheetProperties: (name: string, details: string) => string | null;
  updateBackground: (event: Event) => void;
  updateTextColor: (event: Event) => void;
}

@Component({
  selector: 'app-spreadsheet-section',
  standalone: true,
  templateUrl: './spreadsheet-section.component.html',
  styleUrl: './spreadsheet-section.component.css'
})
export class SpreadsheetSectionComponent {
  @Input({ required: true }) vm!: SpreadsheetViewModel;
  sheetMenuOpen = false;
  sheetPropertiesOpen = false;
  sheetNameDraft = '';
  sheetDetailsDraft = '';
  sheetPropertiesError = '';
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private activeHoldPointer: number | null = null;
  private activePointerCell: [number, number] | null = null;
  private longPressActive = false;
  private draggedSelection = false;
  private rangeSelectionArmed = false;
  private suppressNextClick = false;

  openSheetProperties(): void {
    const sheet = this.vm.sheets[this.vm.currentSheetIndex];
    if (!sheet) return;
    this.sheetNameDraft = sheet.name;
    this.sheetDetailsDraft = sheet.details ?? '';
    this.sheetPropertiesError = '';
    this.sheetPropertiesOpen = true;
  }

  saveSheetProperties(): void {
    const error = this.vm.updateSheetProperties(this.sheetNameDraft, this.sheetDetailsDraft);
    if (error) {
      this.sheetPropertiesError = error;
      return;
    }
    this.sheetPropertiesOpen = false;
  }

  toggleSheetMenu(): void {
    if (this.vm.sheets.length > 1) this.sheetMenuOpen = !this.sheetMenuOpen;
  }

  chooseSheet(index: number): void {
    this.vm.selectSheet(index);
    this.sheetMenuOpen = false;
  }

  startCellHold(row: number, col: number, event: PointerEvent): void {
    if (event.pointerType === 'mouse' || event.button !== 0) return;
    this.clearHoldTimer();
    this.activeHoldPointer = event.pointerId;
    this.activePointerCell = [row, col];
    this.longPressActive = false;
    this.draggedSelection = false;
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      this.longPressActive = true;
      this.rangeSelectionArmed = true;
      this.suppressNextClick = true;
      this.vm.selectCell(row, col, { shiftKey: false });
    }, 500);
  }

  extendHeldSelection(row: number, col: number, event: PointerEvent): void {
    if (!this.longPressActive || event.pointerId !== this.activeHoldPointer) return;
    if (this.activePointerCell?.[0] === row && this.activePointerCell[1] === col) return;
    this.activePointerCell = [row, col];
    this.draggedSelection = true;
    this.vm.selectCell(row, col, { shiftKey: true });
  }

  selectCell(row: number, col: number, event: MouseEvent): void {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    if (this.rangeSelectionArmed) {
      this.vm.selectCell(row, col, { shiftKey: true });
      this.rangeSelectionArmed = false;
      return;
    }
    this.vm.selectCell(row, col, event);
  }

  private clearHoldTimer(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  @HostListener('document:click', ['$event'])
  closeSheetMenuOutside(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.sheet-picker')) this.sheetMenuOpen = false;
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    this.vm?.resizeDimension(event);
    if (!this.longPressActive || event.pointerId !== this.activeHoldPointer) return;
    const cell = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('.sheet-grid td[data-row][data-col]');
    if (cell) {
      this.extendHeldSelection(Number(cell.dataset['row']), Number(cell.dataset['col']), event);
    }
  }

  @HostListener('document:pointerup')
  onPointerUp(): void {
    this.vm?.stopResize();
    this.clearHoldTimer();
    const shouldClearClickSuppression = this.suppressNextClick;
    if (this.longPressActive && this.draggedSelection) this.rangeSelectionArmed = false;
    this.activeHoldPointer = null;
    this.activePointerCell = null;
    this.longPressActive = false;
    if (shouldClearClickSuppression) setTimeout(() => { this.suppressNextClick = false; });
  }

  @HostListener('document:pointercancel')
  onPointerCancel(): void {
    this.clearHoldTimer();
    this.suppressNextClick = false;
    this.activeHoldPointer = null;
    this.activePointerCell = null;
    this.longPressActive = false;
    this.draggedSelection = false;
  }
}
