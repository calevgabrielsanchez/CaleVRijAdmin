import { Injectable, signal } from '@angular/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ProjectDirectoryHandle, ProjectFileHandle } from '../components/view-content.component/project-library-manager.component';

const SUPABASE_URL = 'https://qwqddhyrjdujgypsxirl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_XO-Atj3pA2-WKBZ66w3JRA_ous1OZMB';
const TABLE = 'calevrij_library_nodes';
const META_FOLDER = '.calevri';
const NODE_ID_FILE = 'cloud-node-id.json';
const SYNC_STATE_FILE = 'cloud-sync-state.json';
const ERROR_CACHE_FILE = 'cloud-sync-errors.json';
const ROOT_ID = '00000000-0000-4000-8000-000000000001';
const CLOUD_REQUEST_TIMEOUT_MS = 45_000;
const LOCAL_FILE_TIMEOUT_MS = 60_000;
const LOCAL_SCAN_TIMEOUT_MS = 300_000;
const CLOUD_PAGE_SIZE = 250;

interface CloudFile { name: string; content: string; lastModified: number }
interface CloudChild { id: string; name: string }
interface CloudSnapshotNode { id: string; parent_id: string; name: string; data: { files: CloudFile[]; children: CloudChild[] }; folders: CloudSnapshotNode[] }
interface CloudData { files: CloudFile[]; children: CloudChild[]; tree?: CloudSnapshotNode[] }
interface CloudNode {
  id: string; parent_id: string | null; name: string; data: CloudData;
  updated_at: string; deleted_at: string | null;
}
interface LocalState { updatedAt: string; fingerprint: string; tombstones: CloudNode[] }
export interface CloudSyncError { at: string; phase: string; message: string; details: string }
export interface CloudSyncProgress { active: boolean; phase: string; current: number; total: number | null }
interface LocalNode extends CloudNode { directory: ProjectDirectoryHandle; parentDirectory: ProjectDirectoryHandle | null; depth: number }
type Writable = Awaited<ReturnType<ProjectFileHandle['createWritable']>>;

@Injectable({ providedIn: 'root' })
export class CloudLibrarySyncService {
  readonly status = signal('Sincronización cloud lista.');
  readonly syncing = signal(false);
  readonly manualSyncing = signal(false);
  readonly revision = signal(0);
  readonly errors = signal<CloudSyncError[]>([]);
  readonly progress = signal<CloudSyncProgress>({ active: false, phase: '', current: 0, total: null });
  readonly result = signal('');
  readonly cancelled = signal(false);
  readonly completed = signal(false);
  private clientPromise?: Promise<SupabaseClient>;
  private root: ProjectDirectoryHandle | null = null;
  private state: LocalState = { updatedAt: new Date(0).toISOString(), fingerprint: '', tombstones: [] };
  private running: Promise<void> | null = null;
  private currentPhase = 'Preparando la sincronización';
  private abortController: AbortController | null = null;

  constructor() {
    // Supabase sync is intentionally user-initiated only.
  }

  async setRoot(root: ProjectDirectoryHandle | null): Promise<void> {
    if (this.running) await this.running;
    this.root = root;
    this.state = { updatedAt: new Date(0).toISOString(), fingerprint: '', tombstones: [] };
    if (!root) return;
    await this.loadErrorCache(root);
  }

  async markDeleted(directory: ProjectDirectoryHandle, name: string): Promise<void> {
    await this.loadState();
    const localNodes = this.root ? await this.scanLocal(this.root) : [];
    const localById = new Map(localNodes.map(node => [node.id, node]));
    const addTombstones = async (current: ProjectDirectoryHandle, parentId: string | null): Promise<void> => {
      const id = await this.readNodeId(current);
      const now = new Date().toISOString();
      const tombstone: CloudNode = { id, parent_id: parentId, name: current.name || name, data: { files: [], children: [] }, updated_at: now, deleted_at: now };
      this.state.tombstones = [...this.state.tombstones.filter(item => item.id !== id), tombstone];
      for await (const [, child] of this.readEntries(current)) {
        if (child.kind === 'directory' && child.name !== META_FOLDER) await addTombstones(child, id);
      }
    };
    await addTombstones(directory, localById.get(await this.readNodeId(directory))?.parent_id ?? null);
    await this.saveState();
  }

  async markDeletedFile(directory: ProjectDirectoryHandle, name: string): Promise<void> {
    if (!this.root) return;
    await this.loadState();
    const deletedAt = Date.now();
    const nodes = await this.scanLocal(this.root);
    const directoryId = await this.readNodeId(directory);
    const parent = nodes.find(node => node.id === directoryId);
    if (!parent) return;
    const tombstone: CloudNode = {
      id: `file:${parent.id}:${encodeURIComponent(name)}`,
      parent_id: parent.id,
      name,
      data: { files: [], children: [] },
      updated_at: new Date(deletedAt).toISOString(),
      deleted_at: new Date(deletedAt).toISOString()
    };
    this.state.tombstones = [...this.state.tombstones.filter(item => item.id !== tombstone.id), tombstone];
    await this.saveState();
  }

