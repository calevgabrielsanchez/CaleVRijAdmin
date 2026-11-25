import { Injectable, inject, signal } from '@angular/core';
import { ProjectDirectoryHandle, ProjectFileHandle } from '../view-content.component/project-library-manager.component';
import { CloudLibrarySyncService } from '../../services/cloud-library-sync.service';
import { Creatividad, CreatividadData, Dibujo, Memoria } from './creatividad.models';

type Entity = { id: string; updatedAt: number; _deleted: boolean; nombre?: string };
interface CreativityIndex {
  version?: number;
  creatividad: Entity[];
  memorias: Entity[];
  dibujos: Entity[];
  borradorCreatividad?: string;
}
type CollectionName = 'creatividad' | 'memorias' | 'dibujos';

@Injectable({ providedIn: 'root' })
export class CreatividadStorageService {
  readonly syncRefreshVersion = signal(0);
  private readonly cloudSync = inject(CloudLibrarySyncService);
  private readonly folderName = '.calevri';
  private readonly indexFileName = 'creatividad.json';
  private readonly draftFileName = 'borrador-creatividad.json';
  private readonly legacyMemoryFiles = ['memorias.json', 'memoria.json'];
  private readonly collectionFolders: Record<CollectionName, string> = {
    creatividad: 'creatividades', memorias: 'memorias', dibujos: 'dibujos'
  };

  notifySyncedDataChanged(): void { this.syncRefreshVersion.update(version => version + 1); }

  async load(root: ProjectDirectoryHandle): Promise<CreatividadData> {
    const current = await this.readIndex(root);
    const [legacyMemories, legacyMemory] = await Promise.all([
      this.readLegacyArray<Memoria>(root, 'memorias.json', 'memorias'),
      this.readLegacyArray<Memoria>(root, 'memoria.json', 'memorias')
    ]);
    const [individualCreativity, individualMemories, individualDrawings] = await Promise.all([
      this.readAllRecordFiles<Creatividad>(root, 'creatividad'),
      this.readAllRecordFiles<Memoria>(root, 'memorias'),
      this.readAllRecordFiles<Dibujo>(root, 'dibujos')
    ]);
    const legacyCreatividad = current ? [] : await this.readLegacyArray<Creatividad>(root, this.indexFileName, 'creatividad');
    const memoryRefs = this.mergeById(legacyMemory, legacyMemories, individualMemories, (current?.memorias ?? []) as unknown as Memoria[]);
    const creativityRefs = this.mergeById(legacyCreatividad, individualCreativity, (current?.creatividad ?? []) as unknown as Creatividad[]);
    const drawingRefs = this.mergeById(individualDrawings, (current?.dibujos ?? []) as unknown as Dibujo[]);

    const [creatividad, memorias, dibujos] = await Promise.all([
      this.loadCollection<Creatividad>(root, 'creatividad', creativityRefs, legacyCreatividad),
      this.loadCollection<Memoria>(root, 'memorias', memoryRefs, [...legacyMemory, ...legacyMemories]),
      this.loadCollection<Dibujo>(root, 'dibujos', drawingRefs, [])
    ]);
    const borradorCreatividad = await this.readDraft(root) ?? current?.borradorCreatividad ?? '';

    const indexedMemoryIds = new Set((current?.memorias ?? []).map(memory => memory.id));
    const migrationNeeded = !current || legacyMemories.length > 0 || legacyMemory.length > 0 || legacyCreatividad.length > 0
      || individualMemories.some(memory => !indexedMemoryIds.has(memory.id))
      || [...individualCreativity, ...individualDrawings].some(item =>
        ![...(current?.creatividad ?? []), ...(current?.dibujos ?? [])].some(ref => ref.id === item.id))
      || [ ...(current?.creatividad ?? []), ...(current?.memorias ?? []), ...(current?.dibujos ?? []) ].some(item => this.hasEntityContent(item));
    if (migrationNeeded) {
      await this.writeIndex(root, { creatividad, memorias, dibujos });
      await this.writeDraft(root, borradorCreatividad);
      await this.removeLegacyMemoryFiles(root);
      this.notifySyncedDataChanged();
      this.cloudSync.scheduleSync();
    }
    return { creatividad, memorias, dibujos, borradorCreatividad };
  }

