export interface DirectoryPicked {
  uri: string;
  name: string;
}

export interface NativeMediaFileUri {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
}

export interface NativeDirectoryEntry {
  name: string;
  kind: 'directory' | 'file';
  size: number;
  lastModified: number;
  mimeType: string;
}

export interface NativeDirectoryAccessPlugin {
  pickDirectory(): Promise<DirectoryPicked>;
  listDirectory(options: { uri: string; path: string }): Promise<{ entries: NativeDirectoryEntry[] }>;
  getDirectory(options: { uri: string; path: string; create: boolean }): Promise<{ name: string }>;
  readFile(options: { uri: string; path: string }): Promise<{ data: string; name: string; mimeType: string; size: number; lastModified: number }>;
  getFileUri(options: { uri: string; path: string }): Promise<NativeMediaFileUri>;
  writeFile(options: { uri: string; path: string; data: string; mimeType: string }): Promise<void>;
  deleteEntry(options: { uri: string; path: string }): Promise<void>;
}
