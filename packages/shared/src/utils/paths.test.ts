import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, normalize, parse } from 'node:path';
import {
  expandPath, expandVars, hasPathVariables, normalizePath,
  pathStartsWith, resolveStdioConfig, stripPathPrefix, toPortablePath,
} from './paths.ts';

describe('native path portability', () => {
  it('keeps repeated serialization portable and reversible', () => {
    const absolute = join(homedir(), '.rox', 'workspaces', 'my-workspace');
    const portable = '~/.rox/workspaces/my-workspace';
    expect(toPortablePath(absolute)).toBe(portable);
    expect(toPortablePath(toPortablePath(absolute))).toBe(portable);
    expect(expandPath(portable)).toBe(absolute);
    expect(expandPath('~\\.rox\\workspaces\\my-workspace')).toBe(absolute);
  });

  it('expands either variable delimiter without resolving bare arguments', () => {
    expect(expandVars('$HOME\\.rox')).toBe(`${homedir()}\\.rox`);
    expect(expandVars('$ROOT\\file', { ROOT: homedir() })).toBe(`${homedir()}\\file`);
    expect(expandVars('${ROOT}/file', { ROOT: '/literal/$&/$$' })).toBe('/literal/$&/$$/file');
    for (const input of ['dart', 'true', 'production', '~other/file', '$HOME_SUFFIX']) {
      expect(expandVars(input)).toBe(input);
    }
    expect(hasPathVariables('$HOME\\.rox')).toBe(true);
    expect(hasPathVariables('$HOME')).toBe(true);
    expect(hasPathVariables('$HOME_SUFFIX')).toBe(false);
  });

  it('compares directory boundaries including filesystem roots', () => {
    const dir = join(homedir(), 'Project');
    const file = join(dir, 'Docs', 'Report.TXT');
    expect(pathStartsWith(file, `${dir}/`)).toBe(true);
    expect(pathStartsWith(file, parse(file).root)).toBe(true);
    expect(pathStartsWith(`${dir}-other/file`, dir)).toBe(false);
    expect(stripPathPrefix(file, `${dir}/`)).toBe('Docs/Report.TXT');
    expect(stripPathPrefix(file, parse(file).root)).toBe(normalizePath(file).slice(normalizePath(parse(file).root).length));
    expect(expandPath('./file', dir)).toBe(normalize(join(dir, 'file')));
  });

  it('expands stdio path variables while preserving command, flags and source config', () => {
    const mcp = {
      command: 'node', args: ['${SOURCE_DIR}/server.js', 'true'], env: { MODE: 'production' },
      platform: { [process.platform]: { args: ['$SOURCE_DIR\\server.js', 'true'], env: { WORKSPACE: '$WORKSPACE\\data' } } },
    };
    const before = JSON.stringify(mcp);
    const workspace = join(homedir(), 'Project With Spaces');
    const source = join(workspace, 'sources', 'example');
    expect(resolveStdioConfig(mcp, workspace, source)).toEqual({
      command: 'node', args: [`${source}\\server.js`, 'true'],
      env: { MODE: 'production', WORKSPACE: `${workspace}\\data` },
    });
    expect(JSON.stringify(mcp)).toBe(before);
  });
});

describe('isolated cross-platform path dialects', () => {
  for (const platform of ['linux', 'win32'] as const) {
    it(`round trips and compares paths using ${platform} semantics`, () => {
      const home = platform === 'win32' ? 'C:\\Users\\Alice' : '/home/Alice';
      // Bun inlines os.homedir(): supply its environment instead of mocking it.
      // Path/platform mocks live only in this child, never in the test runner.
      const script = `
        import { mock } from 'bun:test';
        import assert from 'node:assert/strict';
        import nativePath from 'node:path';
        import { homedir } from 'node:os';
        const platform = ${JSON.stringify(platform)};
        const home = ${JSON.stringify(home)};
        const dialect = platform === 'win32' ? nativePath.win32 : nativePath.posix;
        assert.equal(homedir(), home);
        Object.defineProperty(process, 'platform', { value: platform });
        mock.module('path', () => ({ ...dialect, default: dialect }));
        const p = await import(${JSON.stringify(new URL('./paths.ts', import.meta.url).href)});
        const absolute = dialect.join(home, '.rox', 'workspaces', 'my-workspace');
        assert.equal(p.toPortablePath(absolute), '~/.rox/workspaces/my-workspace');
        assert.equal(p.toPortablePath(p.toPortablePath(absolute)), '~/.rox/workspaces/my-workspace');
        assert.equal(p.expandPath('~/.rox/workspaces/my-workspace'), absolute);
        assert.equal(p.expandPath('~\\\\.rox\\\\workspaces\\\\my-workspace'), absolute);
        assert.equal(p.toPortablePath(home + dialect.sep), '~');
        assert.equal(p.toPortablePath(dialect.join(home + '-other', 'file')), dialect.join(home + '-other', 'file'));
        const file = dialect.join(home, 'Project', 'Docs', 'Report.TXT');
        assert.equal(p.pathStartsWith(file, dialect.parse(file).root), true);
        assert.equal(p.stripPathPrefix(file, dialect.join(home, 'Project') + dialect.sep), 'Docs/Report.TXT');
        assert.equal(p.pathStartsWith(file, dialect.join(home.toLowerCase(), 'project')), platform === 'win32');
        console.log(platform + ': path dialect assertions passed');
      `;
      const result = spawnSync(process.execPath, ['--eval', script], {
        cwd: import.meta.dir,
        env: { ...process.env, HOME: home, USERPROFILE: home },
        encoding: 'utf8', timeout: 30_000,
      });
      expect({ status: result.status, error: result.error?.message, stderr: result.stderr }).toEqual({
        status: 0, error: undefined, stderr: '',
      });
      expect(result.stdout).toContain(`${platform}: path dialect assertions passed`);
    });
  }
});

describe('Windows filesystem semantics', () => {
  it.skipIf(process.platform !== 'win32')('compares home case-insensitively without lowercasing stored suffixes', () => {
    const path = join(homedir(), '.rox', 'Project', 'Report.TXT');
    expect(toPortablePath(path.toUpperCase())).toBe('~/.ROX/PROJECT/REPORT.TXT');
    expect(toPortablePath(`${homedir()}\\`)).toBe('~');
    expect(toPortablePath(join(`${homedir()}-other`, 'file'))).toBe(join(`${homedir()}-other`, 'file'));
  });

  it.skipIf(process.platform !== 'win32')('keeps UNC paths absolute and handles share roots', () => {
    const path = '\\\\server\\share\\Folder\\File.TXT';
    expect(expandPath(path)).toBe(path);
    expect(pathStartsWith(path, '\\\\SERVER\\SHARE\\')).toBe(true);
    expect(stripPathPrefix(path, '\\\\SERVER\\SHARE\\')).toBe('Folder/File.TXT');
  });
});