  async save(root: ProjectDirectoryHandle, data: CreatividadData): Promise<void> {
    const loaded = await this.load(root); // Migra cualquier dato anterior antes de actualizar el índice.
    const current = await this.readIndex(root);
    const creativity = this.mergeById((current?.creatividad ?? []) as unknown as Creatividad[], loaded.creatividad, data.creatividad);
    const memories = this.mergeById((current?.memorias ?? []) as unknown as Memoria[], loaded.memorias, data.memorias);
    const drawings = this.mergeById((current?.dibujos ?? []) as unknown as Dibujo[], loaded.dibujos, data.dibujos);
    const fullCreativity = this.mergeById(loaded.creatividad, data.creatividad);
    const fullMemories = this.mergeById(loaded.memorias, data.memorias);
    const fullDrawings = this.mergeById(loaded.dibujos, data.dibujos);
    await Promise.all([
      this.saveCollection(root, 'creatividad', creativity, fullCreativity),
      this.saveCollection(root, 'memorias', memories, fullMemories),
      this.saveCollection(root, 'dibujos', drawings, fullDrawings)
    ]);
    await this.writeIndex(root, { creatividad: creativity, memorias: memories, dibujos: drawings });
    await this.writeDraft(root, data.borradorCreatividad ?? '');
    await this.removeLegacyMemoryFiles(root);
    this.notifySyncedDataChanged();
    this.cloudSync.scheduleSync();
  }

  async deleteMemory(root: ProjectDirectoryHandle, id: string): Promise<void> {
    await this.load(root);
    const current = await this.readIndex(root);
    const memories = (current?.memorias ?? []) as unknown as Memoria[];
    const previous = memories.find(memory => memory.id === id);
    if (!previous) return;
    const tombstone = { ...previous, updatedAt: Date.now(), _deleted: true } as Memoria;
    await this.writeIndex(root, {
      creatividad: (current?.creatividad ?? []) as unknown as Creatividad[],
      memorias: this.mergeById(memories, [tombstone]),
      dibujos: (current?.dibujos ?? []) as unknown as Dibujo[]
    });
    await this.removeRecordFile(root, 'memorias', id);
    this.notifySyncedDataChanged();
    this.cloudSync.scheduleSync();
  }

  private async loadCollection<T extends Entity>(root: ProjectDirectoryHandle, collection: CollectionName, refs: T[], fallback: T[]): Promise<T[]> {
    const fallbackById = new Map(fallback.map(item => [item.id, item]));
    const resolved: T[] = [];
    for (const ref of refs) {
      if (ref._deleted) continue;
      const existing = await this.readRecordFile<T>(root, collection, ref.id);
      let record = existing ?? (this.hasEntityContent(ref) ? ref : fallbackById.get(ref.id));
      if (!record) continue;
      record = { ...record, id: ref.id, updatedAt: Math.max(record.updatedAt ?? 0, ref.updatedAt ?? 0), _deleted: false };
      resolved.push(record);
      if (!existing) await this.writeRecordFile(root, collection, record);
    }
    return resolved;
  }

  private async saveCollection<T extends Entity>(root: ProjectDirectoryHandle, collection: CollectionName, refs: T[], incoming: T[]): Promise<void> {
    const latest = new Map(incoming.map(item => [item.id, item]));
    for (const ref of refs) {
      if (ref._deleted) { await this.removeRecordFile(root, collection, ref.id); continue; }
      const record = latest.get(ref.id);
      if (record) await this.writeRecordFile(root, collection, record);
    }
  }

