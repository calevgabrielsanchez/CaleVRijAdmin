import { registerPlugin } from '@capacitor/core';
import type { NativeDirectoryAccessPlugin } from './definitions';

const AndroidDirectoryAccess = registerPlugin<NativeDirectoryAccessPlugin>('AndroidDirectoryAccess');

export { AndroidDirectoryAccess };
export * from './definitions';
