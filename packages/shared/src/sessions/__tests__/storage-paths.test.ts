import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandPath, normalizePath, toPortablePath } from '../../utils/paths.ts';
import { createSessionHeader, expandSessionPath, makeSessionPathPortable, readSessionHeader, readSessionJsonl } from '../jsonl.ts';
import { getSessionFilePath, loadSession, saveSession, sessionPersistenceQueue } from '../storage.ts';
import type { StoredSession } from '../types.ts';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function session(workspaceRootPath: string): StoredSession {
  return {
    id: '261003-path-regression', workspaceRootPath, createdAt: 1, lastUsedAt: 2,
    workingDirectory: join(workspaceRootPath, 'Project With Spaces'),
    sdkCwd: join(workspaceRootPath, 'sessions', '261003-path-regression'),
    messages: [{ id: 'm1', type: 'user', content: 'kept', timestamp: 1 }],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
  };
}

describe('session storage path round trips', () => {
  it('does not turn a twice-portabilized workspace into cwd/~/ on reload', () => {
    const original = session(join(homedir(), '.rox', 'workspaces', 'my-workspace'));
    const alreadyPortable = { ...original, workspaceRootPath: toPortablePath(original.workspaceRootPath) };
    const header = createSessionHeader(alreadyPortable);
    expect(header.workspaceRootPath).toBe('~/.rox/workspaces/my-workspace');
    expect(expandPath(header.workspaceRootPath)).toBe(original.workspaceRootPath);
  });

  it('persists canonical home-relative paths and reloads absolute paths via the queue', async () => {
    const root = mkdtempSync(join(tmpdir(), 'session-storage-paths-'));
    tempDirs.push(root);
    const original = session(root);
    mkdirSync(original.workingDirectory!, { recursive: true });
    await saveSession(original);
    try {
      const file = getSessionFilePath(root, original.id);
      const header = readSessionHeader(file)!;
      expect(header.workspaceRootPath).toBe(toPortablePath(root));
      if (header.workspaceRootPath.startsWith('~')) expect(header.workspaceRootPath).not.toContain('\\');
      expect(header.workingDirectory).toBe(toPortablePath(original.workingDirectory!));
      const loaded = loadSession(root, original.id)!;
      expect(loaded.workspaceRootPath).toBe(root);
      expect(loaded.workingDirectory).toBe(original.workingDirectory);
      expect(loaded.sdkCwd).toBe(original.sdkCwd);
      expect(loaded.messages).toEqual(original.messages);
      await saveSession(loaded);
      expect(readSessionJsonl(file)?.workspaceRootPath).toBe(root);
      expect(readFileSync(file, 'utf8')).not.toContain('~\\\\');
    } finally {
      sessionPersistenceQueue.cancel(original.id);
    }
  });

  it('reads legacy backslash-tilde headers without resolving them beneath cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'session-legacy-paths-'));
    tempDirs.push(root);
    const workspace = join(homedir(), '.rox', 'workspaces', 'my-workspace');
    const original = session(workspace);
    const file = join(root, 'session.jsonl');
    const header = {
      ...createSessionHeader(original),
      workspaceRootPath: '~\\.rox\\workspaces\\my-workspace',
      workingDirectory: '~\\.rox\\workspaces\\my-workspace\\Project With Spaces',
      sdkCwd: '~\\.rox\\workspaces\\my-workspace\\sessions\\261003-path-regression',
    };
    writeFileSync(file, `${JSON.stringify(header)}\n${JSON.stringify(original.messages[0])}\n`);
    const loaded = readSessionJsonl(file)!;
    expect(loaded.workspaceRootPath).toBe(original.workspaceRootPath);
    expect(loaded.workingDirectory).toBe(original.workingDirectory);
    expect(loaded.sdkCwd).toBe(original.sdkCwd);
    expect(loaded.messages).toEqual(original.messages);
  });

  it('makes native and forward-slash Windows references portable', () => {
    const dir = 'C:\\Users\\Alice\\Project With Spaces\\sessions\\s1';
    const line = JSON.stringify({ storedPath: `${dir}\\attachments\\file.txt`, planPath: `${normalizePath(dir)}/plans/plan.md` });
    const portable = makeSessionPathPortable(line, dir);
    expect(portable).not.toContain('C:');
    const restored = JSON.parse(expandSessionPath(portable, dir));
    expect(normalizePath(restored.storedPath)).toBe(`${normalizePath(dir)}/attachments/file.txt`);
    expect(restored.planPath).toBe(`${normalizePath(dir)}/plans/plan.md`);
  });
});
