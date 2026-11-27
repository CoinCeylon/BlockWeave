// File locations, kept free of imports from managed/ so that `npm run wallet`
// works before the contract is compiled.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** contracts/midnight/managed/sealed_auction (output of `npm run compile`) */
export const zkConfigPath = path.resolve(fileURLToPath(new URL('../managed/sealed_auction', import.meta.url)));

/** True when `file` is the script node was started with (works with Windows paths too). */
export function isMain(file: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(fileURLToPath(file)) === norm(entry);
}
