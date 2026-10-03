import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Assets seeded by headless bootstrap, including the same skill packs as desktop. */
export function copyServerBundledAssets(sourceRoot: string, destinationRoot: string): void {
  for (const name of ['docs', 'themes', 'permissions', 'tool-icons', 'skills']) {
    const source = join(sourceRoot, name);
    if (existsSync(source)) cpSync(source, join(destinationRoot, name), { recursive: true });
  }
}
