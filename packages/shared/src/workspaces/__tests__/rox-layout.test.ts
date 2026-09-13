import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureRoxLayout, resolveRoxRoot, ROX_LAYOUT_FOLDERS } from '../rox-layout.ts';

describe('rox layout helper', () => {
  let home: string;
  let workspace: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'rox-layout-home-'));
    workspace = mkdtempSync(join(tmpdir(), 'rox-layout-ws-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  });

  it('resolves ~/rox from an explicit homeDir', () => {
    expect(resolveRoxRoot({ homeDir: home, workspaceRoot: workspace })).toBe(join(home, 'rox'));
  });

  it('falls back to workspace/rox when homeDir is empty and workspace is given', () => {
    expect(resolveRoxRoot({ homeDir: '', workspaceRoot: workspace })).toBe(join(workspace, 'rox'));
  });

  it('creates the full folder set', () => {
    const result = ensureRoxLayout({ homeDir: home, workspaceRoot: workspace });
    expect(result.root).toBe(join(home, 'rox'));
    for (const folder of ROX_LAYOUT_FOLDERS) {
      expect(existsSync(join(result.root, folder))).toBe(true);
    }
    expect(ROX_LAYOUT_FOLDERS).toEqual([
      'notes',
      'audio',
      'transcripts',
      'sessions',
      'imports',
      'passwords',
      'extensions',
      'mcp',
      'tools',
      'agents',
      'rules',
      'skills',
      'memory',
    ]);
  });

  it('is idempotent', () => {
    const first = ensureRoxLayout({ homeDir: home });
    const second = ensureRoxLayout({ homeDir: home });
    expect(second.root).toBe(first.root);
    expect(second.created).toEqual([]);
  });
});
