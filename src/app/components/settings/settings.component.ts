import { Component, Input, inject, signal } from '@angular/core';
import { ProjectDirectoryHandle } from '../view-content.component/project-library-manager.component';
import { P2PState, P2PSyncService } from './p2p-sync.service';

type SettingsPage = 'sync' | 'about';

@Component({
  selector: 'app-settings',
  standalone: true,
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css'
})
export class SettingsComponent {
  @Input() libraryRoot: ProjectDirectoryHandle | null = null;
  readonly sync = inject(P2PSyncService);
  readonly menuOpen = signal(false);
  readonly activePage = signal<SettingsPage>('sync');
  readonly copiedLabel = signal('');
  invitationInput = '';
  answerInput = '';
  formMessage = '';

  get pageTitle(): string {
    return this.activePage() === 'sync' ? 'Sincronización P2P' : 'Acerca de';
  }

  toggleMenu(): void { this.menuOpen.update(open => !open); }

  selectPage(page: SettingsPage): void {
    this.activePage.set(page);
    this.menuOpen.set(false);
  }

  async createInvitation(): Promise<void> {
    if (!this.requireRoot()) return;
    this.formMessage = '';
    await this.sync.createInvitation(this.libraryRoot!);
  }

  async generateAnswer(): Promise<void> {
    if (!this.requireRoot()) return;
    if (!this.invitationInput.trim()) { this.formMessage = 'Pega primero el código de invitación.'; return; }
    this.formMessage = '';
    await this.sync.acceptInvitation(this.libraryRoot!, this.invitationInput);
  }

  async connect(): Promise<void> {
    if (!this.answerInput.trim()) { this.formMessage = 'Pega primero el código de respuesta.'; return; }
    this.formMessage = '';
    try {
      await this.sync.acceptAnswer(this.answerInput);
    } catch (error) {
      this.formMessage = error instanceof Error ? error.message : 'No se pudo conectar.';
    }
  }

  async resync(): Promise<void> {
    this.formMessage = '';
    try {
      await this.sync.resync();
    } catch (error) {
      this.formMessage = error instanceof Error ? error.message : 'No se pudo iniciar la sincronización.';
    }
  }

  disconnect(): void {
    this.sync.disconnect();
    this.invitationInput = '';
    this.answerInput = '';
    this.formMessage = '';
  }

  async copy(value: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copiedLabel.set(label);
      setTimeout(() => this.copiedLabel.set(''), 2000);
    } catch {
      this.formMessage = 'No se pudo copiar automáticamente. Selecciona el texto y cópialo manualmente.';
    }
  }

  stateLabel(): string {
    const labels: Record<P2PState, string> = {
      idle: 'Sin conexión',
      'creating-invitation': 'Creando invitación',
      'waiting-answer': 'Esperando respuesta',
      'waiting-connection': 'Esperando conexión',
      connected: 'Conectado',
      syncing: 'Sincronizando',
      completed: 'Sincronizado',
      error: 'Error'
    };
    return labels[this.sync.state()];
  }

  private requireRoot(): boolean {
    if (this.libraryRoot) return true;
    this.formMessage = 'Selecciona la carpeta raíz de la biblioteca desde el panel de biblioteca (Menu).';
    return false;
  }
}
