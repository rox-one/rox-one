import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertPortableSkillResources } from './electron-build-resources';

test('bundled skills contain only portable ordinary files', () => {
  expect(() => assertPortableSkillResources(join(import.meta.dir, '../apps/electron/resources/skills'))).not.toThrow();
});

test('resource validation rejects dangling or valid symlinks with an actionable relative path', () => {
  const root = mkdtempSync(join(tmpdir(), 'rox-resource-'));
  try {
    mkdirSync(join(root, 'skill')); writeFileSync(join(root, 'skill/SKILL.md'), 'skill');
    symlinkSync('/missing-developer-worktree/skill', join(root, 'skill/alias'));
    expect(() => assertPortableSkillResources(root)).toThrow('skill/alias');
    rmSync(join(root, 'skill/alias'));
    symlinkSync('SKILL.md', join(root, 'skill/alias'));
    expect(() => assertPortableSkillResources(root)).toThrow('Vendor ordinary files');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
