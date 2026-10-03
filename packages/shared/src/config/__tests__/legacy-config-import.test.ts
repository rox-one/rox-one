import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfigDir } from '../env.ts';
import { LEGACY_CONFIG_MIGRATION_STAMP } from '../legacy-config-migration.ts';
const roots: string[] = [];
function home() { const path = mkdtempSync(join(tmpdir(), 'rox-import-')); roots.push(path); return path; }
function put(root: string, path: string, body: string) { const target = join(root, path); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, body); }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('default ROX config import', () => {
  it('imports legacy data to canonical default without changing the source', () => {
    const root = home(); put(root, '.craft-agent/context/rules.md', 'my rules');
    expect(resolveConfigDir({}, root)).toBe(join(root, '.rox'));
    expect(readFileSync(join(root, '.rox/context/rules.md'), 'utf8')).toBe('my rules');
    expect(readFileSync(join(root, '.craft-agent/context/rules.md'), 'utf8')).toBe('my rules');
    expect(existsSync(join(root, '.rox', LEGACY_CONFIG_MIGRATION_STAMP))).toBe(true);
  });
  it('preserves ROX conflicts outside the active context and imports missing files', () => {
    const root = home(); put(root, '.craft-agent/context/rules.md', 'legacy rules'); put(root, '.rox/context/rules.md', 'rox rules');
    put(root, '.craft-agents/context/extra.md', 'additional');
    resolveConfigDir({}, root);
    expect(readFileSync(join(root, '.rox/context/rules.md'), 'utf8')).toBe('rox rules');
    expect(readFileSync(join(root, '.rox/.legacy-imports/source-0/context/rules.md'), 'utf8')).toBe('legacy rules');
    expect(readFileSync(join(root, '.rox/context/extra.md'), 'utf8')).toBe('additional');
    put(root, '.craft-agent/context/later.md', 'not reimported'); resolveConfigDir({}, root);
    expect(existsSync(join(root, '.rox/context/later.md'))).toBe(false);
  });
  it('explicit environments remain isolated and never import global data', () => {
    const root = home(); put(root, '.craft-agent/context/rules.md', 'private');
    expect(resolveConfigDir({ ROX_CONFIG_DIR: '/isolated', CRAFT_CONFIG_DIR: '/other' }, root)).toBe('/isolated');
    expect(resolveConfigDir({ CRAFT_CONFIG_DIR: '/legacy-explicit' }, root)).toBe('/legacy-explicit');
    expect(existsSync(join(root, '.rox'))).toBe(false);
  });
});
