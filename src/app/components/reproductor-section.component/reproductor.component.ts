import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { AndroidDirectoryAccess } from '@calevrij/admin-android-directory-access';
import { ConfigService, PlayerBookmark } from '../../services/config.service';
import type { LibraryMediaSource } from '../../services/library-tree.service';

type MediaKind = 'audio' | 'video' | 'image' | 'pdf' | 'other';

interface PlaylistItem {
  file: File | LibraryMediaSource;
  url: string;
  safeUrl: SafeResourceUrl;
  kind: MediaKind;
  key: string;
  ownsObjectUrl: boolean;
}

@Component({
  selector: 'app-reproductor',
  standalone: true,
  templateUrl: './reproductor.component.html',
  styleUrl: './reproductor.component.css'
})
export class ReproductorComponent implements OnDestroy {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly config = inject(ConfigService);

  @Input()
  set selectedFile(file: File | LibraryMediaSource | null) {
    if (!file) return;
    this.currentMedia?.pause();
    for (const item of this.playlist) this.releasePlaylistItem(item);
    this.playlist = [this.createPlaylistItem(file)];
    this.currentIndex = 0;
    this.currentTime = 0;
    this.duration = 0;
    this.isPlaying = false;
    this.showPlaybackControls = true;
    this.imageZoom = 1;
    this.imagePanX = 0;
    this.imagePanY = 0;
    this.pdfZoom = 1;
    this.setMessage('');
    this.autoplayOnAttach = this.canPlayItem(this.playlist[0]) && !this.isNativeSource(file);
    this.currentFileNameChange.emit(file.name);
    this.fileConsumed.emit();
    this.syncMediaNotification(true);
  }

  @Output() readonly fileConsumed = new EventEmitter<void>();
  @Output() readonly currentFileNameChange = new EventEmitter<string>();

  @ViewChild('mediaPlayer')
  set mediaPlayer(element: ElementRef<HTMLMediaElement> | undefined) {
    this.currentMedia = element?.nativeElement ?? null;
    if (this.currentMedia && this.autoplayOnAttach) {
      this.autoplayOnAttach = false;
      void this.play();
    }
  }

  playlist: PlaylistItem[] = [];
  currentIndex = -1;
  currentTime = 0;
  duration = 0;
  isPlaying = false;
  showPlaybackControls = true;
  imageZoom = 1;
  imagePanX = 0;
  imagePanY = 0;
  pdfZoom = 1;
  bookmarksModalOpen = false;
  message = '';
  messageFading = false;
  get bookmarksByFile(): Record<string, PlayerBookmark[]> { return this.config.bookmarks(); }
  private currentMedia: HTMLMediaElement | null = null;
  private autoplayOnAttach = false;
  private imagePointers = new Map<number, { x: number; y: number }>();
  private pinchStartDistance = 0;
  private pinchStartZoom = 1;
  private dragPointerId: number | null = null;
  private dragStartY = 0;
  private dragStartZoom = 1;
  private touchPanPointerId: number | null = null;
  private touchPanStartX = 0;
  private touchPanStartY = 0;
  private touchPanStartOffsetX = 0;
  private touchPanStartOffsetY = 0;
  private messageFadeTimer?: ReturnType<typeof setTimeout>;
  private messageClearTimer?: ReturnType<typeof setTimeout>;
  private mediaActionListener?: PluginListenerHandle;
  private lastNotificationUpdate = 0;

  constructor() {
    void this.config.whenReady();
    if (Capacitor.getPlatform() === 'android') {
      void AndroidDirectoryAccess.addListener('mediaAction', event => this.handleMediaAction(event.action, event.position))
        .then(listener => { this.mediaActionListener = listener; })
        .catch(() => undefined);
    }
  }

  ngOnDestroy(): void {
    this.currentMedia?.pause();
    this.setPlaybackAwake(false);
    void this.mediaActionListener?.remove();
    this.syncMediaNotification(true, false);
    for (const item of this.playlist) this.releasePlaylistItem(item);
    if (this.messageFadeTimer) clearTimeout(this.messageFadeTimer);
    if (this.messageClearTimer) clearTimeout(this.messageClearTimer);
  }

