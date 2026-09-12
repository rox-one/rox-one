/**
 * Ticket 07 — ROX_* names work beside CRAFT_*.
 * Issue 33 — clean-install default is ~/.rox; Craft-era trees stay until migration.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  _resetEnvDeprecationWarnings,
  getEnv,
  resolveConfigDir,
} from '../env.ts';

afterEach(() => {
  _resetEnvDeprecationWarnings();
});

describe('getEnv', () => {
  it("returns ROX_SERVER_TOKEN if set, else CRAFT_SERVER_TOKEN", () => {
    expect(getEnv('SERVER_TOKEN', { ROX_SERVER_TOKEN: 'rox-token' })).toBe('rox-token');
    expect(getEnv('SERVER_TOKEN', { CRAFT_SERVER_TOKEN: 'craft-token' })).toBe('craft-token');
    expect(
      getEnv('SERVER_TOKEN', {
        ROX_SERVER_TOKEN: 'rox-wins',
        CRAFT_SERVER_TOKEN: 'craft-loses',
      }),
    ).toBe('rox-wins');
    expect(getEnv('SERVER_TOKEN', {})).toBeUndefined();
  });

  it('treats empty ROX_* as unset and falls through to CRAFT_*', () => {
    expect(
      getEnv('SERVER_TOKEN', { ROX_SERVER_TOKEN: '', CRAFT_SERVER_TOKEN: 'craft-token' }),
    ).toBe('craft-token');
  });
});

describe('resolveConfigDir', () => {
  it('accepts ROX_CONFIG_DIR then CRAFT_CONFIG_DIR then ~/.rox (clean install)', () => {
    expect(resolveConfigDir({ ROX_CONFIG_DIR: '/tmp/rox-cfg' }, '/home/u')).toBe('/tmp/rox-cfg');
    expect(resolveConfigDir({ CRAFT_CONFIG_DIR: '/tmp/craft-cfg' }, '/home/u')).toBe('/tmp/craft-cfg');
    expect(
      resolveConfigDir(
        { ROX_CONFIG_DIR: '/tmp/rox-cfg', CRAFT_CONFIG_DIR: '/tmp/craft-cfg' },
        '/home/u',
      ),
    ).toBe('/tmp/rox-cfg');
    expect(resolveConfigDir({}, '/home/u-no-such-rox-home')).toBe(join('/home/u-no-such-rox-home', '.rox'));
  });

  it('keeps a Craft-era ~/.craft-agent until ~/.rox exists', () => {
    const homeDir = join(homedir(), '.rox-issue33-env-home');
    rmSync(homeDir, { recursive: true, force: true });
    mkdirSync(join(homeDir, '.craft-agent'), { recursive: true });
    writeFileSync(join(homeDir, '.craft-agent', 'keep.txt'), 'legacy');
    try {
      expect(resolveConfigDir({}, homeDir)).toBe(join(homeDir, '.craft-agent'));
      mkdirSync(join(homeDir, '.rox'), { recursive: true });
      expect(resolveConfigDir({}, homeDir)).toBe(join(homeDir, '.rox'));
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
      expect(existsSync(homeDir)).toBe(false);
    }
  });
});

describe('CRAFT_* deprecation', () => {
  it('logs one deprecation warning per process when a CRAFT_* name is used', () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (msg?: unknown) => {
      warnings.push(String(msg));
    };
    try {
      getEnv('SERVER_TOKEN', { CRAFT_SERVER_TOKEN: 'craft-token' });
      getEnv('SERVER_TOKEN', { CRAFT_SERVER_TOKEN: 'craft-token' });
      resolveConfigDir({ CRAFT_CONFIG_DIR: '/tmp/craft-cfg' }, '/home/u');
      resolveConfigDir({ CRAFT_CONFIG_DIR: '/tmp/craft-cfg' }, '/home/u');
    } finally {
      console.warn = original;
    }

    const tokenWarns = warnings.filter((w) => w.includes('CRAFT_SERVER_TOKEN'));
    const dirWarns = warnings.filter((w) => w.includes('CRAFT_CONFIG_DIR'));
    expect(tokenWarns).toHaveLength(1);
    expect(dirWarns).toHaveLength(1);
    expect(tokenWarns[0]).toMatch(/ROX_SERVER_TOKEN/);
    expect(dirWarns[0]).toMatch(/ROX_CONFIG_DIR/);
  });

  it('does not warn when the ROX_* name is set', () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (msg?: unknown) => {
      warnings.push(String(msg));
    };
    try {
      getEnv('SERVER_TOKEN', {
        ROX_SERVER_TOKEN: 'rox-token',
        CRAFT_SERVER_TOKEN: 'craft-token',
      });
    } finally {
      console.warn = original;
    }
    expect(warnings).toHaveLength(0);
  });
});
