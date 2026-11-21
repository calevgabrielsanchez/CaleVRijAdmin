import { Injectable, signal } from '@angular/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ProjectDirectoryHandle, ProjectFileHandle } from '../components/view-content.component/project-library-manager.component';

const SUPABASE_URL = 'https://qwqddhyrjdujgypsxirl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_XO-Atj3pA2-WKBZ66w3JRA_ous1OZMB';
const TABLE = 'calevrij_library_nodes';
const META_FOLDER = '.calevri';
const NODE_ID_FILE = 'cloud-node-id.json';
const SYNC_STATE_FILE = 'cloud-sync-state.json';
const ROOT_ID = '00000000-0000-4000-8000-000000000001';

interface CloudFile { name: string; content: string; lastModified: number }
interface CloudChild { id: string; name: string }
interface CloudSnapshotNode { id: string; parent_id: string; name: string; data: { files: CloudFile[]; children: CloudChild[] }; folders: CloudSnapshotNode[] }
interface CloudData { files: CloudFile[]; children: CloudChild[]; tree?: CloudSnapshotNode[] }
interface CloudNode {
  id: string; parent_id: string | null; name: string; data: CloudData;
  updated_at: string; deleted_at: string | null;
}
interface LocalState { updatedAt: string; fingerprint: string; tombstones: CloudNode[] }
interface LocalNode extends CloudNode { directory: ProjectDirectoryHandle; parentDirectory: ProjectDirectoryHandle | null; depth: number }
type Writable = Awaited<ReturnType<ProjectFileHandle['createWritable']>>;

