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
  selectCell: (row: number, col: number, event: MouseEvent) => void;
  updateCell: (row: number, col: number, event: Event) => void;
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

  @HostListener('document:click', ['$event'])
  closeSheetMenuOutside(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.sheet-picker')) this.sheetMenuOpen = false;
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void { this.vm?.resizeDimension(event); }

  @HostListener('document:pointerup')
  onPointerUp(): void { this.vm?.stopResize(); }
}