  async syncNow(): Promise<void> {
    if (!this.root) return;
    // Android WebView can report navigator.onLine=false even with working internet.
    // Always attempt the request; Supabase's bounded fetch reports the actual result.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.status.set('La app informa que no hay conexión; comprobando acceso a Supabase…');
    }
    if (this.running) return this.running;
    this.cancelled.set(false);
    this.result.set('');
    this.completed.set(false);
    this.abortController = new AbortController();
    this.running = this.performSync().finally(() => { this.running = null; });
    return this.running;
  }

  cancelSync(): void {
    if (!this.syncing()) return;
    this.cancelled.set(true);
    this.abortController?.abort();
    this.status.set('Cancelando sincronización…');
    this.progress.update(progress => ({ ...progress, phase: 'Cancelando sincronización…' }));
  }

  async syncManually(): Promise<void> {
    this.manualSyncing.set(true);
    try { await this.syncNow(); }
    finally { this.manualSyncing.set(false); }
  }

  async clearErrors(): Promise<void> {
    this.errors.set([]);
    await this.persistErrorCache();
  }

  private async performSync(): Promise<void> {
    const root = this.root;
    if (!root) return;
    this.syncing.set(true);
    try {
      this.setPhase('Leyendo el estado local', 0, 1);
      await this.withTimeout(this.loadState(), LOCAL_FILE_TIMEOUT_MS, 'leer el estado local');
      this.setPhase('Leyendo la biblioteca local', 0, null);
      let local = await this.withTimeout(this.scanLocal(root), LOCAL_SCAN_TIMEOUT_MS, 'escanear la biblioteca local');
      this.state.tombstones = this.state.tombstones.filter(item => !local.some(node => node.id === item.id));
      this.setPhase('Biblioteca local indexada', local.length, local.length || 1);
      this.setPhase('Descargando registros de Supabase', 0, null);
      const client = await this.getClient();
      const remoteRows: CloudNode[] = [];
      for (let from = 0;; from += CLOUD_PAGE_SIZE) {
        this.throwIfCancelled();
        const { data, error } = await this.withTimeout(
          client.from(TABLE).select('*').range(from, from + CLOUD_PAGE_SIZE - 1),
          CLOUD_REQUEST_TIMEOUT_MS,
          'consultar Supabase'
        );
        if (error) throw error;
        const page = (data ?? []) as CloudNode[];
        remoteRows.push(...page);
        this.updateProgress(remoteRows.length, null);
        if (page.length < CLOUD_PAGE_SIZE) break;
      }
      const remote = new Map(remoteRows.map(node => [node.id, node]));
      this.state.tombstones ??= [];
      this.setPhase('Registros de Supabase descargados', remoteRows.length || 1, remoteRows.length || 1);
      this.setPhase('Revisando los cambios locales', 0, null);
      const legacyMatching = await this.withTimeout(this.adoptExistingCloudIds(local, remote), LOCAL_SCAN_TIMEOUT_MS, 'actualizar los identificadores locales');
      const legacyById = new Map(legacyMatching.map(item => [item.id, item.parentId]));
      const legacyIds = new Set(legacyById.keys());
      local = await this.withTimeout(this.scanLocal(root), LOCAL_SCAN_TIMEOUT_MS, 'volver a escanear la biblioteca local');
      this.setPhase('Cambios locales indexados', local.length, local.length || 1);
      const fileTombstones = [...this.state.tombstones.filter(item => item.id.startsWith('file:'))];
      for (const tombstone of remote.values()) {
        if (tombstone.id.startsWith('file:') && tombstone.deleted_at
          && !fileTombstones.some(item => item.id === tombstone.id)) fileTombstones.push(tombstone);
      }
      const localById = new Map(local.map(node => [node.id, node]));
      for (const node of local) {
        this.throwIfCancelled();
        const cloud = remote.get(node.id);
        if (!cloud || cloud.deleted_at || node.id === ROOT_ID || legacyIds.has(node.id)) continue;
        const mergedFiles = new Map((cloud.data.files ?? []).map(file => [file.name, file]));
        for (const file of node.data.files ?? []) {
          const deleted = fileTombstones.find(item => item.parent_id === node.id && item.name === file.name);
          if (deleted && Date.parse(deleted.deleted_at ?? deleted.updated_at) >= file.lastModified) continue;
          const previous = mergedFiles.get(file.name);
          if (!previous) mergedFiles.set(file.name, file);
          else if (previous.content !== file.content) {
            const localMetadata = await this.readLocalMetadata(node.directory);
            const localChanged = !localMetadata || localMetadata.updatedAt > cloud.updated_at;
            if (localChanged) mergedFiles.set(file.name, file);
          }
        }
        const files = [...mergedFiles.values()].filter(file => !fileTombstones.some(item => item.parent_id === node.id
          && item.name === file.name && Date.parse(item.deleted_at ?? item.updated_at) >= file.lastModified));
        const mergedNode = { ...cloud, data: { ...cloud.data, files } };
        if (JSON.stringify(files) !== JSON.stringify(cloud.data.files ?? [])) {
          await this.upsert(mergedNode);
          remote.set(node.id, mergedNode);
        }
      }

      for (const tombstone of fileTombstones) {
        this.throwIfCancelled();
        const existing = remote.get(tombstone.id);
        if (!existing?.deleted_at || Date.parse(existing.deleted_at) < Date.parse(tombstone.deleted_at ?? tombstone.updated_at)) {
          await this.upsert(tombstone);
          remote.set(tombstone.id, tombstone);
        }
        const parent = tombstone.parent_id ? localById.get(tombstone.parent_id) : null;
        if (parent) {
          const file = parent.data.files.find(item => item.name === tombstone.name);
          if (file && file.lastModified <= Date.parse(tombstone.deleted_at ?? tombstone.updated_at)) {
            try { await parent.directory.removeEntry(tombstone.name); } catch { /* Ya eliminado. */ }
          }
        }
      }

      this.setPhase('Sincronizando eliminaciones', 0, this.state.tombstones.length || 1);
      let processedTombstones = 0;
      for (const tombstone of this.state.tombstones) {
        this.throwIfCancelled();
        if (tombstone.id.startsWith('file:')) continue;
        const existing = remote.get(tombstone.id);
        if (!existing?.deleted_at || Date.parse(existing.deleted_at) < Date.parse(tombstone.deleted_at ?? tombstone.updated_at)) {
          this.updateActivity(`Guardando eliminación de «${tombstone.name}» en Supabase`);
          await this.upsert(tombstone);
          remote.set(tombstone.id, tombstone);
        }
        processedTombstones++;
        this.updateProgress(processedTombstones, this.state.tombstones.length || 1);
      }

      const toApply: CloudNode[] = [];
      const deletedIds = new Set([...remote.values()].filter(node => !!node.deleted_at).map(node => node.id));
      this.setPhase('Comparando y subiendo cambios locales', 0, local.length);
      let reconciled = 0;
      for (const node of local) {
        this.throwIfCancelled();
        const cloud = remote.get(node.id);
        if (cloud?.deleted_at && node.id !== ROOT_ID) toApply.push(cloud);
        else if (cloud?.deleted_at) {
          const recreatedRoot = { ...node, data: { ...node.data, files: cloud.data.files ?? [] } };
          await this.upsert(recreatedRoot);
          remote.set(node.id, recreatedRoot);
          toApply.push(recreatedRoot);
        }
        else if (!cloud) {
          this.updateActivity(`Subiendo «${node.name}» a Supabase`);
          await this.upsert(node);
          remote.set(node.id, node);
          toApply.push(node);
        }
        else if (legacyIds.has(node.id)) {
          const previousParent = legacyById.get(node.id);
          const remoteNode = previousParent ? { ...cloud, parent_id: previousParent } : cloud;
          toApply.push(remoteNode);
        } else {
          const remoteFiles = new Map((cloud.data.files ?? []).map(file => [file.name, file]));
          for (const file of node.data.files ?? []) {
            const fileTombstone = fileTombstones.find(item => item.parent_id === node.id && item.name === file.name);
            if (fileTombstone && Date.parse(fileTombstone.deleted_at ?? fileTombstone.updated_at) >= file.lastModified) continue;
            const previous = remoteFiles.get(file.name);
            if (!previous) remoteFiles.set(file.name, file);
            else if (previous.content !== file.content) {
              const localMetadata = await this.readLocalMetadata(node.directory);
              if (!localMetadata || localMetadata.updatedAt > cloud.updated_at) remoteFiles.set(file.name, file);
            }
          }
          const files = [...remoteFiles.values()].filter(file => !fileTombstones.some(item => item.parent_id === node.id && item.name === file.name
            && Date.parse(item.deleted_at ?? item.updated_at) >= file.lastModified));
          const localChildren = node.data.children ?? [];
          const cloudChildren = cloud.data.children ?? [];
          const indexedChildren = [...remote.values()]
            .filter(candidate => candidate.parent_id === node.id && !candidate.deleted_at)
            .map(candidate => ({ id: candidate.id, name: candidate.name }));
          const childrenById = new Map([...cloudChildren, ...indexedChildren, ...localChildren]
            .filter(child => !deletedIds.has(child.id)).map(child => [child.id, child]));
          const children = [...childrenById.values()].sort((a, b) => a.name.localeCompare(b.name));
          const localIsNewer = Date.parse(node.updated_at) >= Date.parse(cloud.updated_at);
          const useCloudRootSnapshot = node.id === ROOT_ID && !(node.data.tree?.length) && !!cloud.data.tree?.length;
          const merged: CloudNode = {
            ...(useCloudRootSnapshot ? cloud : localIsNewer ? node : cloud),
            data: { ...(useCloudRootSnapshot ? cloud.data : localIsNewer ? node.data : cloud.data), files, children },
            updated_at: useCloudRootSnapshot ? cloud.updated_at : localIsNewer ? node.updated_at : cloud.updated_at
          };
          if (node.id === ROOT_ID) {
            const localIndex = new Map(local.map(item => [item.id, item]));
            merged.data.tree = children.map(child => this.buildMergedSnapshot(child.id, localIndex, remote, deletedIds));
          }
          const childListsDiffer = JSON.stringify(children) !== JSON.stringify(cloudChildren)
            || JSON.stringify(children) !== JSON.stringify(localChildren);
          const filesDiffer = JSON.stringify(files) !== JSON.stringify(cloud.data.files ?? []);
          if (childListsDiffer || filesDiffer || useCloudRootSnapshot) {
            if (!useCloudRootSnapshot) merged.updated_at = new Date().toISOString();
            this.updateActivity(`Actualizando «${node.name}» en Supabase`);
            await this.upsert(merged);
            remote.set(merged.id, merged);
            toApply.push(merged);
          } else if (Date.parse(cloud.updated_at) > Date.parse(node.updated_at)) toApply.push({ ...cloud, data: { ...cloud.data, files } });
          else {
            this.updateActivity(`Actualizando «${node.name}» en Supabase`);
            await this.upsert(node);
          }
        }
        reconciled++;
        this.updateProgress(reconciled, local.length);
      }
      for (const node of remote.values()) {
        if (node.id === ROOT_ID || local.some(localNode => localNode.id === node.id) || this.state.tombstones.some(item => item.id === node.id)) continue;
        toApply.push(node);
      }

      // The root node is a snapshot only; applying it recursively duplicates
      // work because every child is already present in orderedChanges.
      const rootSnapshot = toApply.find(node => node.id === ROOT_ID && !node.deleted_at);
      if (rootSnapshot) {
        for (const child of rootSnapshot.data.children ?? []) {
          const childNode = remote.get(child.id);
          if (childNode && !childNode.deleted_at) toApply.push(childNode);
        }
      }

      const orderedChanges = [
        ...toApply.filter(item => item.id === ROOT_ID && !item.deleted_at),
        ...toApply.filter(item => item.deleted_at).sort((a, b) => a.id.localeCompare(b.id)),
        ...toApply.filter(item => item.id !== ROOT_ID && !item.deleted_at).sort((a, b) => a.parent_id === b.parent_id ? a.name.localeCompare(b.name) : (a.parent_id ?? '').localeCompare(b.parent_id ?? ''))
      ];
      for (const tombstone of fileTombstones) {
        const parent = tombstone.parent_id ? localById.get(tombstone.parent_id) : null;
        if (!parent) continue;
        const currentFile = parent.data.files.find(file => file.name === tombstone.name);
        if (currentFile && currentFile.lastModified <= Date.parse(tombstone.deleted_at ?? tombstone.updated_at)) {
          try { await parent.directory.removeEntry(tombstone.name); } catch { /* Ya eliminado localmente. */ }
        }
      }
      const filesToDelete = new Set(fileTombstones.map(item => `${item.parent_id}:${item.name}`));
      for (const node of localById.values()) {
        node.data.files = node.data.files.filter(file => !filesToDelete.has(`${node.id}:${file.name}`));
      }
      this.setPhase('Aplicando cambios recibidos', 0, orderedChanges.length);
      let applied = 0;
      for (const node of orderedChanges) {
        this.throwIfCancelled();
        if (node.deleted_at && node.id.startsWith('file:')) {
          const parent = node.parent_id ? localById.get(node.parent_id) : null;
          if (parent) {
            const current = parent.data.files.find(file => file.name === node.name);
            if (current && current.lastModified <= Date.parse(node.deleted_at)) {
              try { await parent.directory.removeEntry(node.name); } catch { /* Ya no existe localmente. */ }
            }
            parent.data.files = parent.data.files.filter(file => file.name !== node.name);
          }
        }
        else if (node.deleted_at && node.id !== ROOT_ID) await this.removeLocalNodeById(node.id, localById);
        else await this.applyRemoteNode(root, node, remote, localById);
        applied++;
        this.updateProgress(applied, orderedChanges.length);
      }
      if (toApply.length) this.revision.update(value => value + 1);

      this.state.tombstones = this.state.tombstones.filter(item => {
        const cloud = remote.get(item.id);
        return !cloud?.deleted_at || Date.parse(cloud.deleted_at) > Date.parse(item.deleted_at ?? item.updated_at);
      });
      await this.saveState();
      const fileCount = local.reduce((count, node) => count + node.data.files.length, 0);
      this.status.set(`Biblioteca sincronizada con Supabase: ${local.length - 1} carpetas y ${fileCount} archivos revisados.`);
      this.result.set(this.status());
      this.completed.set(true);
      this.progress.set({ active: false, phase: 'Sincronización completa', current: 1, total: 1 });
    } catch (error) {
      if (this.cancelled()) {
        this.status.set('Sincronización cancelada. Los cambios ya aplicados se conservaron.');
        this.result.set(this.status());
        this.completed.set(true);
        this.progress.set({ active: false, phase: 'Sincronización cancelada', current: 0, total: null });
      } else {
        await this.cacheError(error);
        this.result.set(this.status());
        this.completed.set(true);
      }
    } finally {
      this.syncing.set(false);
      this.abortController = null;
      if (this.progress().active) this.progress.update(progress => ({ ...progress, active: false }));
    }
  }

  private async adoptExistingCloudIds(local: LocalNode[], remote: Map<string, CloudNode>): Promise<{ id: string; parentId: string }[]> {
    const mappedParents = new Map<string, string>([[ROOT_ID, ROOT_ID]]);
    const adopted = new Map<string, string>();
    let current = 0;
    for (const node of [...local].sort((a, b) => a.depth - b.depth)) {
      const mappedParent = node.parent_id ? mappedParents.get(node.parent_id) : null;
      if (!mappedParent) { current++; this.updateProgress(current, local.length); continue; }
      if (node.id !== ROOT_ID && remote.has(node.id)) {
        const existing = remote.get(node.id)!;
        if (!existing.deleted_at && existing.parent_id === mappedParent) {
          mappedParents.set(node.id, node.id);
          current++;
          this.updateProgress(current, local.length);
          continue;
        }
      }
      const match = [...remote.values()].find(candidate => !candidate.deleted_at
        && !candidate.id.startsWith('file:') && candidate.parent_id === mappedParent && candidate.name === node.name);
      if (!match) {
        mappedParents.set(node.id, node.id);
        current++;
        this.updateProgress(current, local.length);
        continue;
      }
      const oldId = node.id;
      adopted.set(match.id, oldId);
      if (oldId !== match.id) {
        await this.writeNodeId(node.directory, match.id);
        node.id = match.id;
        node.parent_id = mappedParent;
      }
      mappedParents.set(oldId, match.id);
      mappedParents.set(match.id, match.id);
      current++;
      this.updateProgress(current, local.length);
    }
    return [...adopted].map(([id, parentId]) => ({ id, parentId }));
  }

  private buildMergedSnapshot(
    id: string,
    local: Map<string, LocalNode>,
    remote: Map<string, CloudNode>,
    deleted: Set<string>,
    visited = new Set<string>()
  ): CloudSnapshotNode {
    const localNode = local.get(id);
    const remoteNode = remote.get(id);
    const useLocal = !!localNode && (!remoteNode || Date.parse(localNode.updated_at) >= Date.parse(remoteNode.updated_at));
    const source = useLocal ? localNode! : remoteNode!;
    const indexedChildren = [...remote.values()]
      .filter(node => node.parent_id === id && !node.deleted_at)
      .map(node => ({ id: node.id, name: node.name }));
    const childMap = new Map([
      ...(localNode?.data.children ?? []),
      ...(remoteNode?.data.children ?? []),
      ...indexedChildren
    ].filter(child => !deleted.has(child.id)).map(child => [child.id, child]));
    const folders = [...childMap.values()].map(child => {
      if (visited.has(child.id)) return null;
      const nextVisited = new Set(visited).add(id);
      return this.buildMergedSnapshot(child.id, local, remote, deleted, nextVisited);
    }).filter((node): node is CloudSnapshotNode => node !== null);
    return {
      id,
      parent_id: source.parent_id ?? ROOT_ID,
      name: source.name,
      data: { files: source.data.files ?? [], children: [...childMap.values()] },
      folders
    };
  }

  private async scanLocal(root: ProjectDirectoryHandle): Promise<LocalNode[]> {
    const output: LocalNode[] = [];
    const trackProgress = this.syncing() && ['Leyendo la biblioteca local', 'Revisando los cambios locales'].includes(this.progress().phase);
    let scannedFiles = 0;
    let scannedFolders = 0;
    const visit = async (directory: ProjectDirectoryHandle, parentId: string | null, parent: ProjectDirectoryHandle | null, depth: number): Promise<void> => {
      const id = depth === 0 ? ROOT_ID : await this.readNodeId(directory);
      if (depth > 0) {
        for await (const [entryName, entry] of this.readEntries(directory)) {
          if (entryName === META_FOLDER || entry.kind !== 'directory') continue;
          await this.readNodeId(entry);
        }
      }
      const files: CloudFile[] = [], children: CloudChild[] = [];
      for await (const [name, entry] of this.readEntries(directory)) {
        if (name === META_FOLDER) continue;
        if (entry.kind === 'directory') {
          scannedFolders++;
          if (trackProgress && (scannedFiles + scannedFolders === 1 || (scannedFiles + scannedFolders) % 10 === 0)) {
            this.updateProgress(scannedFiles + scannedFolders, null);
          }
          const childId = await this.readNodeId(entry);
          children.push({ id: childId, name });
          await visit(entry, id, directory, depth + 1);
        } else {
          if ([SYNC_STATE_FILE, ERROR_CACHE_FILE, NODE_ID_FILE, `cloud-${NODE_ID_FILE}`].includes(name)) continue;
          const file = await this.withTimeout(entry.getFile(), LOCAL_FILE_TIMEOUT_MS, `leer «${name}»`);
          files.push({ name, content: await this.toBase64(file), lastModified: file.lastModified });
          scannedFiles++;
          if (trackProgress && (scannedFiles + scannedFolders === 1 || (scannedFiles + scannedFolders) % 10 === 0)) {
            this.updateProgress(scannedFiles + scannedFolders, null);
          }
        }
      }
      files.sort((a, b) => a.name.localeCompare(b.name));
      children.sort((a, b) => a.name.localeCompare(b.name));
      const data = { files, children };
      const fingerprint = JSON.stringify({ name: directory.name, data });
      const prior = await this.readLocalMetadata(directory);
      let updatedAt = prior?.updatedAt ?? new Date(0).toISOString();
      if (!prior || prior.fingerprint !== fingerprint) updatedAt = new Date().toISOString();
      await this.writeLocalMetadata(directory, { updatedAt, fingerprint });
      output.push({ id, parent_id: parentId, name: depth === 0 ? 'Biblioteca' : directory.name, data, updated_at: updatedAt, deleted_at: null, directory, parentDirectory: parent, depth });
    };
    await visit(root, null, null, 0);
    const nodesById = new Map(output.map(node => [node.id, node]));
    const makeSnapshot = (node: LocalNode): CloudSnapshotNode => ({
      id: node.id,
      parent_id: node.parent_id ?? ROOT_ID,
      name: node.name,
      data: { files: node.data.files, children: node.data.children },
      folders: node.data.children.flatMap(child => {
        const childNode = nodesById.get(child.id);
        return childNode ? [makeSnapshot(childNode)] : [];
      })
    });
    const rootNode = nodesById.get(ROOT_ID);
    if (rootNode) {
      rootNode.data.tree = rootNode.data.children.flatMap(child => {
        const childNode = nodesById.get(child.id);
        return childNode ? [makeSnapshot(childNode)] : [];
      });
      const fingerprint = JSON.stringify({ name: root.name, data: rootNode.data });
      const prior = await this.readLocalMetadata(root);
      if (!prior || prior.fingerprint !== fingerprint) rootNode.updated_at = new Date().toISOString();
      await this.writeLocalMetadata(root, { updatedAt: rootNode.updated_at, fingerprint });
    }
    return output;
  }

  private async applyRemoteNode(
    root: ProjectDirectoryHandle,
    node: CloudNode,
    remote: Map<string, CloudNode>,
    localById: Map<string, LocalNode>
  ): Promise<void> {
    if (node.id === ROOT_ID) {
      if (node.data.tree?.length) {
        const addSnapshotNodes = (folders: CloudSnapshotNode[]): void => {
          for (const folder of folders) {
            remote.set(folder.id, { id: folder.id, parent_id: folder.parent_id, name: folder.name, data: folder.data, updated_at: node.updated_at, deleted_at: null });
            addSnapshotNodes(folder.folders ?? []);
          }
        };
        addSnapshotNodes(node.data.tree);
      }
      return;
    }
    const found = localById.get(node.id) ?? null;
    const parentDirectory = node.parent_id === ROOT_ID || !node.parent_id ? root : localById.get(node.parent_id)?.directory ?? root;
    let directory = found?.directory;
    if (directory && found && found.parentDirectory !== parentDirectory) {
      const existingDestination = await this.getDirectoryIfExists(parentDirectory, node.name);
      if (existingDestination) directory = existingDestination;
      else {
        const moved = await this.withTimeout(parentDirectory.getDirectoryHandle(node.name, { create: true }), LOCAL_FILE_TIMEOUT_MS, `crear la carpeta «${node.name}»`);
        await this.copyDirectory(directory, moved);
        if (found.parentDirectory) await this.withTimeout(found.parentDirectory.removeEntry(directory.name, { recursive: true }), LOCAL_FILE_TIMEOUT_MS, `mover la carpeta «${node.name}»`);
        directory = moved;
      }
    } else if (!directory) directory = await this.withTimeout(parentDirectory.getDirectoryHandle(node.name, { create: true }), LOCAL_FILE_TIMEOUT_MS, `crear la carpeta «${node.name}»`);
    else if (directory.name !== node.name) {
      const existingDestination = await this.getDirectoryIfExists(parentDirectory, node.name);
      if (existingDestination) directory = existingDestination;
      else {
        const moved = await this.withTimeout(parentDirectory.getDirectoryHandle(node.name, { create: true }), LOCAL_FILE_TIMEOUT_MS, `renombrar la carpeta «${node.name}»`);
        await this.copyDirectory(directory, moved);
        await this.withTimeout(parentDirectory.removeEntry(directory.name, { recursive: true }), LOCAL_FILE_TIMEOUT_MS, `eliminar la carpeta anterior «${directory.name}»`);
        directory = moved;
      }
    }
    if (!directory) return;
    if (!found || found.id !== node.id) await this.writeNodeId(directory, node.id);
    await this.writeNodeData(directory, node);
    const appliedNode: LocalNode = {
      ...node,
      directory,
      parentDirectory,
      depth: node.parent_id === ROOT_ID ? 1 : (localById.get(node.parent_id ?? '')?.depth ?? 0) + 1
    };
    localById.set(node.id, appliedNode);
    for (const child of node.data.children ?? []) {
      const remoteChild = remote.get(child.id);
      if (remoteChild && !remoteChild.deleted_at) await this.applyRemoteNode(root, remoteChild, remote, localById);
    }
  }

  private async writeNodeData(directory: ProjectDirectoryHandle, node: CloudNode): Promise<void> {
    const wanted = new Set((node.data.files ?? []).map(file => file.name));
    for (const file of node.data.files ?? []) {
      const current = await this.readFileIfExists(directory, file.name);
      if (current && current.content === file.content) continue;
      const handle = await this.withTimeout(directory.getFileHandle(file.name, { create: true }), LOCAL_FILE_TIMEOUT_MS, `crear el archivo «${file.name}»`);
      const writer: Writable = await this.withTimeout(handle.createWritable(), LOCAL_FILE_TIMEOUT_MS, `abrir «${file.name}» para escritura`);
      await this.withTimeout(writer.write(this.fromBase64(file.content, file.name, file.lastModified)), LOCAL_FILE_TIMEOUT_MS, `escribir «${file.name}»`);
      await this.withTimeout(writer.close(), LOCAL_FILE_TIMEOUT_MS, `cerrar «${file.name}»`);
    }
    for await (const [name, entry] of this.readEntries(directory)) {
      if (entry.kind !== 'file' || wanted.has(name)) continue;
      if (name === META_FOLDER) continue;
      if ([SYNC_STATE_FILE, ERROR_CACHE_FILE, NODE_ID_FILE, `cloud-${NODE_ID_FILE}`].includes(name)) continue;
      await this.withTimeout(directory.removeEntry(name), LOCAL_FILE_TIMEOUT_MS, `eliminar «${name}»`);
    }
    await this.writeLocalMetadata(directory, { updatedAt: node.updated_at, fingerprint: JSON.stringify({ name: directory.name, data: node.data }) });
  }

  private async readFileIfExists(directory: ProjectDirectoryHandle, name: string): Promise<CloudFile | null> {
    try {
      const handle = await this.withTimeout(directory.getFileHandle(name), LOCAL_FILE_TIMEOUT_MS, `abrir «${name}»`);
      const file = await this.withTimeout(handle.getFile(), LOCAL_FILE_TIMEOUT_MS, `leer «${name}»`);
      return { name, content: await this.toBase64(file), lastModified: file.lastModified };
    } catch { return null; }
  }

  private async getDirectoryIfExists(parent: ProjectDirectoryHandle, name: string): Promise<ProjectDirectoryHandle | null> {
    try { return await this.withTimeout(parent.getDirectoryHandle(name), LOCAL_FILE_TIMEOUT_MS, `abrir la carpeta «${name}»`); }
    catch { return null; }
  }

  private async removeLocalNodeById(id: string, localById: Map<string, LocalNode>): Promise<void> {
    const found = localById.get(id);
    if (found?.parentDirectory) {
      await this.withTimeout(found.parentDirectory.removeEntry(found.directory.name, { recursive: true }), LOCAL_FILE_TIMEOUT_MS, `eliminar «${found.directory.name}»`);
      const parent = found.parent_id ? localById.get(found.parent_id) : null;
      if (parent) parent.data.children = parent.data.children.filter(child => child.id !== id);
      for (const [childId, child] of localById) {
        if (childId === id || this.isDescendantOf(child, id, localById)) localById.delete(childId);
      }
    }
  }

  private isDescendantOf(node: LocalNode, ancestorId: string, localById: Map<string, LocalNode>): boolean {
    let parentId = node.parent_id;
    while (parentId) {
      if (parentId === ancestorId) return true;
      parentId = localById.get(parentId)?.parent_id ?? null;
    }
    return false;
  }

  private async copyDirectory(source: ProjectDirectoryHandle, target: ProjectDirectoryHandle): Promise<void> {
    for await (const [name, entry] of this.readEntries(source)) {
      if (entry.kind === 'directory') await this.copyDirectory(entry, await this.withTimeout(target.getDirectoryHandle(name, { create: true }), LOCAL_FILE_TIMEOUT_MS, `crear la carpeta «${name}»`));
      else {
        const file = await this.withTimeout(entry.getFile(), LOCAL_FILE_TIMEOUT_MS, `leer «${name}»`);
        const handle = await this.withTimeout(target.getFileHandle(name, { create: true }), LOCAL_FILE_TIMEOUT_MS, `crear «${name}»`);
        const writer = await this.withTimeout(handle.createWritable(), LOCAL_FILE_TIMEOUT_MS, `abrir «${name}» para escritura`);
        await this.withTimeout(writer.write(file), LOCAL_FILE_TIMEOUT_MS, `copiar «${name}»`);
        await this.withTimeout(writer.close(), LOCAL_FILE_TIMEOUT_MS, `cerrar «${name}»`);
      }
    }
  }

  private async readNodeId(directory: ProjectDirectoryHandle): Promise<string> {
    const metadata = await this.readJson<{ id?: string }>(directory, META_FOLDER, NODE_ID_FILE);
    if (metadata?.id) return metadata.id;
    const id = crypto.randomUUID();
    await this.writeJson(directory, META_FOLDER, NODE_ID_FILE, { id });
    return id;
  }

  private async writeNodeId(directory: ProjectDirectoryHandle, id: string): Promise<void> {
    await this.writeJson(directory, META_FOLDER, NODE_ID_FILE, { id });
  }

  private async readLocalMetadata(directory: ProjectDirectoryHandle): Promise<{ updatedAt: string; fingerprint: string } | null> {
    return this.readJson(directory, META_FOLDER, `cloud-${NODE_ID_FILE}`);
  }

  private async writeLocalMetadata(directory: ProjectDirectoryHandle, data: { updatedAt: string; fingerprint: string }): Promise<void> {
    await this.writeJson(directory, META_FOLDER, `cloud-${NODE_ID_FILE}`, data);
  }

  private async loadState(): Promise<void> {
    if (!this.root) return;
    const state = await this.readJson<LocalState>(this.root, META_FOLDER, SYNC_STATE_FILE);
    if (state && Array.isArray(state.tombstones)) this.state = state;
  }

  private async loadErrorCache(root: ProjectDirectoryHandle): Promise<void> {
    const cached = await this.readJson<CloudSyncError[]>(root, META_FOLDER, ERROR_CACHE_FILE);
    if (Array.isArray(cached)) this.errors.set(cached.slice(-20));
  }

  private async persistErrorCache(): Promise<void> {
    if (!this.root) return;
    await this.writeJson(this.root, META_FOLDER, ERROR_CACHE_FILE, this.errors());
  }

  private async cacheError(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error ?? 'Error desconocido');
    const details = error instanceof Error
      ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`
      : String(error ?? 'Error desconocido');
    const record: CloudSyncError = {
      at: new Date().toISOString(),
      phase: this.currentPhase,
      message,
      details: details.slice(0, 12_000)
    };
    this.errors.update(items => [...items, record].slice(-20));
    this.status.set(`Error al ${this.currentPhase.toLocaleLowerCase()}: ${message}. Consulta los detalles de error.`);
    this.progress.set({ active: false, phase: `Error: ${this.currentPhase}`, current: 0, total: null });
    console.error('Error sincronizando biblioteca cloud.', error);
    try { await this.persistErrorCache(); }
    catch (cacheError) { console.warn('No se pudo guardar el registro local del error de Supabase.', cacheError); }
  }

  private setPhase(phase: string, current = 0, total: number | null = null): void {
    this.currentPhase = phase;
    this.status.set(`${phase}…`);
    this.progress.set({ active: true, phase, current, total });
  }

  private updateProgress(current: number, total: number | null = this.progress().total): void {
    this.progress.update(progress => ({ ...progress, current, total }));
  }

  private updateActivity(activity: string): void {
    this.currentPhase = activity;
    this.status.set(`${activity}…`);
  }

  private async saveState(): Promise<void> {
    if (this.root) await this.writeJson(this.root, META_FOLDER, SYNC_STATE_FILE, this.state);
  }

  private async readJson<T>(directory: ProjectDirectoryHandle, folderName: string, name: string): Promise<T | null> {
    try {
      const folder = await this.withTimeout(directory.getDirectoryHandle(folderName), LOCAL_FILE_TIMEOUT_MS, `abrir ${folderName}/`);
      const handle = await this.withTimeout(folder.getFileHandle(name), LOCAL_FILE_TIMEOUT_MS, `abrir ${name}`);
      const file = await this.withTimeout(handle.getFile(), LOCAL_FILE_TIMEOUT_MS, `leer ${name}`);
      return JSON.parse(await file.text()) as T;
    }
    catch { return null; }
  }

  private async writeJson(directory: ProjectDirectoryHandle, folderName: string, name: string, value: unknown): Promise<void> {
    const folder = await this.withTimeout(directory.getDirectoryHandle(folderName, { create: true }), LOCAL_FILE_TIMEOUT_MS, `crear ${folderName}/`);
    const handle = await this.withTimeout(folder.getFileHandle(name, { create: true }), LOCAL_FILE_TIMEOUT_MS, `crear ${name}`);
    const writer = await this.withTimeout(handle.createWritable(), LOCAL_FILE_TIMEOUT_MS, `abrir ${name} para escritura`);
    await this.withTimeout(writer.write(JSON.stringify(value)), LOCAL_FILE_TIMEOUT_MS, `escribir ${name}`);
    await this.withTimeout(writer.close(), LOCAL_FILE_TIMEOUT_MS, `cerrar ${name}`);
  }

  private async *readEntries(directory: ProjectDirectoryHandle): AsyncGenerator<[string, ProjectDirectoryHandle | ProjectFileHandle]> {
    const iterator = directory.entries()[Symbol.asyncIterator]();
    while (true) {
      const result = await this.withTimeout(iterator.next(), LOCAL_FILE_TIMEOUT_MS, `leer la carpeta «${directory.name}»`);
      if (result.done) return;
      yield result.value;
    }
  }

  private async upsert(node: CloudNode): Promise<void> {
    const client = await this.getClient();
    // LocalNode extends CloudNode with browser-only directory handles. Never
    // send those runtime fields to PostgREST as they are not table columns.
    const record: CloudNode = {
      id: node.id,
      parent_id: node.parent_id,
      name: node.name,
      data: node.data,
      updated_at: node.updated_at,
      deleted_at: node.deleted_at
    };
    const { error } = await this.withTimeout(
      client.from(TABLE).upsert(record, { onConflict: 'id' }),
      CLOUD_REQUEST_TIMEOUT_MS,
      `guardar «${node.name}» en Supabase`
    );
    if (error) throw error;
  }

  private getClient(): Promise<SupabaseClient> {
    this.clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => this.fetchWithTimeout(input, init) }
    }));
    return this.clientPromise;
  }

  private async fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLOUD_REQUEST_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    init?.signal?.addEventListener('abort', onAbort, { once: true });
    this.abortController?.signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      init?.signal?.removeEventListener('abort', onAbort);
      this.abortController?.signal.removeEventListener('abort', onAbort);
    }
  }

  private throwIfCancelled(): void {
    if (this.cancelled()) throw new DOMException('Sincronización cancelada', 'AbortError');
  }

  private withTimeout<T>(operation: PromiseLike<T> | Promise<T>, timeoutMs: number, task: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Se agotó el tiempo para ${task} (${Math.round(timeoutMs / 1000)} s).`)), timeoutMs);
      Promise.resolve(operation).then(
        value => { clearTimeout(timer); resolve(value); },
        error => { clearTimeout(timer); reject(error); }
      );
    });
  }

  private async toBase64(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
  }

  private fromBase64(content: string, name: string, lastModified: number): File {
    const bytes = Uint8Array.from(atob(content), character => character.charCodeAt(0));
    return new File([bytes], name, { lastModified });
  }
}