@Injectable({ providedIn: 'root' })
export class CloudLibrarySyncService {
  readonly status = signal('Sincronización cloud lista.');
  readonly syncing = signal(false);
  readonly manualSyncing = signal(false);
  readonly revision = signal(0);
  private clientPromise?: Promise<SupabaseClient>;
  private root: ProjectDirectoryHandle | null = null;
  private state: LocalState = { updatedAt: new Date(0).toISOString(), fingerprint: '', tombstones: [] };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => void this.syncNow());
      window.setInterval(() => void this.syncNow(), 30_000);
    }
  }

  async setRoot(root: ProjectDirectoryHandle | null): Promise<void> {
    if (this.running) await this.running;
    this.root = root;
    this.state = { updatedAt: new Date(0).toISOString(), fingerprint: '', tombstones: [] };
    if (!root) return;
    await this.loadState();
    await this.syncNow();
  }

  scheduleSync(delay = 1200): void {
    if (!this.root) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.syncNow(); }, delay);
  }

  async markDeleted(directory: ProjectDirectoryHandle, name: string): Promise<void> {
    const localNodes = this.root ? await this.scanLocal(this.root) : [];
    const localById = new Map(localNodes.map(node => [node.id, node]));
    const addTombstones = async (current: ProjectDirectoryHandle): Promise<void> => {
      const id = await this.readNodeId(current);
      const now = new Date().toISOString();
      const tombstone: CloudNode = { id, parent_id: localById.get(id)?.parent_id ?? null, name: current.name || name, data: { files: [], children: [] }, updated_at: now, deleted_at: now };
      this.state.tombstones = [...this.state.tombstones.filter(item => item.id !== id), tombstone];
      for await (const [, child] of current.entries()) if (child.kind === 'directory' && child.name !== META_FOLDER) await addTombstones(child);
    };
    await addTombstones(directory);
    await this.saveState();
  }

  async syncNow(): Promise<void> {
    if (!this.root || !navigator.onLine) {
      if (this.root) this.status.set('Sin conexión. Los cambios se conservan localmente y se sincronizarán al volver a conectarse.');
      return;
    }
    if (this.running) return this.running;
    this.running = this.performSync().finally(() => { this.running = null; });
    return this.running;
  }

  async syncManually(): Promise<void> {
    this.manualSyncing.set(true);
    try { await this.syncNow(); }
    finally { this.manualSyncing.set(false); }
  }

  private async performSync(): Promise<void> {
    const root = this.root;
    if (!root) return;
    this.syncing.set(true);
    this.status.set('Sincronizando la biblioteca de libros con la nube…');
    try {
      await this.loadState();
      let local = await this.scanLocal(root);
      const client = await this.getClient();
      const { data, error } = await client.from(TABLE).select('*');
      if (error) throw error;
      const remote = new Map((data as CloudNode[]).map(node => [node.id, node]));
      await this.adoptExistingCloudIds(local, remote);
      local = await this.scanLocal(root);
      const localById = new Map(local.map(node => [node.id, node]));

      for (const tombstone of this.state.tombstones) {
        const existing = remote.get(tombstone.id);
        if (!existing?.deleted_at || Date.parse(existing.deleted_at) < Date.parse(tombstone.deleted_at ?? tombstone.updated_at)) {
          await this.upsert(tombstone);
          remote.set(tombstone.id, tombstone);
        }
      }

      const toApply: CloudNode[] = [];
      const deletedIds = new Set([...remote.values()].filter(node => !!node.deleted_at).map(node => node.id));
      for (const node of local) {
        const cloud = remote.get(node.id);
        if (cloud?.deleted_at) toApply.push(cloud);
        else if (!cloud) await this.upsert(node);
        else {
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
            data: { ...(useCloudRootSnapshot ? cloud.data : localIsNewer ? node.data : cloud.data), children },
            updated_at: useCloudRootSnapshot ? cloud.updated_at : localIsNewer ? node.updated_at : cloud.updated_at
          };
          if (node.id === ROOT_ID) {
            const localIndex = new Map(local.map(item => [item.id, item]));
            merged.data.tree = children.map(child => this.buildMergedSnapshot(child.id, localIndex, remote, deletedIds));
          }
          const childListsDiffer = JSON.stringify(children) !== JSON.stringify(cloudChildren)
            || JSON.stringify(children) !== JSON.stringify(localChildren);
          if (childListsDiffer || useCloudRootSnapshot) {
            if (!useCloudRootSnapshot) merged.updated_at = new Date().toISOString();
            await this.upsert(merged);
            remote.set(merged.id, merged);
            toApply.push(merged);
          } else if (Date.parse(cloud.updated_at) > Date.parse(node.updated_at)) toApply.push(cloud);
          else await this.upsert(node);
        }
      }
      for (const node of remote.values()) {
        if (node.id === ROOT_ID || localById.has(node.id) || this.state.tombstones.some(item => item.id === node.id)) continue;
        toApply.push(node);
      }

      for (const node of toApply.filter(item => item.deleted_at).sort((a, b) => a.id.localeCompare(b.id))) {
        await this.removeLocalNodeById(root, node.id);
      }
      for (const node of toApply.filter(item => !item.deleted_at).sort((a, b) => a.parent_id === b.parent_id ? a.name.localeCompare(b.name) : (a.parent_id ?? '').localeCompare(b.parent_id ?? ''))) {
        await this.applyRemoteNode(root, node, remote);
      }
      if (toApply.length) this.revision.update(value => value + 1);

      this.state.tombstones = this.state.tombstones.filter(item => {
        const cloud = remote.get(item.id);
        return !cloud?.deleted_at || Date.parse(cloud.deleted_at) > Date.parse(item.deleted_at ?? item.updated_at);
      });
      await this.saveState();
      const fileCount = local.reduce((count, node) => count + node.data.files.length, 0);
      this.status.set(`Biblioteca sincronizada: ${local.length - 1} carpetas y ${fileCount} archivos revisados.`);
    } catch (error) {
      this.status.set(`No se pudo sincronizar con Supabase: ${error instanceof Error ? error.message : 'error de conexión o configuración'}. Los cambios locales se conservan.`);
      console.warn('Error sincronizando biblioteca cloud.', error);
    } finally { this.syncing.set(false); }
  }

  private async adoptExistingCloudIds(local: LocalNode[], remote: Map<string, CloudNode>): Promise<void> {
    const mappedParents = new Map<string, string>([[ROOT_ID, ROOT_ID]]);
    for (const node of [...local].sort((a, b) => a.depth - b.depth)) {
      const mappedParent = node.parent_id ? mappedParents.get(node.parent_id) : null;
      if (!mappedParent) continue;
      const match = [...remote.values()].find(candidate => !candidate.deleted_at
        && candidate.parent_id === mappedParent && candidate.name === node.name);
      if (!match) { mappedParents.set(node.id, node.id); continue; }
      const oldId = node.id;
      if (oldId !== match.id) {
        await this.writeNodeId(node.directory, match.id);
        node.id = match.id;
        node.parent_id = mappedParent;
      }
      mappedParents.set(oldId, match.id);
      mappedParents.set(match.id, match.id);
    }
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
    const visit = async (directory: ProjectDirectoryHandle, parentId: string | null, parent: ProjectDirectoryHandle | null, depth: number): Promise<void> => {
      const id = depth === 0 ? ROOT_ID : await this.readNodeId(directory);
      const files: CloudFile[] = [], children: CloudChild[] = [];
      for await (const [name, entry] of directory.entries()) {
        if (name === META_FOLDER && depth !== 0) continue;
        if (entry.kind === 'directory') {
          if (depth === 0 && name === META_FOLDER) {
            const childId = await this.readNodeId(entry);
            children.push({ id: childId, name });
            await visit(entry, id, directory, depth + 1);
            continue;
          }
          const childId = await this.readNodeId(entry);
          children.push({ id: childId, name });
          await visit(entry, id, directory, depth + 1);
        } else {
          if ([SYNC_STATE_FILE, NODE_ID_FILE, `cloud-${NODE_ID_FILE}`].includes(name)) continue;
          const file = await entry.getFile();
          files.push({ name, content: await this.toBase64(file), lastModified: file.lastModified });
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

  private async applyRemoteNode(root: ProjectDirectoryHandle, node: CloudNode, remote: Map<string, CloudNode>): Promise<void> {
    if (node.id === ROOT_ID) {
      await this.writeNodeData(root, node);
      if (node.data.tree?.length) {
        const addSnapshotNodes = (folders: CloudSnapshotNode[]): void => {
          for (const folder of folders) {
            remote.set(folder.id, { id: folder.id, parent_id: folder.parent_id, name: folder.name, data: folder.data, updated_at: node.updated_at, deleted_at: null });
            addSnapshotNodes(folder.folders ?? []);
          }
        };
        addSnapshotNodes(node.data.tree);
      }
      for (const child of node.data.children ?? []) {
        const remoteChild = remote.get(child.id);
        if (remoteChild && !remoteChild.deleted_at) await this.applyRemoteNode(root, remoteChild, remote);
      }
      return;
    }
    const found = await this.findLocalById(root, node.id);
    const parentDirectory = node.parent_id === ROOT_ID || !node.parent_id ? root : (await this.findLocalById(root, node.parent_id))?.directory ?? root;
    let directory = found?.directory;
    if (directory && found && found.parentDirectory !== parentDirectory) {
      const moved = await parentDirectory.getDirectoryHandle(node.name, { create: true });
      await this.copyDirectory(directory, moved);
      await found.parentDirectory?.removeEntry(directory.name, { recursive: true });
      directory = moved;
    } else if (!directory) directory = await parentDirectory.getDirectoryHandle(node.name, { create: true });
    else if (directory.name !== node.name) {
      const moved = await parentDirectory.getDirectoryHandle(node.name, { create: true });
      await this.copyDirectory(directory, moved);
      await parentDirectory.removeEntry(directory.name, { recursive: true });
      directory = moved;
    }
    if (!directory) return;
    await this.writeNodeId(directory, node.id);
    await this.writeNodeData(directory, node);
    for (const child of node.data.children ?? []) {
      const remoteChild = remote.get(child.id);
      if (remoteChild && !remoteChild.deleted_at) await this.applyRemoteNode(root, remoteChild, remote);
    }
  }

  private async writeNodeData(directory: ProjectDirectoryHandle, node: CloudNode): Promise<void> {
    const wanted = new Set((node.data.files ?? []).map(file => file.name));
    for (const file of node.data.files ?? []) {
      const handle = await directory.getFileHandle(file.name, { create: true });
      const writer: Writable = await handle.createWritable();
      await writer.write(this.fromBase64(file.content, file.name, file.lastModified));
      await writer.close();
    }
    for await (const [name, entry] of directory.entries()) {
      if (name === META_FOLDER || entry.kind !== 'file' || wanted.has(name)) continue;
      if ([SYNC_STATE_FILE, NODE_ID_FILE, `cloud-${NODE_ID_FILE}`].includes(name)) continue;
      await directory.removeEntry(name);
    }
    await this.writeLocalMetadata(directory, { updatedAt: node.updated_at, fingerprint: JSON.stringify({ name: directory.name, data: node.data }) });
  }

  private async removeLocalNodeById(root: ProjectDirectoryHandle, id: string): Promise<void> {
    const found = await this.findLocalById(root, id);
    if (found?.parentDirectory) await found.parentDirectory.removeEntry(found.directory.name, { recursive: true });
  }

  private async findLocalById(root: ProjectDirectoryHandle, id: string): Promise<LocalNode | null> {
    const local = await this.scanLocal(root);
    const found = local.find(node => node.id === id);
    return found ?? null;
  }

  private async copyDirectory(source: ProjectDirectoryHandle, target: ProjectDirectoryHandle): Promise<void> {
    for await (const [name, entry] of source.entries()) {
      if (entry.kind === 'directory') await this.copyDirectory(entry, await target.getDirectoryHandle(name, { create: true }));
      else {
        const file = await entry.getFile();
        const writer = await (await target.getFileHandle(name, { create: true })).createWritable();
        await writer.write(file); await writer.close();
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

  private async saveState(): Promise<void> {
    if (this.root) await this.writeJson(this.root, META_FOLDER, SYNC_STATE_FILE, this.state);
  }

  private async readJson<T>(directory: ProjectDirectoryHandle, folderName: string, name: string): Promise<T | null> {
    try { return JSON.parse(await (await (await directory.getDirectoryHandle(folderName)).getFileHandle(name)).getFile().then(file => file.text())) as T; }
    catch { return null; }
  }

  private async writeJson(directory: ProjectDirectoryHandle, folderName: string, name: string, value: unknown): Promise<void> {
    const folder = await directory.getDirectoryHandle(folderName, { create: true });
    const writer = await (await folder.getFileHandle(name, { create: true })).createWritable();
    await writer.write(JSON.stringify(value)); await writer.close();
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
    const { error } = await client.from(TABLE).upsert(record, { onConflict: 'id' });
    if (error) throw error;
  }

  private getClient(): Promise<SupabaseClient> {
    this.clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    }));
    return this.clientPromise;
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
