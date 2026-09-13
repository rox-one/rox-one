import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  collectDefaultEnabledSourceSlugs,
  ensureDefaultMicroserviceSources,
  DEFAULT_ENABLED_SOURCE_SLUGS,
} from '../default-microservices.ts';
import { ensureRoxLayout } from '../../workspaces/rox-layout.ts';

describe('default microservice sources', () => {
  let workspace: string;
  let home: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'ms-ws-'));
    home = mkdtempSync(join(tmpdir(), 'ms-home-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('lists local microservices plus MCP docs as session defaults', () => {
    expect(collectDefaultEnabledSourceSlugs()).toEqual([...DEFAULT_ENABLED_SOURCE_SLUGS]);
    expect(DEFAULT_ENABLED_SOURCE_SLUGS).toContain('notes');
    expect(DEFAULT_ENABLED_SOURCE_SLUGS).toContain('craft-agents-docs');
    expect(DEFAULT_ENABLED_SOURCE_SLUGS).not.toContain('exa');
  });

  it('seeds enabled local folder sources without inventing importers', () => {
    const layout = ensureRoxLayout({ homeDir: home, workspaceRoot: workspace });
    const created = ensureDefaultMicroserviceSources(workspace, {
      roxRoot: layout.root,
      notesPath: join(layout.root, 'notes'),
    });
    expect(created.created.sort()).toEqual([
      'applications',
      'memory',
      'projects',
      'sessions',
      'tasks',
      'telegram-support',
      'workspace-tree',
    ]);
    expect(existsSync(join(workspace, 'sources', 'notes', 'config.json'))).toBe(true);
    const memory = JSON.parse(readFileSync(join(workspace, 'sources', 'memory', 'config.json'), 'utf-8'));
    expect(memory.enabled).toBe(true);
    expect(memory.type).toBe('local');
    expect(existsSync(join(workspace, 'sources', 'browser-data'))).toBe(false);
    expect(existsSync(join(workspace, 'sources', 'running-apps'))).toBe(false);
  });

  it('does not overwrite an existing disabled source', () => {
    const layout = ensureRoxLayout({ homeDir: home, workspaceRoot: workspace });
    const dir = join(workspace, 'sources', 'memory');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ slug: 'memory', enabled: false }), 'utf-8');
    ensureDefaultMicroserviceSources(workspace, {
      roxRoot: layout.root,
      notesPath: join(layout.root, 'notes'),
    });
    const again = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf-8'));
    expect(again.enabled).toBe(false);
  });
});
