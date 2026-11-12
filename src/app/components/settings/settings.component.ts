import { Component, Input, computed, effect, inject, signal } from '@angular/core';
import { ProjectDirectoryHandle } from '../view-content.component/project-library-manager.component';
import { LibraryRecord, LibraryTreeService } from '../../services/library-tree.service';
import { ConfigService } from '../../services/config.service';
import { P2PState, P2PSyncService, SyncRoot } from './p2p-sync.service';
import { CreatividadStorageService } from '../creatividad.component/creatividad-storage.service';

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
  readonly libraryTree = inject(LibraryTreeService);
  readonly config = inject(ConfigService);
  readonly creatividadStorage = inject(CreatividadStorageService);
  readonly menuOpen = signal(false);
  readonly activePage = signal<SettingsPage>('sync');
  readonly copiedLabel = signal('');
  readonly playerMessage = signal('');
  readonly playerLibrary = computed<LibraryRecord | null>(() => this.libraryTree.primaryLibrary());
  invitationInput = '';
  answerInput = '';
  formMessage = '';

  constructor() {
    void this.libraryTree.initialize();
    effect(() => {
      if (this.sync.state() !== 'completed') return;
      void this.applySyncedData();
    });
  }

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
    try {
      await this.config.flush();
      await this.sync.createInvitation(await this.buildRoots());
    } catch (error) {
      this.formMessage = error instanceof Error ? error.message : 'No se pudo crear la invitación.';
    }
  }

  async generateAnswer(): Promise<void> {
    if (!this.requireRoot()) return;
    if (!this.invitationInput.trim()) { this.formMessage = 'Pega primero el código de invitación.'; return; }
    if (this.sync.role() === 'offerer') {
      this.formMessage = 'Este dispositivo ya creó la invitación. Pega este código en el otro dispositivo para generar la respuesta.';
      return;
    }
    this.formMessage = '';
    try {
      await this.config.flush();
      await this.sync.acceptInvitation(await this.buildRoots(), this.invitationInput);
    } catch (error) {
      this.formMessage = error instanceof Error ? error.message : 'No se pudo generar la respuesta.';
    }
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

  async choosePlayerLibrary(): Promise<void> {
    this.playerMessage.set('');
    try {
      const record = await this.libraryTree.addLibrary();
      if (record) this.playerMessage.set(`Biblioteca del reproductor lista: ${record.name}.`);
    } catch (error) {
      this.playerMessage.set(error instanceof Error ? error.message : 'No se pudo seleccionar la carpeta del reproductor.');
    }
  }

  async rescanPlayerLibrary(): Promise<void> {
    const record = this.playerLibrary();
    if (!record) { this.playerMessage.set('Primero selecciona la carpeta de la biblioteca del reproductor.'); return; }
    this.playerMessage.set('');
    try {
      await this.libraryTree.rescan(record);
      this.playerMessage.set(`Biblioteca del reproductor actualizada: ${record.name}.`);
    } catch {
      this.playerMessage.set('No se pudo volver a leer la biblioteca del reproductor. Comprueba los permisos de la carpeta.');
    }
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

  roleLabel(): string {
    const role = this.sync.role();
    if (role === 'offerer') return 'Dispositivo A · creó la invitación';
    if (role === 'answerer') return 'Dispositivo B · generó la respuesta';
    return 'Sin rol asignado';
  }

  private async buildRoots(): Promise<SyncRoot[]> {
    const roots: SyncRoot[] = [];
    await this.libraryTree.initialize();
    if (this.libraryRoot) {
      roots.push({ kind: 'main', id: 'main', name: this.libraryRoot.name, root: this.libraryRoot });
    }
    for (const player of this.libraryTree.libraries()) {
      if (this.libraryRoot && player.name.toLocaleLowerCase() === this.libraryRoot.name.toLocaleLowerCase()) continue;
      const root = player.root as ProjectDirectoryHandle;
      try {
        let permission = await root.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') permission = await root.requestPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
          this.playerMessage.set('La biblioteca del reproductor no tiene permiso de escritura. Vuelve a seleccionar su carpeta.');
          continue;
        }
      } catch {
        // Algunos almacenes internos no exponen permisos; se intenta sincronizar igualmente.
      }
      roots.push({ kind: 'player', id: player.id, name: player.name, root });
    }
    return roots;
  }

  private async applySyncedData(): Promise<void> {
    await this.libraryTree.refreshFromConfig();
    await this.libraryTree.ensureRemoteLibraries(this.sync.remoteLibraryNames(), this.sync.mediaContainerName());
    const libraries = this.libraryTree.libraries();
    const scanResults = await Promise.allSettled(libraries.map(library => this.libraryTree.rescan(library)));
    const scanFailed = scanResults.some(result => result.status === 'rejected');
    this.creatividadStorage.notifySyncedDataChanged();
    if (scanFailed) {
      this.playerMessage.set('Se recibieron archivos, pero no se pudo actualizar el índice de una o más bibliotecas en Library Tree.');
    } else {
      this.playerMessage.set('Sincronización aplicada: configuración, Library Tree y datos de Creatividad actualizados.');
    }
  }

  private requireRoot(): boolean {
    if (this.libraryRoot) return true;
    this.formMessage = 'Selecciona la carpeta raíz de la biblioteca principal desde el panel de biblioteca (Menu).';
    return false;
  }
}
