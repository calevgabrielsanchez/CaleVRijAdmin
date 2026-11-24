import { Component, ElementRef, Input, OnDestroy, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { ProjectDirectoryHandle } from '../view-content.component/project-library-manager.component';
import { LibraryRecord, LibraryTreeService } from '../../services/library-tree.service';
import { ConfigService } from '../../services/config.service';
import { CloudLibrarySyncService } from '../../services/cloud-library-sync.service';
import { P2PState, P2PSyncService, SyncRoot } from './p2p-sync.service';
import { CreatividadStorageService } from '../creatividad.component/creatividad-storage.service';

type SettingsPage = 'sync' | 'qr' | 'about';

@Component({
  selector: 'app-settings',
  standalone: true,
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css'
})
export class SettingsComponent implements OnDestroy {
  @ViewChild('qrVideo') private qrVideo?: ElementRef<HTMLVideoElement>;
  @Input() libraryRoot: ProjectDirectoryHandle | null = null;
  @Input() flushBeforeCloudSync?: () => Promise<void>;
  readonly sync = inject(P2PSyncService);
  readonly libraryTree = inject(LibraryTreeService);
  readonly config = inject(ConfigService);
  readonly cloudSync = inject(CloudLibrarySyncService);
  readonly creatividadStorage = inject(CreatividadStorageService);
  readonly menuOpen = signal(false);
  readonly activePage = signal<SettingsPage>('sync');
  readonly copiedLabel = signal('');
  readonly playerMessage = signal('');
  readonly invitationQr = signal('');
  readonly answerQr = signal('');
  readonly scanningQr = signal(false);
  readonly qrMessage = signal('');
  private qrControls?: { stop(): void };
  readonly playerLibrary = computed<LibraryRecord | null>(() => this.libraryTree.primaryLibrary());
  invitationInput = '';
  answerInput = '';
  formMessage = '';

  constructor() {
    void this.libraryTree.initialize();
    let previousSyncState: P2PState = this.sync.state();
    effect(() => {
      const state = this.sync.state();
      if (state === 'completed' && previousSyncState !== 'completed') void this.applySyncedData();
      previousSyncState = state;
    });
    effect(() => {
      const invitation = this.sync.invitationCode();
      const answer = this.sync.answerCode();
      if (invitation) void import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(invitation, { errorCorrectionLevel: 'L', margin: 2, width: 320 })).then(url => this.invitationQr.set(url)).catch(() => this.qrMessage.set('No se pudo generar el QR de invitación.'));
      else this.invitationQr.set('');
      if (answer) void import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(answer, { errorCorrectionLevel: 'L', margin: 2, width: 320 })).then(url => this.answerQr.set(url)).catch(() => this.qrMessage.set('No se pudo generar el QR de respuesta.'));
      else this.answerQr.set('');
    });
  }

  get pageTitle(): string {
    return this.activePage() === 'sync' ? 'Sincronización P2P' : this.activePage() === 'qr' ? 'Sincronización por QR' : 'Acerca de';
  }

  toggleMenu(): void { this.menuOpen.update(open => !open); }

  selectPage(page: SettingsPage): void {
    this.stopQrScanner();
    this.activePage.set(page);
    this.menuOpen.set(false);
  }

  async syncDatabaseNow(): Promise<void> {
    this.menuOpen.set(false);
    if (!this.libraryRoot) {
      this.formMessage = 'Selecciona primero la carpeta raíz de libros desde el panel de biblioteca.';
      this.activePage.set('sync');
      return;
    }
    this.formMessage = '';
    this.activePage.set('sync');
    await this.flushBeforeCloudSync?.();
    await this.cloudSync.syncManually();
  }

  async startQrScanner(): Promise<void> {
    this.qrMessage.set('');
    if (!this.qrVideo) { this.qrMessage.set('No se pudo iniciar la cámara.'); return; }
    try {
      this.stopQrScanner();
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const reader = new BrowserQRCodeReader();
      this.scanningQr.set(true);
      this.qrControls = await reader.decodeFromVideoDevice(undefined, this.qrVideo.nativeElement, async result => {
        if (!result || !this.scanningQr()) return;
        const code = result.getText();
        this.stopQrScanner();
        await this.handleScannedQr(code);
      });
    } catch (error) {
      this.stopQrScanner();
      this.qrMessage.set(error instanceof Error ? `No se pudo acceder a la cámara: ${error.message}` : 'No se pudo acceder a la cámara. Comprueba los permisos.');
    }
  }

  stopQrScanner(): void {
    this.scanningQr.set(false);
    this.qrControls?.stop();
    this.qrControls = undefined;
  }

  ngOnDestroy(): void { this.stopQrScanner(); }

  private async handleScannedQr(code: string): Promise<void> {
    try {
      await this.config.flush();
      if (this.sync.role() === 'offerer') {
        await this.sync.acceptAnswer(code);
        this.qrMessage.set('Respuesta QR recibida. Conectando y sincronizando…');
      } else {
        if (!this.requireRoot()) return;
        await this.sync.acceptInvitation(await this.buildRoots(), code);
        this.qrMessage.set('Invitación recibida. Muestra el QR de respuesta al otro dispositivo.');
      }
    } catch (error) {
      this.qrMessage.set(error instanceof Error ? error.message : 'No se pudo procesar el código QR.');
    }
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
    for (const player of this.libraryTree.libraries()) {
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
    if (this.playerLibrary()) return true;
    this.formMessage = 'Selecciona primero la carpeta de la biblioteca multimedia en Settings.';
    return false;
  }
}
