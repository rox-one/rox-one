import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCraftBashToolDefinition } from './craft-bash-tool.ts';

describe('createCraftBashToolDefinition', () => {
  it('keeps the Pi bash name and executes through craft host-tool bash', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-craft-bash-'));
    try {
      const tool = createCraftBashToolDefinition(cwd);
      expect(tool.name).toBe('bash');
      expect(typeof tool.execute).toBe('function');
      const result = await tool.execute(
        'call-1',
        { command: 'echo pi-host-bash' },
        new AbortController().signal,
        () => {},
        {} as never,
      );
      const text = result.content
        .filter((c: { type: string }) => c.type === 'text')
        .map((c: { text?: string }) => c.text ?? '')
        .join('');
      expect(text).toContain('pi-host-bash');
      expect(text).toContain('exitCode: 0');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
