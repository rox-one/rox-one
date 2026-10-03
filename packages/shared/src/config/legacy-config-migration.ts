/** Copy-only import of legacy defaults. Explicit config overrides never call this. */
import { constants, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
    } else if (src.isFile() && lstatSync(destination).isFile() && readFileSync(source).equals(readFileSync(destination))) {
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
