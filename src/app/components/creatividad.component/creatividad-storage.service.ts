import { Injectable } from '@angular/core';
import { ProjectDirectoryHandle } from '../view-content.component/project-library-manager.component';
import { CreatividadData, EMPTY_CREATIVIDAD_DATA } from './creatividad.models';

@Injectable({ providedIn: 'root' })
export class CreatividadStorageService {
  private readonly folderName = '.calevri';
  private readonly fileName = 'creatividad.json';

  async load(root: ProjectDirectoryHandle): Promise<CreatividadData> {
    let folder: ProjectDirectoryHandle;
    try { folder = await root.getDirectoryHandle(this.folderName); }
    catch (error) {
      if ((error as DOMException)?.name === 'NotFoundError') return this.emptyData();
      throw error;
    }
    try {
      const file = await (await folder.getFileHandle(this.fileName)).getFile();
      const parsed = JSON.parse(await file.text()) as Partial<CreatividadData>;
      return {
        creatividad: Array.isArray(parsed.creatividad) ? parsed.creatividad : [],
        memorias: Array.isArray(parsed.memorias) ? parsed.memorias : [],
        dibujos: Array.isArray(parsed.dibujos) ? parsed.dibujos : [],
        borradorCreatividad: typeof parsed.borradorCreatividad === 'string' ? parsed.borradorCreatividad : ''
      };
    } catch (error) {
      if ((error as DOMException)?.name === 'NotFoundError') return this.emptyData();
      throw error;
    }
  }

  async save(root: ProjectDirectoryHandle, data: CreatividadData): Promise<void> {
    const folder = await root.getDirectoryHandle(this.folderName, { create: true });
    const handle = await folder.getFileHandle(this.fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  }

  private emptyData(): CreatividadData {
    return { creatividad: [], memorias: [], dibujos: [] };
  }
}
