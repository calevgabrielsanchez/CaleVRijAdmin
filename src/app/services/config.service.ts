import { Injectable, signal } from '@angular/core';
import { ProjectDirectoryHandle, ProjectFileHandle } from '../components/view-content.component/project-library-manager.component';

export interface PlayerBookmark {
  time: number;
  label: string;
  title?: string;
  note?: string;
}

export type PlayerBookmarkRecord = Record<string, PlayerBookmark[]>;
export type PlayerProgressRecord = Record<string, number>;

export interface PlayerLibraryConfig {
  id: string;
  name: string;
  createdAt?: string;
  cover?: string;
}

export interface AppNote {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
}

export interface AppConfig {
  version: number;
  updatedAt: string;
  activeSection?: string;
  playerLibraryId?: string;
  playerLibraryName?: string;
}

interface ConfigFileMap {
  config: AppConfig;
  bookmarks: PlayerBookmarkRecord;
  playerLibraries: PlayerLibraryConfig[];
  notes: AppNote[];
  playerProgress: PlayerProgressRecord;
}

const CONFIG_FOLDER = '.calevri';
const FILES: Record<keyof ConfigFileMap, string> = {
  config: 'config.json',
  bookmarks: 'player-bookmarks.json',
  playerLibraries: 'player-libraries.json',
  notes: 'notes.json',
  playerProgress: 'player-progress.json'
};
const README = [
  'Carpeta de configuración de CaleVRijAdmin.',
  '',
  'Aquí se guardan en archivos JSON los datos que deben viajar entre dispositivos:',
  '- config.json: preferencias generales de la aplicación.',
  '- player-bookmarks.json: marcadores del reproductor.',
  '- player-libraries.json: registro de las bibliotecas del reproductor.',
  '- player-progress.json: posiciones guardadas de audio y video.',
  '- notes.json: notas de la aplicación.',
  '',
  'Esta carpeta se sincroniza junto con el resto de la biblioteca principal.',
  'No borres los archivos si quieres conservar la configuración.'
].join('\n');

type WritableFile = Awaited<ReturnType<ProjectFileHandle['createWritable']>>;

@Injectable({ providedIn: 'root' })
export class ConfigService {
  readonly root = signal<ProjectDirectoryHandle | null>(null);
  readonly folderName = CONFIG_FOLDER;
  readonly config = signal<AppConfig>(this.emptyConfig());
  readonly bookmarks = signal<PlayerBookmarkRecord>({});
  readonly playerLibraries = signal<PlayerLibraryConfig[]>([]);
  readonly notes = signal<AppNote[]>([]);
  readonly playerProgress = signal<PlayerProgressRecord>({});
  readonly ready = signal(false);
  readonly message = signal('');

  private folder: ProjectDirectoryHandle | null = null;
  private loadPromise: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private saveTimers = new Map<keyof ConfigFileMap, ReturnType<typeof setTimeout>>();

  constructor() {}

  async configure(root: ProjectDirectoryHandle | null): Promise<void> {
    this.root.set(root);
    this.folder = null;
    this.loadPromise = null;
    this.config.set(this.emptyConfig());
    this.bookmarks.set({});
    this.playerLibraries.set([]);
    this.notes.set([]);
    this.playerProgress.set({});
    if (!root) {
      this.ready.set(true);
      return;
    }
    await this.reload();
  }

  reload(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.loadFromFolder().finally(() => {
      this.loadPromise = null;
      this.ready.set(true);
    });
    return this.loadPromise;
  }

  whenReady(): Promise<void> {
    return this.ready() ? Promise.resolve() : this.reload().catch(() => undefined);
  }

  saveBookmarks(record: PlayerBookmarkRecord): void {
    this.bookmarks.set(record);
    this.schedulePersist('bookmarks');
  }

  savePlayerLibraries(libraries: PlayerLibraryConfig[]): void {
    this.playerLibraries.set(libraries);
    this.schedulePersist('playerLibraries');
  }

  saveNotes(notes: AppNote[]): void {
    this.notes.set(notes);
    this.schedulePersist('notes');
  }

  savePlaybackProgress(key: string, time: number): void {
    if (!key || !Number.isFinite(time)) return;
    const next = { ...this.playerProgress(), [key]: Math.max(0, time) };
    this.playerProgress.set(next);
    this.schedulePersist('playerProgress');
  }

  playbackProgress(key: string): number {
    return this.playerProgress()[key] ?? 0;
  }

  saveConfig(config: AppConfig): void {
    const next = { ...config, updatedAt: new Date().toISOString() };
    this.config.set(next);
    this.schedulePersist('config');
  }

  async flush(): Promise<void> {
    const pending = [...this.saveTimers.keys()];
    for (const timer of this.saveTimers.values()) clearTimeout(timer);
    this.saveTimers.clear();
    for (const key of pending) {
      this.writeQueue = this.writeQueue
        .then(() => this.persist(key))
        .catch(error => {
          this.message.set(`No se pudo guardar ${FILES[key]}.`);
          console.warn(`No se pudo guardar ${FILES[key]}.`, error);
        });
    }
    await this.writeQueue;
  }

  private emptyConfig(): AppConfig {
    return { version: 1, updatedAt: new Date(0).toISOString() };
  }

