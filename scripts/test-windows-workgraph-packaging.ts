/** Verify exactly the configured Windows native resources in a clean temporary package. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { load } from 'js-yaml';

const index = process.argv.indexOf('--temp-root');
const parent = index < 0 ? undefined : process.argv[index + 1];
if (process.platform !== 'win32' || !parent || !existsSync(parent)) throw new Error('Usage: bun scripts/test-windows-workgraph-packaging.ts --temp-root <existing-temp-dir>');
const project = resolve(import.meta.dir, '../apps/electron');
const config = load(readFileSync(join(project, 'electron-builder.yml'), 'utf8')) as { win: { extraResources: { from: string; to: string }[] } };
const names = ['database', 'database-common', 'database-win32-x64-msvc'];
const work = mkdtempSync(join(resolve(parent), 'rox-workgraph-package-'));
try {
  for (const name of names) {
    const entry = config.win.extraResources.find(entry => entry.to === `app/node_modules/@tursodatabase/${name}`);
    if (!entry) throw new Error(`Windows packaging entry missing: ${name}`);
    const dest = join(work, 'resources', entry.to);
    mkdirSync(dest, { recursive: true });
    cpSync(resolve(project, entry.from), dest, { recursive: true, dereference: true });
  }
  const facade = join(work, 'resources/app/node_modules/@tursodatabase/database/dist/promise.js');
  // Only the copied package can satisfy this import. No app startup or real DB file.
  execFileSync('node', ['--input-type=module', '-e', `
import { pathToFileURL } from 'node:url';
const { connect } = await import(pathToFileURL(process.argv[1]).href);
const db = await connect(':memory:');
const row = await db.prepare('select 42 as answer').get();
if (row.answer !== 42) throw new Error('Native database query failed');
await db.close();
console.log('PASS: packaged Windows WorkGraph facade/common/NAPI addon load and in-memory SQL');
`, facade], { cwd: work, stdio: 'inherit', windowsHide: true });
} finally { rmSync(work, { recursive: true, force: true }); }
