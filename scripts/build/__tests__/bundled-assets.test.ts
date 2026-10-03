import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyServerBundledAssets } from '../bundled-assets.ts';
import { ensureBundledSkills } from '../../../packages/shared/src/skills/bundled.ts';

describe('headless bundled assets', () => {
  it('packages skill metadata and nested runtime assets that bootstrap can install', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'server-bundled-assets-'));
    try {
      const sourceRoot = join(fixture, 'source');
      const bundle = join(sourceRoot, 'skills');
      const runtime = join(bundle, 'understand-anything', 'understand', 'plugin');
      mkdirSync(runtime, { recursive: true });
      writeFileSync(join(runtime, 'package.json'), '{"name":"fixture-runtime"}');
      writeFileSync(join(bundle, 'understand-anything', 'understand', 'SKILL.md'), '---\nname: understand\ndescription: Explore code\n---\nUse plugin/');
      writeFileSync(join(bundle, 'SKILLS.lock'), JSON.stringify({ packs: [{ slug: 'understand-anything', commit: 'fixture-pin' }] }));
      const destinationRoot = join(fixture, 'distribution', 'resources');

      copyServerBundledAssets(sourceRoot, destinationRoot);
      const installedRoot = join(fixture, 'global-skills');
      const result = ensureBundledSkills({ bundleRoot: join(destinationRoot, 'skills'), targetRoot: installedRoot, disabled: [] });

      expect(result.packs[0]?.installed).toEqual(['understand']);
      expect(result.packs[0]?.commit).toBe('fixture-pin');
      expect(result.packs[0]?.error).toBeUndefined();
      expect(readFileSync(join(installedRoot, 'understand', 'plugin', 'package.json'), 'utf8')).toContain('fixture-runtime');
      expect(existsSync(join(destinationRoot, 'skills', 'SKILLS.lock'))).toBe(true);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
