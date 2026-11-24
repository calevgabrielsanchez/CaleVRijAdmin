import { Injectable, signal } from '@angular/core';
import { ProjectDirectoryHandle } from '../view-content.component/project-library-manager.component';
import { Creatividad, CreatividadData, Memoria } from './creatividad.models';

@Injectable({ providedIn: 'root' })
export class CreatividadStorageService {
  readonly syncRefreshVersion = signal(0);
  private readonly folderName = '.calevri';
  private readonly fileName = 'creatividad.json';
  private readonly memoryFileName = 'memoria.json';

  notifySyncedDataChanged(): void {
    this.syncRefreshVersion.update(version => version + 1);
  }

  async load(root: ProjectDirectoryHandle): Promise<CreatividadData> {
    const [current, legacyMemorias, legacyMemoria, legacyCreatividad] = await Promise.all([
      this.readDataFile(root, this.fileName).catch(() => null),
      this.readLegacyArray<Memoria>(root, 'memorias.json', 'memorias'),
      this.readLegacyArray<Memoria>(root, this.memoryFileName, 'memorias'),
      this.readLegacyArray<Creatividad>(root, 'creatividad.json', 'creatividad')
    ]);
    return {
      creatividad: this.preferNonEmpty(current?.creatividad, legacyCreatividad),
      memorias: current?.memorias.length ? current.memorias : (legacyMemorias.length ? legacyMemorias : legacyMemoria),
      dibujos: current?.dibujos ?? [],
      borradorCreatividad: current?.borradorCreatividad ?? ''
    };
  }

  private async readDataFile(root: ProjectDirectoryHandle, fileName: string): Promise<CreatividadData | null> {
    let folder: ProjectDirectoryHandle;
    try { folder = await root.getDirectoryHandle(this.folderName); }
    catch (error) {
      if ((error as DOMException)?.name === 'NotFoundError') return null;
      throw error;
    }
    try {
      const file = await (await folder.getFileHandle(fileName)).getFile();
      const text = (await file.text()).trim();
      if (!text) return null;
      const parsed = JSON.parse(text) as Partial<CreatividadData>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return {
        creatividad: Array.isArray(parsed.creatividad) ? parsed.creatividad : [],
        memorias: Array.isArray(parsed.memorias) ? parsed.memorias : [],
        dibujos: Array.isArray(parsed.dibujos) ? parsed.dibujos : [],
        borradorCreatividad: typeof parsed.borradorCreatividad === 'string' ? parsed.borradorCreatividad : ''
      };
    } catch (error) {
      if ((error as DOMException)?.name === 'NotFoundError') return null;
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async save(root: ProjectDirectoryHandle, data: CreatividadData): Promise<void> {
    const folder = await root.getDirectoryHandle(this.folderName, { create: true });
    const handle = await folder.getFileHandle(this.fileName, { create: true });
    const merged = await this.load(root);
    const payload: CreatividadData = {
      creatividad: this.mergeById(merged.creatividad, data.creatividad),
      memorias: this.mergeById(merged.memorias, data.memorias),
      dibujos: this.mergeById(merged.dibujos, data.dibujos),
      borradorCreatividad: data.borradorCreatividad || merged.borradorCreatividad || ''
    };
    const serialized = JSON.stringify(payload, null, 2);
    await this.writeFileAtomically(handle, serialized);
    await this.writeLegacyArray(folder, 'memorias.json', payload.memorias);
    await this.writeLegacyArray(folder, this.memoryFileName, payload.memorias);
    this.notifySyncedDataChanged();
  }

  private preferNonEmpty<T>(current: T[] | undefined, legacy: T[]): T[] {
    return current?.length ? current : legacy;
  }

  private mergeById<T extends { id: string; updatedAt?: number }>(current: T[], incoming: T[]): T[] {
    const merged = new Map<string, T>();
    for (const item of [...current, ...incoming]) {
      const previous = merged.get(item.id);
      if (!previous || (item.updatedAt ?? 0) >= (previous.updatedAt ?? 0)) merged.set(item.id, item);
    }
    return [...merged.values()];
  }

  private async readLegacyArray<T>(root: ProjectDirectoryHandle, fileName: string, key: string): Promise<T[]> {
    try {
      const folder = await root.getDirectoryHandle(this.folderName);
      const file = await (await folder.getFileHandle(fileName)).getFile();
      const text = (await file.text()).trim();
      if (!text) return [];
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) return parsed as T[];
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>)[key])) {
        return (parsed as Record<string, unknown>)[key] as T[];
      }
    } catch { /* Archivo legado ausente o truncado. */ }
    return [];
  }

  private async writeLegacyArray<T>(folder: ProjectDirectoryHandle, fileName: string, values: T[]): Promise<void> {
    const handle = await folder.getFileHandle(fileName, { create: true });
    await this.writeFileAtomically(handle, JSON.stringify(values, null, 2));
  }

  private async writeFileAtomically(handle: { createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }> }, contents: string): Promise<void> {
    const writable = await handle.createWritable();
    try {
      await writable.write(contents);
    } finally {
      await writable.close();
    }
  }

  private emptyData(): CreatividadData {
    return { creatividad: [], memorias: [], dibujos: [] };
  }
}
