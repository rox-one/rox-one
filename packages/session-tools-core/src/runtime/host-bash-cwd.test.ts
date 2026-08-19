import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveHostBashCwd } from './host-bash-cwd.ts';

describe('resolveHostBashCwd', () => {
  it('rejects parent-directory escape from the workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'bash-cwd-'));
    try {
      const workspace = join(root, 'ws');
      const outside = join(root, 'outside');
      mkdirSync(workspace);
      mkdirSync(outside);
      const result = resolveHostBashCwd(join(workspace, '..', 'outside'), workspace);
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('outside the workspace');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a file path used as cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'bash-cwd-file-'));
    try {
      writeFileSync(join(root, 'not-a-dir.txt'), 'x');
      const result = resolveHostBashCwd(join(root, 'not-a-dir.txt'), root);
      expect('error' in result).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
