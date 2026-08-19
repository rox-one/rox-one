/**
 * Ticket 10: packaged builds must not stage unread session/bridge MCP servers.
 * Pi agent server staging stays required.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { copyPiAgentServer, copySessionServer, type BuildConfig } from '../common.ts';
import {
  PACKAGED_STAGED_SUBPROCESS_SERVERS,
  UNSTAGED_LEGACY_MCP_SERVERS,
  copyElectronResourceTree,
  shouldStagePackagedServer,
} from '../staged-servers.ts';

const ROOT_DIR = join(import.meta.dir, '..', '..', '..');

describe('packaged subprocess staging (ticket 10)', () => {
  const tmpBase = join(tmpdir(), `stage-servers-test-${Date.now()}`);

  afterEach(() => {
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  function makeConfig(): BuildConfig {
    const rootDir = join(tmpBase, 'repo');
    const electronDir = join(rootDir, 'apps', 'electron');
    mkdirSync(electronDir, { recursive: true });
    return {
      platform: 'linux',
      arch: 'x64',
      upload: false,
      uploadLatest: false,
      uploadScript: false,
      rootDir,
      electronDir,
    };
  }

  it('does not copy session-mcp-server even when dist exists', () => {
    const config = makeConfig();
    const sessionSource = join(config.rootDir, 'packages', 'session-mcp-server', 'dist');
    mkdirSync(sessionSource, { recursive: true });
    writeFileSync(join(sessionSource, 'index.js'), '// session stub');

    copySessionServer(config);

    expect(existsSync(join(config.electronDir, 'resources', 'session-mcp-server', 'index.js'))).toBe(false);
  });

  it('still copies pi-agent-server when dist exists', () => {
    const config = makeConfig();
    const piSource = join(config.rootDir, 'packages', 'pi-agent-server', 'dist');
    mkdirSync(piSource, { recursive: true });
    writeFileSync(join(piSource, 'index.js'), '// pi stub');

    copyPiAgentServer(config);

    expect(existsSync(join(config.electronDir, 'resources', 'pi-agent-server', 'index.js'))).toBe(true);
  });

  it('does not copy session-mcp-server or bridge-mcp-server into the electron resource tree', () => {
    const src = join(tmpBase, 'resources');
    const dest = join(tmpBase, 'dist-resources');
    mkdirSync(join(src, 'docs'), { recursive: true });
    mkdirSync(join(src, 'pi-agent-server'), { recursive: true });
    mkdirSync(join(src, 'session-mcp-server'), { recursive: true });
    mkdirSync(join(src, 'bridge-mcp-server'), { recursive: true });
    writeFileSync(join(src, 'docs', 'readme.md'), 'docs');
    writeFileSync(join(src, 'pi-agent-server', 'index.js'), '// pi');
    writeFileSync(join(src, 'session-mcp-server', 'index.js'), '// session');
    writeFileSync(join(src, 'bridge-mcp-server', 'index.js'), '// bridge');

    copyElectronResourceTree(src, dest);

    expect(existsSync(join(dest, 'docs', 'readme.md'))).toBe(true);
    expect(existsSync(join(dest, 'pi-agent-server', 'index.js'))).toBe(true);
    expect(existsSync(join(dest, 'session-mcp-server'))).toBe(false);
    expect(existsSync(join(dest, 'bridge-mcp-server'))).toBe(false);
  });

  it('keeps pi-agent-server on the staged list and excludes unread MCP servers', () => {
    expect([...PACKAGED_STAGED_SUBPROCESS_SERVERS]).toEqual(['pi-agent-server']);
    expect([...UNSTAGED_LEGACY_MCP_SERVERS].sort()).toEqual(['bridge-mcp-server', 'session-mcp-server']);
    expect(shouldStagePackagedServer('pi-agent-server')).toBe(true);
    expect(shouldStagePackagedServer('session-mcp-server')).toBe(false);
    expect(shouldStagePackagedServer('bridge-mcp-server')).toBe(false);
  });
});

describe('electron-builder packaging globs (ticket 10)', () => {
  it('does not include unread session/bridge MCP servers and still includes pi-agent-server', () => {
    const yml = readFileSync(join(ROOT_DIR, 'apps', 'electron', 'electron-builder.yml'), 'utf8');
    expect(yml).toContain('resources/pi-agent-server/**/*');
    expect(yml).not.toMatch(/^\s+- resources\/session-mcp-server\/\*\*\/\*/m);
    expect(yml).not.toMatch(/^\s+- resources\/bridge-mcp-server\/\*\*\/\*/m);
  });
});