  private async loadFromFolder(): Promise<void> {
    const root = this.root();
    if (!root) return;
    try {
      const folder = await root.getDirectoryHandle(CONFIG_FOLDER, { create: true });
      this.folder = folder;
      const config = await this.readFile<AppConfig>(folder, 'config');
      const bookmarks = await this.readFile<PlayerBookmarkRecord>(folder, 'bookmarks');
      const playerLibraries = await this.readFile<PlayerLibraryConfig[]>(folder, 'playerLibraries');
      const notes = await this.readFile<AppNote[]>(folder, 'notes');
      const playerProgress = await this.readFile<PlayerProgressRecord>(folder, 'playerProgress');

      if (config) this.config.set(config);
      if (bookmarks && this.isBookmarkRecord(bookmarks)) this.bookmarks.set(bookmarks);
      if (Array.isArray(playerLibraries)) {
        const valid = playerLibraries.filter(item => !!item && typeof item.id === 'string' && typeof item.name === 'string');
        const merged = [...valid];
        for (const item of this.playerLibraries()) {
          if (!merged.some(existing => existing.id === item.id || existing.name === item.name)) merged.push(item);
        }
        this.playerLibraries.set(merged);
      }
      if (Array.isArray(notes)) this.notes.set(notes.filter(item => !!item && typeof item.id === 'string'));
      if (playerProgress && typeof playerProgress === 'object' && !Array.isArray(playerProgress)) {
        this.playerProgress.set(Object.fromEntries(Object.entries(playerProgress).filter(([, time]) => typeof time === 'number' && Number.isFinite(time) && time >= 0)));
      }

      await this.writeIfMissing(folder, 'config', this.config());
      await this.writeIfMissing(folder, 'bookmarks', this.bookmarks());
      await this.writeIfMissing(folder, 'playerLibraries', this.playerLibraries());
      await this.writeIfMissing(folder, 'notes', this.notes());
      await this.writeIfMissing(folder, 'playerProgress', this.playerProgress());
      await this.writeIfMissingText(folder, 'README.txt', README);
      this.message.set(`Configuración cargada desde ${CONFIG_FOLDER}/.`);
    } catch (error) {
      this.message.set(`No se pudo leer o escribir en ${CONFIG_FOLDER}/. No se guardaron cambios en el navegador.`);
      console.warn('No se pudo leer la carpeta de configuración.', error);
    }
  }

  private schedulePersist(key: keyof ConfigFileMap): void {
    const timer = this.saveTimers.get(key);
    if (timer) clearTimeout(timer);
    this.saveTimers.set(key, setTimeout(() => {
      this.saveTimers.delete(key);
      this.writeQueue = this.writeQueue
        .then(() => this.persist(key))
        .catch(error => {
          this.message.set(`No se pudo guardar ${FILES[key]}.`);
          console.warn(`No se pudo guardar ${FILES[key]}.`, error);
        });
    }, 350));
  }

  private async persist(key: keyof ConfigFileMap): Promise<void> {
    if (!this.folder) {
      const root = this.root();
      if (!root) {
        this.message.set('Selecciona la carpeta raíz para guardar los cambios en .calevri/.');
        return;
      }
      try {
        this.folder = await root.getDirectoryHandle(CONFIG_FOLDER, { create: true });
      } catch {
        return;
      }
    }
    const value = this.valueFor(key);
    const handle = await this.folder.getFileHandle(FILES[key], { create: true });
    const writer: WritableFile = await handle.createWritable();
    await writer.write(JSON.stringify(value, null, 2));
    await writer.close();
  }

  private valueFor(key: keyof ConfigFileMap): unknown {
    switch (key) {
      case 'config': return this.config();
      case 'bookmarks': return this.bookmarks();
      case 'playerLibraries': return this.playerLibraries();
      case 'notes': return this.notes();
      case 'playerProgress': return this.playerProgress();
    }
  }

  private async readFile<T>(folder: ProjectDirectoryHandle, key: keyof ConfigFileMap): Promise<T | null> {
    try {
      const handle = await folder.getFileHandle(FILES[key]);
      const file = await handle.getFile();
      return JSON.parse(await file.text()) as T;
    } catch {
      return null;
    }
  }

  private async writeIfMissing(folder: ProjectDirectoryHandle, key: keyof ConfigFileMap, value: unknown): Promise<void> {
    try {
      await folder.getFileHandle(FILES[key]);
    } catch {
      const handle = await folder.getFileHandle(FILES[key], { create: true });
      const writer = await handle.createWritable();
      await writer.write(JSON.stringify(value, null, 2));
      await writer.close();
    }
  }

  private async writeIfMissingText(folder: ProjectDirectoryHandle, name: string, value: string): Promise<void> {
    try {
      await folder.getFileHandle(name);
    } catch {
      const handle = await folder.getFileHandle(name, { create: true });
      const writer = await handle.createWritable();
      await writer.write(value);
      await writer.close();
    }
  }

  private isBookmarkRecord(value: unknown): value is PlayerBookmarkRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.values(value).every(bookmarks =>
      Array.isArray(bookmarks) && bookmarks.every(bookmark =>
        !!bookmark
        && typeof bookmark === 'object'
        && typeof (bookmark as PlayerBookmark).time === 'number'
        && Number.isFinite((bookmark as PlayerBookmark).time)
        && typeof (bookmark as PlayerBookmark).label === 'string'
      )
    );
  }
}
