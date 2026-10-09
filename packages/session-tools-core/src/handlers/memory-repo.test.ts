/**
 * Memory repository session tools (memory_repo_read / memory_repo_search) —
 * Wave B read capabilities over the registered MemoryRepoToolRuntime.
 *
 * Tests run the handlers against an in-memory runtime double (registered through
 * the same seam the server-core memory-repo RPC layer populates in production),
 * asserting: file content + truncation, lessonId path resolution, deterministic
 * bounded search over paths and contents, typed error mapping
 * (MEMORY_REPO_UNAVAILABLE with no runtime, MEMORY_REPO_BANK_NOT_FOUND for an
 * unknown bank), and registration parity in SESSION_TOOL_DEFS.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  clearMemoryRepoToolRuntime,
  getMemoryRepoToolRuntime,
  registerMemoryRepoToolRuntime,
  type MemoryRepoBankRef,
  type MemoryRepoFileView,
  type MemoryRepoToolRuntime,
  type MemoryRepoTreeEntry,
} from '../memory-repo/runtime.ts';
import {
  handleMemoryRepoRead,
  handleMemoryRepoSearch,
  MEMORY_REPO_READ_MAX_CHARS,
  MEMORY_REPO_SEARCH_MAX_LIMIT,
} from './memory-repo.ts';
import {
  SESSION_TOOL_REGISTRY,
  getSessionSafeAllowedToolNames,
  getSessionToolNames,
} from '../tool-defs.ts';
import type { SessionToolContext } from '../context.ts';

const CTX = { sessionId: 'sess-1' } as unknown as SessionToolContext;

const BANKS: MemoryRepoBankRef[] = [
  { id: 'main', scope: 'main', label: 'Main', repoPath: '/tmp/main', isMain: true },
  { id: 'ws:w1', scope: 'workspace', label: 'Workspace', repoPath: '/tmp/ws-w1', isMain: false },
];

const FILES: Record<string, MemoryRepoFileView> = {
  'MEMORY.md': {
    path: 'MEMORY.md',
    content: '# Memory\n\nStanding facts about the kernel and the build.',
    truncated: false,
    edited: false,
  },
  'lessons/kernel-guide.md': {
    path: 'lessons/kernel-guide.md',
    content: '---\nid: lesson-kernel\ncategory: kernel\n---\n\n# Kernel guide\n\nHow the kernel boots.',
    truncated: false,
    edited: true,
    lessonId: 'lesson-kernel',
  },
  'lessons/unrelated.md': {
    path: 'lessons/unrelated.md',
    content: '---\nid: lesson-unrelated\n---\n\nNothing to see here.',
    truncated: false,
    edited: false,
    lessonId: 'lesson-unrelated',
  },
};

function treeFor(paths: string[]): MemoryRepoTreeEntry[] {
  const nodes: MemoryRepoTreeEntry[] = [];
  const seenDirs = new Set<string>();
  for (const path of paths) {
    const segments = path.split('/');
    for (let depth = 0; depth < segments.length - 1; depth++) {
      const dir = segments.slice(0, depth + 1).join('/');
      if (seenDirs.has(dir)) continue;
      seenDirs.add(dir);
      nodes.push({ path: dir, name: segments[depth]!, type: 'dir', depth });
    }
    nodes.push({ path, name: segments[segments.length - 1]!, type: 'file', depth: segments.length - 1 });
  }
  return nodes.sort((a, b) => (a.path === b.path ? 0 : a.path < b.path ? -1 : 1));
}

type RuntimeCall =
  | { method: 'listBanks' }
  | { method: 'tree'; bankId: string }
  | { method: 'readFile'; bankId: string; path: string }
  | { method: 'resolveWorkspaceId'; workspacePath: string };

interface RuntimeRecorder {
  runtime: MemoryRepoToolRuntime;
  calls: RuntimeCall[];
}

function registerRuntimeDouble(overrides: Partial<MemoryRepoToolRuntime> = {}): RuntimeRecorder {
  const calls: RuntimeCall[] = [];
  const runtime: MemoryRepoToolRuntime = {
    async listBanks() {
      calls.push({ method: 'listBanks' });
      return BANKS;
    },
    async tree(bankId) {
      calls.push({ method: 'tree', bankId });
      return treeFor(Object.keys(FILES));
    },
    async readFile(bankId, path) {
      calls.push({ method: 'readFile', bankId, path });
      const file = FILES[path];
      if (!file) throw new Error(`file not found: ${path}`);
      return file;
    },
    resolveWorkspaceId(workspacePath) {
      calls.push({ method: 'resolveWorkspaceId', workspacePath });
      return null;
    },
    ...overrides,
  };
  registerMemoryRepoToolRuntime(runtime);
  return { runtime, calls };
}

afterEach(() => {
  clearMemoryRepoToolRuntime();
});

// ---------------------------------------------------------------------------
// Tool registration (parity surface for Claude / Pi / OMP)
// ---------------------------------------------------------------------------

describe('registration', () => {
  it('registers both memory-repo read tools in the canonical registry', () => {
    for (const name of ['memory_repo_read', 'memory_repo_search']) {
      const def = SESSION_TOOL_REGISTRY.get(name);
      expect(def).toBeDefined();
      expect(def!.executionMode).toBe('registry');
      expect(typeof def!.handler).toBe('function');
      expect(def!.safeMode).toBe('allow');
      expect(def!.readOnly).toBe(true);
      expect(def!.inputSchema).toBeDefined();
    }
  });

  it('exposes the tools as safe-mode allowed with the mcp__session__ prefix', () => {
    const names = getSessionToolNames();
    expect(names.has('memory_repo_read')).toBe(true);
    expect(names.has('memory_repo_search')).toBe(true);

    const safeAllowed = getSessionSafeAllowedToolNames({ prefix: 'mcp__session__' });
    expect(safeAllowed.has('mcp__session__memory_repo_read')).toBe(true);
    expect(safeAllowed.has('mcp__session__memory_repo_search')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Runtime registry
// ---------------------------------------------------------------------------

describe('memory-repo tool runtime registry', () => {
  it('is empty by default and round-trips a registration', () => {
    expect(getMemoryRepoToolRuntime()).toBeNull();
    const { runtime } = registerRuntimeDouble();
    expect(getMemoryRepoToolRuntime()).toBe(runtime);
    clearMemoryRepoToolRuntime();
    expect(getMemoryRepoToolRuntime()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// memory_repo_read
// ---------------------------------------------------------------------------

describe('memory_repo_read', () => {
  it('returns a typed MEMORY_REPO_UNAVAILABLE error when no runtime is registered', async () => {
    const res = await handleMemoryRepoRead(CTX, { path: 'MEMORY.md' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('MEMORY_REPO_UNAVAILABLE');
  });

  it('reads a file by path and renders frontmatter + body with provenance', async () => {
    registerRuntimeDouble();
    const res = await handleMemoryRepoRead(CTX, { path: 'lessons/kernel-guide.md' });
    expect(res.isError).toBeFalsy();
    const text = res.content.map((c) => c.text).join('\n');
    expect(text).toContain('_bank: main_');
    expect(text).toContain('lessons/kernel-guide.md');
    expect(text).toContain('lessonId: lesson-kernel');
    expect(text).toContain('id: lesson-kernel');
    expect(text).toContain('How the kernel boots.');
    expect(text).toContain('edited: true');
  });

  it('resolves a file from a lessonId', async () => {
    const { calls } = registerRuntimeDouble();
    const res = await handleMemoryRepoRead(CTX, { lessonId: 'lesson-kernel' });
    expect(res.isError).toBeFalsy();
    const text = res.content.map((c) => c.text).join('\n');
    expect(text).toContain('lessons/kernel-guide.md');
    expect(text).toContain('How the kernel boots.');
    const readPaths = calls.filter((c) => c.method === 'readFile').map((c) => c.path);
    expect(readPaths).toContain('lessons/kernel-guide.md');
  });

  it('reports NOT_FOUND for an unknown lessonId', async () => {
    registerRuntimeDouble();
    const res = await handleMemoryRepoRead(CTX, { lessonId: 'nope' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('NOT_FOUND');
  });

  it('requires path or lessonId', async () => {
    registerRuntimeDouble();
    const res = await handleMemoryRepoRead(CTX, {});
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('INVALID_ARGS');
  });

  it('truncates oversized bodies with a visible marker', async () => {
    registerRuntimeDouble({
      async readFile(bankId, path) {
        return {
          path,
          content: 'y'.repeat(MEMORY_REPO_READ_MAX_CHARS * 2),
          truncated: false,
          edited: false,
        };
      },
    });
    const res = await handleMemoryRepoRead(CTX, { path: 'MEMORY.md' });
    const text = res.content.map((c) => c.text).join('\n');
    expect(text.length).toBeLessThan(MEMORY_REPO_READ_MAX_CHARS * 2);
    expect(text.toLowerCase()).toContain('truncat');
  });

  it('rejects an unknown bank with a typed error', async () => {
    registerRuntimeDouble();
    const res = await handleMemoryRepoRead(CTX, { path: 'MEMORY.md', bank: 'nope' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('MEMORY_REPO_BANK_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// memory_repo_search
// ---------------------------------------------------------------------------

describe('memory_repo_search', () => {
  it('returns a typed MEMORY_REPO_UNAVAILABLE error when no runtime is registered', async () => {
    const res = await handleMemoryRepoSearch(CTX, { query: 'kernel' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('MEMORY_REPO_UNAVAILABLE');
  });

  it('matches content with deterministic path order and reports lessonId + snippet', async () => {
    registerRuntimeDouble();
    const res = await handleMemoryRepoSearch(CTX, { query: 'kernel' });
    expect(res.isError).toBeFalsy();
    const text = res.content.map((c) => c.text).join('\n');
    expect(text).toContain('2 match(es)');
    // 'MEMORY.md' sorts before 'lessons/...' on codepoints.
    expect(text.indexOf('MEMORY.md')).toBeLessThan(text.indexOf('lessons/kernel-guide.md'));
    expect(text).toContain('lessonId: lesson-kernel');
    expect(text).toContain('Standing facts about the kernel');
    expect(text).not.toContain('lessons/unrelated.md');
  });

  it('requires all query words to match (path or content)', async () => {
    registerRuntimeDouble();
    const res = await handleMemoryRepoSearch(CTX, { query: 'kernel guide' });
    const text = res.content.map((c) => c.text).join('\n');
    expect(text).toContain('1 match(es)');
    expect(text).toContain('lessons/kernel-guide.md');
    expect(text).not.toContain('MEMORY.md');
  });

  it('applies a deterministic hard limit and flags the truncation', async () => {
    registerRuntimeDouble({
      async readFile(bankId, path) {
        return { path, content: `kernel ${path}`, truncated: false, edited: false };
      },
    });
    const res = await handleMemoryRepoSearch(CTX, { query: 'kernel', limit: 1 });
    const text = res.content.map((c) => c.text).join('\n');
    expect(text).toContain('3 match(es), first 1 shown (limit 1)');
    expect(text).toContain('MEMORY.md');
    expect(text).not.toContain('lessons/unrelated.md');
  });

  it('clamps the requested limit to the hard cap', async () => {
    registerRuntimeDouble({
      async tree() {
        return treeFor(Array.from({ length: MEMORY_REPO_SEARCH_MAX_LIMIT + 10 }, (_, i) => `notes/file-${String(i).padStart(2, '0')}.md`));
      },
      async readFile(bankId, path) {
        return { path, content: 'kernel', truncated: false, edited: false };
      },
    });
    const res = await handleMemoryRepoSearch(CTX, { query: 'kernel', limit: 5000 });
    const text = res.content.map((c) => c.text).join('\n');
    expect(text).toContain(`first ${MEMORY_REPO_SEARCH_MAX_LIMIT} shown`);
  });

  it('rejects an empty query and an unknown bank', async () => {
    registerRuntimeDouble();
    const empty = await handleMemoryRepoSearch(CTX, { query: '   ' });
    expect(empty.isError).toBe(true);
    expect(empty.content[0]!.text).toContain('INVALID_ARGS');

    const badBank = await handleMemoryRepoSearch(CTX, { query: 'kernel', bank: 'nope' });
    expect(badBank.isError).toBe(true);
    expect(badBank.content[0]!.text).toContain('MEMORY_REPO_BANK_NOT_FOUND');
  });

  it('reports an honest empty state', async () => {
    registerRuntimeDouble();
    const res = await handleMemoryRepoSearch(CTX, { query: 'zzzzz' });
    expect(res.isError).toBeFalsy();
    expect(res.content[0]!.text).toContain('No matches.');
  });
});

// ---------------------------------------------------------------------------
// Session workspace scoping (a session bound to workspace A must not read B)
// ---------------------------------------------------------------------------

describe('memory-repo session workspace scoping', () => {
  const WS_A_CTX = { sessionId: 'sess-a', workspacePath: '/rox/workspaces/a' } as unknown as SessionToolContext;

  const SCOPED_BANKS: MemoryRepoBankRef[] = [
    { id: 'main', scope: 'main', label: 'Main', repoPath: '/tmp/main', isMain: true },
    { id: 'ws:a', scope: 'workspace', label: 'A', repoPath: '/tmp/ws-a', isMain: false },
    { id: 'ws:b', scope: 'workspace', label: 'B', repoPath: '/tmp/ws-b', isMain: false },
  ];

  /** A runtime whose registered workspace resolver maps only `/rox/workspaces/a` → 'a'. */
  function registerScopedRuntime(): RuntimeRecorder {
    return registerRuntimeDouble({
      async listBanks() {
        return SCOPED_BANKS;
      },
      resolveWorkspaceId(workspacePath) {
        return workspacePath === '/rox/workspaces/a' ? 'a' : null;
      },
    });
  }

  it('refuses a foreign workspace bank on memory_repo_read before reading anything', async () => {
    const { calls } = registerScopedRuntime();
    const res = await handleMemoryRepoRead(WS_A_CTX, { path: 'MEMORY.md', bank: 'ws:b' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('MEMORY_REPO_BANK_NOT_FOUND');
    expect(res.content[0]!.text).toContain('Available banks: main, ws:a');
    expect(calls.some((c) => c.method === 'readFile')).toBe(false);
  });

  it('serves the session own workspace bank and the local main bank', async () => {
    registerScopedRuntime();
    const own = await handleMemoryRepoRead(WS_A_CTX, { path: 'MEMORY.md', bank: 'ws:a' });
    expect(own.isError).toBeFalsy();
    expect(own.content.map((c) => c.text).join('\n')).toContain('_bank: ws:a_');

    const main = await handleMemoryRepoRead(WS_A_CTX, { path: 'MEMORY.md', bank: 'main' });
    expect(main.isError).toBeFalsy();
    expect(main.content.map((c) => c.text).join('\n')).toContain('_bank: main_');

    const implicit = await handleMemoryRepoRead(WS_A_CTX, { path: 'MEMORY.md' });
    expect(implicit.isError).toBeFalsy();
    expect(implicit.content.map((c) => c.text).join('\n')).toContain('_bank: main_');
  });

  it('refuses a foreign workspace bank on memory_repo_search and still serves its own', async () => {
    registerScopedRuntime();
    const foreign = await handleMemoryRepoSearch(WS_A_CTX, { query: 'kernel', bank: 'ws:b' });
    expect(foreign.isError).toBe(true);
    expect(foreign.content[0]!.text).toContain('MEMORY_REPO_BANK_NOT_FOUND');
    expect(foreign.content[0]!.text).toContain('Available banks: main, ws:a');

    const own = await handleMemoryRepoSearch(WS_A_CTX, { query: 'kernel', bank: 'ws:a' });
    expect(own.isError).toBeFalsy();
    const text = own.content.map((c) => c.text).join('\n');
    expect(text).toContain('_bank: ws:a_');
    expect(text).toContain('Standing facts about the kernel');
  });
});