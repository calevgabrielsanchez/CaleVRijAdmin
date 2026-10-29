import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface MenuItem {
  key: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-main-menu',
  standalone: true,
  templateUrl: './main-menu.component.html',
  styleUrl: './main-menu.component.css'
})
export class MainMenuComponent {
  @Input({ required: true }) items: readonly MenuItem[] = [];
  @Input({ required: true }) activeKey = '';
  @Output() readonly selected = new EventEmitter<string>();
}
