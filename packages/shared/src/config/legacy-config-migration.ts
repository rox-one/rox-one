/** Copy-only import of legacy defaults. Explicit config overrides never call this. */
import { constants, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, openSync, fstatSync, readSync, closeSync, renameSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const LEGACY_CONFIG_MIGRATION_STAMP = '.legacy-config-import-v1.json';

/**
 * Prefer existing ROX data, import missing files, archive conflicting originals
 * outside context/ so they cannot accidentally become additional instructions.
 * The source is untouched. A stamp is written only after every copy succeeds.
 */
export function importLegacyConfig(homeDir: string, roxDir: string): void {
  const stamp = join(roxDir, LEGACY_CONFIG_MIGRATION_STAMP);
  if (existsSync(stamp)) return;
  const sources = ['.craft-agent', '.craft-agents'].map(name => join(homeDir, name)).filter(existsSync);
  if (sources.length === 0) return;
  mkdirSync(roxDir, { recursive: true, mode: 0o700 });
  const conflicts: string[] = [];
  function copy(source: string, destination: string, backup: string, relative: string): void {
    const src = lstatSync(source);
    if (src.isDirectory() && !src.isSymbolicLink()) {
      if (!existsSync(destination)) mkdirSync(destination, { recursive: true, mode: src.mode });
      if (lstatSync(destination).isDirectory() && !lstatSync(destination).isSymbolicLink()) {
        for (const name of readdirSync(source)) copy(join(source, name), join(destination, name), join(backup, name), join(relative, name));
        return;
      }
    } else if (!existsSync(destination)) {
      mkdirSync(dirname(destination), { recursive: true });
      if (src.isSymbolicLink()) cpSync(source, destination, { dereference: false, errorOnExist: true, force: false });
      else copyFileSync(source, destination, constants.COPYFILE_EXCL);
      return;
    } else if (src.isFile() && sameRegularFileContents(source, destination)) {
      return;
    }
    mkdirSync(dirname(backup), { recursive: true, mode: 0o700 });
    // Restart after an interrupted import leaves the same archival copy intact.
    if (!existsSync(backup)) cpSync(source, backup, { recursive: true, dereference: false, errorOnExist: true, force: false });
    conflicts.push(relative);
  }
  for (const [index, source] of sources.entries()) {
    for (const name of readdirSync(source)) {
      if (name === LEGACY_CONFIG_MIGRATION_STAMP || name === '.legacy-imports') continue;
      copy(join(source, name), join(roxDir, name), join(roxDir, '.legacy-imports', `source-${index}`, name), join(`source-${index}`, name));
    }
  }
  const temp = `${stamp}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify({ version: 1, sources, originalPreserved: true, conflicts }, null, 2), { mode: 0o600 });
  renameSync(temp, stamp);
}


/** Compare the opened regular objects, never reopen a previously checked path.
 * Nonblocking opens prevent a substituted FIFO from hanging application startup.
 * Chunked reads bound memory even for a large legacy workspace database. */
export function sameRegularFileContents(source: string, destination: string): boolean {
  let left: number | undefined;
  let right: number | undefined;
  const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  try {
    left = openSync(source, flags);
    right = openSync(destination, flags);
    const firstLeft = fstatSync(left);
    const firstRight = fstatSync(right);
    const currentLeft = lstatSync(source);
    const currentRight = lstatSync(destination);
    if (!firstLeft.isFile() || !firstRight.isFile()
      || currentLeft.isSymbolicLink() || currentRight.isSymbolicLink()
      || currentLeft.dev !== firstLeft.dev || currentLeft.ino !== firstLeft.ino
      || currentRight.dev !== firstRight.dev || currentRight.ino !== firstRight.ino
      || firstLeft.size !== firstRight.size || !Number.isSafeInteger(firstLeft.size)) return false;
    const a = Buffer.alloc(64 * 1024);
    const b = Buffer.alloc(64 * 1024);
    for (let position = 0; position < firstLeft.size;) {
      const length = Math.min(a.length, firstLeft.size - position);
      const leftLength = readSync(left, a, 0, length, position);
      const rightLength = readSync(right, b, 0, length, position);
      if (!leftLength || leftLength !== rightLength || !a.subarray(0, leftLength).equals(b.subarray(0, rightLength))) return false;
      position += leftLength;
    }
    const lastLeft = fstatSync(left);
    const lastRight = fstatSync(right);
    return lastLeft.size === firstLeft.size && lastRight.size === firstRight.size
      && lastLeft.mtimeMs === firstLeft.mtimeMs && lastRight.mtimeMs === firstRight.mtimeMs
      && lastLeft.ctimeMs === firstLeft.ctimeMs && lastRight.ctimeMs === firstRight.ctimeMs;
  } catch { return false; }
  finally {
    if (left !== undefined) closeSync(left);
    if (right !== undefined) closeSync(right);
  }
}
