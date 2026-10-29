import { Component, Input, ViewEncapsulation } from '@angular/core';

export type ViewContentMode = 'standard' | 'spreadsheet' | 'library-tree' | 'player';

@Component({
  selector: 'app-view-content',
  standalone: true,
  templateUrl: './view-content.component.html',
  host: { '[class.fill-mode]': 'fillMode' },
  styleUrl: './view-content.component.css',
  encapsulation: ViewEncapsulation.None
})
export class ViewContentComponent {
  @Input() mode: ViewContentMode = 'standard';

  get fillMode(): boolean { return this.mode !== 'standard'; }
}
