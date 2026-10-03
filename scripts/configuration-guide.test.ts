import { expect, test } from 'bun:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateConfigurationCliEntries } from '../apps/electron/src/main/configuration-cli-compat';

const root = join(import.meta.dir, '..');
const wrapper = join(root, 'apps/electron/resources/bin/craft-agent');

test('active configuration guides describe working interfaces instead of missing CLI commands', () => {
  for (const name of ['craft-cli', 'sources', 'permissions', 'labels', 'skills', 'automations']) {
    const guide = readFileSync(join(root, 'apps/electron/resources/docs', `${name}.md`), 'utf8');
    expect(guide).not.toMatch(/craft-agent\s+(?:label|source|skill|automation|permission|theme)\b/);
    expect(guide).not.toContain('CLI-first');
  }
  const setup = readFileSync(join(root, 'apps/electron/src/main/index.ts'), 'utf8');
  expect(setup).not.toContain("'packages', 'craft-cli'");
  expect(setup).not.toContain("'packages', 'craft-agents-commands'");
  expect(setup).toContain("validateConfigurationCliEntries(process.env)");
});

test('legacy wrapper fails with an actionable message when no compatible CLI exists', () => {
  for (const entry of ['', '/missing-configuration-cli/entry.ts']) {
    const result = spawnSync('/bin/sh', [wrapper, 'label', 'list'], {
      env: { ...process.env, CRAFT_COMMANDS_ENTRY: entry, CRAFT_CLI_ENTRY: '' },
    });
    expect(result.status).toBe(69);
    expect(result.stderr.toString()).toContain('ROX does not bundle a configuration CLI');
  }
});

test('legacy wrapper preserves an explicitly supplied working CLI entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rox-cli-compat-'));
  try {
    const entry = join(dir, 'entry.ts'); writeFileSync(entry, '// supplied CLI');
    const runtime = join(dir, 'runtime');
    writeFileSync(runtime, '#!/bin/sh\nprintf "%s\\n" "$1" "$3" "$4"\n', { mode: 0o755 });
    const result = spawnSync('/bin/sh', [wrapper, 'label', 'list'], {
      env: { ...process.env, CRAFT_COMMANDS_ENTRY: entry, CRAFT_CLI_ENTRY: '', CRAFT_BUN: runtime },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.toString()).toBe('run\nlabel\nlist\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('missing CLI never silently disables explicitly requested config guards', () => {
  for (const value of ['1', 'true', 'YES', 'on']) {
    const env = { CRAFT_FEATURE_CRAFT_AGENTS_CLI: value, CRAFT_COMMANDS_ENTRY: '/missing/cli.ts' };
    expect(() => validateConfigurationCliEntries(env)).toThrow('ROX has not disabled your configuration guards');
    expect(env.CRAFT_FEATURE_CRAFT_AGENTS_CLI).toBe(value);
  }
  const defaultEnv = {};
  expect(() => validateConfigurationCliEntries(defaultEnv)).not.toThrow();
  expect(defaultEnv).toEqual({});
});