  private async readIndex(root: ProjectDirectoryHandle): Promise<CreativityIndex | null> {
    try {
      const folder = await root.getDirectoryHandle(this.folderName);
      const file = await (await folder.getFileHandle(this.indexFileName)).getFile();
      const text = (await file.text()).trim();
      if (!text) return null;
      const parsed = JSON.parse(text) as Partial<CreativityIndex>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return {
        creatividad: Array.isArray(parsed.creatividad) ? parsed.creatividad as Entity[] : [],
        memorias: Array.isArray(parsed.memorias) ? parsed.memorias as Entity[] : [],
        dibujos: Array.isArray(parsed.dibujos) ? parsed.dibujos as Entity[] : [],
        borradorCreatividad: typeof parsed.borradorCreatividad === 'string' ? parsed.borradorCreatividad : undefined
      };
    } catch (error) {
      if ((error as DOMException)?.name === 'NotFoundError' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  private async writeIndex(root: ProjectDirectoryHandle, data: { creatividad: Entity[]; memorias: Entity[]; dibujos: Entity[] }): Promise<void> {
    const payload: CreativityIndex = {
      version: 2,
      creatividad: data.creatividad.map(item => this.toMetadata(item)),
      memorias: data.memorias.map(item => this.toMetadata(item)),
      dibujos: data.dibujos.map(item => this.toMetadata(item))
    };
    const folder = await root.getDirectoryHandle(this.folderName, { create: true });
    const handle = await folder.getFileHandle(this.indexFileName, { create: true });
    await this.writeFileAtomically(handle, JSON.stringify(payload, null, 2));
  }

  private toMetadata(item: Entity): Entity {
    return {
      id: item.id,
      nombre: typeof item.nombre === 'string' ? item.nombre : item.id,
      updatedAt: Number(item.updatedAt) || Date.now(),
      _deleted: Boolean(item._deleted)
    };
  }

  private async readRecordFile<T extends Entity>(root: ProjectDirectoryHandle, collection: CollectionName, id: string): Promise<T | null> {
    try {
      const folder = await (await root.getDirectoryHandle(this.folderName)).getDirectoryHandle(this.collectionFolders[collection]);
      const file = await (await folder.getFileHandle(this.recordFileName(id))).getFile();
      const parsed = JSON.parse(await file.text()) as T;
      return parsed && parsed.id === id ? parsed : null;
    } catch { return null; }
  }

  private async readAllRecordFiles<T extends Entity>(root: ProjectDirectoryHandle, collection: CollectionName): Promise<T[]> {
    const records: T[] = [];
    try {
      const folder = await (await root.getDirectoryHandle(this.folderName)).getDirectoryHandle(this.collectionFolders[collection]);
      for await (const [name, entry] of folder.entries()) {
        if (entry.kind !== 'file' || !name.toLowerCase().endsWith('.json')) continue;
        try {
          const parsed = JSON.parse(await (await entry.getFile()).text()) as T;
          if (parsed && typeof parsed.id === 'string' && !parsed._deleted) records.push(parsed);
        } catch { /* Se ignora el archivo de memoria dañado y se conservan los demás. */ }
      }
    } catch { /* La carpeta individual aún no existe. */ }
    return records;
  }

  private async writeRecordFile<T extends Entity>(root: ProjectDirectoryHandle, collection: CollectionName, record: T): Promise<void> {
    const configFolder = await root.getDirectoryHandle(this.folderName, { create: true });
    const folder = await configFolder.getDirectoryHandle(this.collectionFolders[collection], { create: true });
    const handle = await folder.getFileHandle(this.recordFileName(record.id), { create: true });
    await this.writeFileAtomically(handle, JSON.stringify(record, null, 2));
  }

  private async removeRecordFile(root: ProjectDirectoryHandle, collection: CollectionName, id: string): Promise<void> {
    try {
      const folder = await (await root.getDirectoryHandle(this.folderName)).getDirectoryHandle(this.collectionFolders[collection]);
      await folder.removeEntry(this.recordFileName(id));
    } catch { /* La entrada puede no existir si ya fue eliminada. */ }
  }

  private recordFileName(id: string): string { return `${encodeURIComponent(id)}.json`; }

  private async readDraft(root: ProjectDirectoryHandle): Promise<string | null> {
    try {
      const file = await (await (await root.getDirectoryHandle(this.folderName)).getFileHandle(this.draftFileName)).getFile();
      const parsed = JSON.parse(await file.text()) as { texto?: unknown };
      return typeof parsed.texto === 'string' ? parsed.texto : null;
    } catch { return null; }
  }

  private async writeDraft(root: ProjectDirectoryHandle, text: string): Promise<void> {
    const folder = await root.getDirectoryHandle(this.folderName, { create: true });
    const handle = await folder.getFileHandle(this.draftFileName, { create: true });
    await this.writeFileAtomically(handle, JSON.stringify({ texto: text }));
  }

  private async readLegacyArray<T>(root: ProjectDirectoryHandle, fileName: string, key: string): Promise<T[]> {
    try {
      const folder = await root.getDirectoryHandle(this.folderName);
      const file = await (await folder.getFileHandle(fileName)).getFile();
      const parsed = JSON.parse((await file.text()).trim()) as unknown;
      if (Array.isArray(parsed)) return parsed as T[];
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>)[key])) {
        return (parsed as Record<string, unknown>)[key] as T[];
      }
    } catch { /* Archivo legado ausente o truncado. */ }
    return [];
  }

  private async removeLegacyMemoryFiles(root: ProjectDirectoryHandle): Promise<void> {
    try {
      const folder = await root.getDirectoryHandle(this.folderName);
      for (const name of this.legacyMemoryFiles) {
        try { await folder.removeEntry(name); } catch { /* Ya migrado o ausente. */ }
      }
    } catch { /* No hay configuración que limpiar. */ }
  }

  private hasEntityContent(item: Entity): boolean {
    return Object.keys(item).some(key => !['id', 'nombre', 'updatedAt', '_deleted'].includes(key));
  }

  private mergeById<T extends Entity>(...groups: T[][]): T[] {
    const merged = new Map<string, T>();
    for (const item of groups.flat()) {
      const previous = merged.get(item.id);
      if (!previous || Number(item.updatedAt ?? 0) >= Number(previous.updatedAt ?? 0)) merged.set(item.id, item);
    }
    return [...merged.values()];
  }

  private async writeFileAtomically(handle: ProjectFileHandle, contents: string): Promise<void> {
    const writable = await handle.createWritable();
    try { await writable.write(contents); }
    finally { await writable.close(); }
  }
}