  get currentItem(): PlaylistItem | null {
    return this.playlist[this.currentIndex] ?? null;
  }

  get currentBookmarks(): PlayerBookmark[] {
    const item = this.currentItem;
    return item ? this.bookmarksByFile[item.key] ?? [] : [];
  }

  get canSeek(): boolean {
    return this.currentItem?.kind === 'audio' || this.currentItem?.kind === 'video';
  }

  loadFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;

    const newItems = files.map(file => this.createPlaylistItem(file));
    if (this.currentIndex < 0) {
      this.playlist = newItems;
      this.currentIndex = 0;
      this.currentTime = 0;
      this.duration = 0;
      this.isPlaying = false;
      this.showPlaybackControls = true;
      this.imageZoom = 1;
      this.imagePanX = 0;
      this.imagePanY = 0;
      this.pdfZoom = 1;
    } else {
      this.playlist = [...this.playlist, ...newItems];
    }
    if (this.currentItem) this.currentFileNameChange.emit(this.currentItem.file.name);
    this.setMessage('');
    this.syncMediaNotification(true);
  }

  selectFile(index: number): void {
    if (index < 0 || index >= this.playlist.length || index === this.currentIndex) return;
    this.currentMedia?.pause();
    this.currentIndex = index;
    this.currentTime = 0;
    this.duration = 0;
    this.isPlaying = false;
    this.showPlaybackControls = true;
    this.imageZoom = 1;
    this.imagePanX = 0;
    this.imagePanY = 0;
    this.pdfZoom = 1;
    this.currentFileNameChange.emit(this.currentItem?.file.name ?? '');
    this.syncMediaNotification(true);
  }

  imageZoomPercent(): number { return Math.round(this.imageZoom * 100); }

  adjustImageZoom(amount: number): void {
    this.imageZoom = this.clampImageZoom(this.imageZoom + amount);
    if (this.imageZoom <= 1) { this.imagePanX = 0; this.imagePanY = 0; }
  }

  resetImageZoom(): void { this.imageZoom = 1; this.imagePanX = 0; this.imagePanY = 0; }

  adjustPdfZoom(amount: number): void { this.pdfZoom = Math.max(0.5, Math.min(4, this.pdfZoom + amount)); }

  resetPdfZoom(): void { this.pdfZoom = 1; }

  onImagePointerDown(event: PointerEvent): void {
    if (this.currentItem?.kind !== 'image' || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.imagePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.imagePointers.size >= 2) {
      const [first, second] = [...this.imagePointers.values()];
      this.pinchStartDistance = this.pointerDistance(first, second);
      this.pinchStartZoom = this.imageZoom;
      this.dragPointerId = null;
      this.touchPanPointerId = null;
    } else if (event.pointerType === 'touch' && this.imageZoom > 1) {
      this.touchPanPointerId = event.pointerId;
      this.touchPanStartX = event.clientX;
      this.touchPanStartY = event.clientY;
      this.touchPanStartOffsetX = this.imagePanX;
      this.touchPanStartOffsetY = this.imagePanY;
    } else if (event.pointerType === 'mouse') {
      this.dragPointerId = event.pointerId;
      this.dragStartY = event.clientY;
      this.dragStartZoom = this.imageZoom;
    }
  }

  onImagePointerMove(event: PointerEvent): void {
    if (!this.imagePointers.has(event.pointerId)) return;
    event.preventDefault();
    this.imagePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.imagePointers.size >= 2 && this.pinchStartDistance > 0) {
      const [first, second] = [...this.imagePointers.values()];
      this.imageZoom = this.clampImageZoom(this.pinchStartZoom * this.pointerDistance(first, second) / this.pinchStartDistance);
      if (this.imageZoom <= 1) { this.imagePanX = 0; this.imagePanY = 0; }
    } else if (event.pointerType === 'touch' && event.pointerId === this.touchPanPointerId && this.imageZoom > 1) {
      const stage = (event.currentTarget as HTMLElement).closest('.viewer-stage');
      if (!stage) return;
      this.imagePanX = this.clamp(this.touchPanStartOffsetX + event.clientX - this.touchPanStartX, -stage.clientWidth * (this.imageZoom - 1), 0);
      this.imagePanY = this.clamp(this.touchPanStartOffsetY + event.clientY - this.touchPanStartY, -stage.clientHeight * (this.imageZoom - 1), 0);
    } else if (event.pointerId === this.dragPointerId) {
      // Arrastrar hacia abajo acerca; hacia arriba aleja.
      this.imageZoom = this.clampImageZoom(this.dragStartZoom + (event.clientY - this.dragStartY) / 120);
    }
  }

  onImagePointerEnd(event: PointerEvent): void {
    this.imagePointers.delete(event.pointerId);
    if (this.imagePointers.size < 2) this.pinchStartDistance = 0;
    if (event.pointerId === this.dragPointerId) this.dragPointerId = null;
    if (event.pointerId === this.touchPanPointerId) this.touchPanPointerId = null;
  }

  private pointerDistance(first: { x: number; y: number }, second: { x: number; y: number }): number {
    return Math.hypot(second.x - first.x, second.y - first.y);
  }

  private clampImageZoom(value: number): number { return Math.max(0.5, Math.min(5, value)); }

  private clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }

  togglePlaybackControls(): void {
    if (this.canSeek) this.showPlaybackControls = !this.showPlaybackControls;
  }

  mediaStarted(): void {
    this.isPlaying = true;
    this.showPlaybackControls = true;
    this.setPlaybackAwake(true);
    this.syncMediaNotification(true);
  }

  mediaPaused(): void {
    this.isPlaying = false;
    this.showPlaybackControls = true;
    this.setPlaybackAwake(false);
    this.syncMediaNotification(true);
  }

  private setPlaybackAwake(active: boolean): void {
    if (Capacitor.getPlatform() === 'android') {
      void AndroidDirectoryAccess.setPlaybackAwake({ active }).catch(() => undefined);
    }
  }

  private syncMediaNotification(force = false, active = this.canSeek): void {
    if (Capacitor.getPlatform() !== 'android') return;
    const now = Date.now();
    if (!force && now - this.lastNotificationUpdate < 1000) return;
    this.lastNotificationUpdate = now;
    void AndroidDirectoryAccess.setMediaNotification({
      active,
      title: this.currentItem?.file.name ?? '',
      isPlaying: this.isPlaying,
      position: Math.round(this.currentTime * 1000),
      duration: Math.round(this.duration * 1000)
    }).catch(() => undefined);
  }

  private handleMediaAction(action: string, position?: number): void {
    if (action === 'play') { void this.play(); return; }
    if (action === 'pause') { this.currentMedia?.pause(); return; }
    if (action === 'rewind') { this.seekBy(-10); return; }
    if (action === 'forward') { this.seekBy(10); return; }
    if (action === 'seek' && position !== undefined && this.currentMedia) {
      this.currentMedia.currentTime = Math.max(0, Math.min(this.duration || position / 1000, position / 1000));
      this.currentTime = this.currentMedia.currentTime;
      this.syncMediaNotification(true);
      return;
    }
    if (action === 'bookmark') this.addBookmark();
  }

  previous(): void {
    this.selectFile(this.currentIndex - 1);
  }

  next(autoPlay = false): void {
    if (this.currentIndex >= this.playlist.length - 1) {
      this.isPlaying = false;
      return;
    }
    this.autoplayOnAttach = autoPlay && ['audio', 'video'].includes(this.playlist[this.currentIndex + 1].kind);
    this.selectFile(this.currentIndex + 1);
  }

  async togglePlayback(): Promise<void> {
    if (!this.currentMedia) return;
    if (this.currentMedia.paused) await this.play();
    else {
      this.currentMedia.pause();
      this.isPlaying = false;
    }
  }

  async play(): Promise<void> {
    if (!this.currentMedia) return;
    try {
      await this.currentMedia.play();
      this.isPlaying = true;
      this.setMessage('');
    } catch {
      this.isPlaying = false;
      this.setMessage('El navegador no pudo reproducir este archivo.');
    }
  }

  seekBy(seconds: number): void {
    if (!this.currentMedia || !Number.isFinite(this.duration)) return;
    this.currentMedia.currentTime = Math.max(0, Math.min(this.duration, this.currentMedia.currentTime + seconds));
    this.currentTime = this.currentMedia.currentTime;
    this.syncMediaNotification(true);
  }

  seekTo(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!this.currentMedia || !Number.isFinite(value)) return;
    this.currentMedia.currentTime = value;
    this.currentTime = value;
    this.syncMediaNotification(true);
  }

  updateTime(): void {
    if (this.currentMedia) {
      this.currentTime = this.currentMedia.currentTime;
      this.syncMediaNotification();
    }
  }

  updateDuration(): void {
    if (this.currentMedia && Number.isFinite(this.currentMedia.duration)) {
      this.duration = this.currentMedia.duration;
      this.syncMediaNotification(true);
    }
  }

  addBookmark(): void {
    const item = this.currentItem;
    if (!item || !this.canSeek) return;
    const time = this.currentMedia?.currentTime ?? this.currentTime;
    const bookmarks = [...this.currentBookmarks, { time, label: this.formatTime(time) }];
    this.config.saveBookmarks({ ...this.bookmarksByFile, [item.key]: bookmarks });
    this.setMessage(`Marcador guardado en ${this.formatTime(time)}.`);
  }

  openBookmarksModal(): void { this.bookmarksModalOpen = true; }

  closeBookmarksModal(): void { this.bookmarksModalOpen = false; }

  deleteBookmark(index: number): void {
    const item = this.currentItem;
    if (!item) return;
    const remaining = this.currentBookmarks.filter((_, bookmarkIndex) => bookmarkIndex !== index);
    const updated = { ...this.bookmarksByFile };
    if (remaining.length) updated[item.key] = remaining;
    else delete updated[item.key];
    this.config.saveBookmarks(updated);
    this.setMessage('Marcador eliminado.');
  }

  private setMessage(message: string): void {
    if (this.messageFadeTimer) clearTimeout(this.messageFadeTimer);
    if (this.messageClearTimer) clearTimeout(this.messageClearTimer);
    this.message = message;
    this.messageFading = false;
    if (!message) return;
    this.messageFadeTimer = setTimeout(() => { this.messageFading = true; }, 2500);
    this.messageClearTimer = setTimeout(() => { this.message = ''; this.messageFading = false; }, 3000);
  }

  goToBookmark(bookmark: PlayerBookmark): void {
    if (!this.currentMedia) return;
    this.currentMedia.currentTime = Math.min(bookmark.time, this.duration || bookmark.time);
    this.currentTime = this.currentMedia.currentTime;
  }

  formatTime(seconds: number): string {
    if (!Number.isFinite(seconds)) return '00:00';
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainder = total % 60;
    return hours
      ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
      : `${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  }

  private getMediaKind(file: File | LibraryMediaSource): MediaKind {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (file.type.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'oga', 'aac', 'm4a', 'flac', 'opus', 'weba'].includes(extension)) return 'audio';
    if (file.type.startsWith('video/') || ['mp4', 'm4v', 'webm', 'ogv', 'mov', 'avi', 'mkv', 'mpeg', 'mpg'].includes(extension)) return 'video';
    if (file.type.startsWith('image/') || ['avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp'].includes(extension)) return 'image';
    if (file.type === 'application/pdf' || extension === 'pdf') return 'pdf';
    return 'other';
  }

  private createPlaylistItem(file: File | LibraryMediaSource): PlaylistItem {
    const isNativeSource = this.isNativeSource(file);
    const url = isNativeSource ? file.url : URL.createObjectURL(file);
    return {
      file,
      url,
      safeUrl: this.sanitizer.bypassSecurityTrustResourceUrl(url),
      kind: this.getMediaKind(file),
      key: `${file.name}:${file.size}:${file.lastModified}`,
      ownsObjectUrl: !isNativeSource
    };
  }

  private isNativeSource(file: File | LibraryMediaSource): file is LibraryMediaSource {
    return 'source' in file && file.source === 'android';
  }

  private releasePlaylistItem(item: PlaylistItem): void {
    if (item.ownsObjectUrl) URL.revokeObjectURL(item.url);
  }

  private canPlayItem(item: PlaylistItem): boolean {
    return item.kind === 'audio' || item.kind === 'video';
  }
}
