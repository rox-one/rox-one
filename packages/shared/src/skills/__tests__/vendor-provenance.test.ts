import { expect, test } from 'bun:test';
import { readFileSync, existsSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const resources = resolve(import.meta.dir, '../../../../../apps/electron/resources/skills');
test('local vendor patches and deleted development files have honest portable provenance', () => {
  const manifest = JSON.parse(readFileSync(join(resources, 'VENDOR-SECURITY-PATCHES.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(resources, 'SKILLS.lock'), 'utf8'));
  expect(manifest.remoteClosureVerified).toBe(false);
  const paths = new Set<string>();
  for (const patch of manifest.patches) {
    expect(paths.has(patch.path)).toBe(false); paths.add(patch.path);
    expect(patch.path).not.toMatch(/^(?:\/|[A-Za-z]:)|\.\./);
    const file = join(resources, patch.path);
    expect(lstatSync(file).isSymbolicLink()).toBe(false);
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(patch.sha256);
    const pack = lock.packs.find((p: any) => p.slug === patch.pack);
    expect(pack.securityPatches.some((p: any) => p.path === patch.path && p.sha256 === patch.sha256)).toBe(true);
    expect(existsSync(join(resources, patch.pack, pack.licenseFile))).toBe(true);
  }
  expect(manifest.removedFiles).toHaveLength(190);
  for (const removed of manifest.removedFiles) {
    expect(removed.path).not.toMatch(/^(?:\/|[A-Za-z]:)|\.\./);
    expect(removed.originalSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(join(resources, removed.path))).toBe(false);
  }
});
test('every frozen bundled CodeQL finding has an explicit local disposition without claiming remote closure', () => {
  const inventory = JSON.parse(readFileSync(join(resources, 'VENDOR-CODEQL-DISPOSITIONS.json'), 'utf8'));
  expect(inventory.alerts).toHaveLength(382);
  const numbers = new Set<number>();
  for (const row of inventory.alerts) {
    expect(numbers.has(row.alert)).toBe(false); numbers.add(row.alert);
    expect(['fixed', 'pruned', 'preexisting', 'intentional-with-evidence']).toContain(row.status);
    expect(row.evidence.length).toBeGreaterThan(30);
    expect(row.remoteClosureVerified).toBe(false);
  }
});
