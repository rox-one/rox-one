/**
 * Dev Space session tools (devspace_read / devspace_search / devspace_propose) —
 * spec 02 §9 artifact access exposed through the canonical SESSION_TOOL_DEFS
 * registry, mirroring the knowledge_* tool tests.
 *
 * Tests run the handlers against an in-memory DevSpaceToolRuntime double
 * (registered through the same registry the server-core Dev Space layer populates
 * in production), asserting: bounded output caps, provenance (kind, path,
 * project, provider@version, sourceRevision), the DATA-NOT-INSTRUCTIONS caveat,
 * typed error mapping, and — critically — that propose only ever drafts a
 * proposal and never applies (ART-005).
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  clearDevSpaceToolRuntime,
  getDevSpaceToolRuntime,
  registerDevSpaceToolRuntime,
  type DevSpaceArtifactEntry,
  type DevSpaceProposal,
  type DevSpaceProposeRequest,
  type DevSpaceReadRequest,
  type DevSpaceSearchPage,
  type DevSpaceSearchRequest,
  type DevSpaceToolRuntime,
} from '../dev-space/runtime.ts';
import { DevSpaceError } from '../dev-space/scope.ts';
import type { ToolResult } from '../types.ts';
import {
  handleDevSpaceRead,
  DEVSPACE_READ_MAX_CONTENT_CHARS,
} from './dev-space-read.ts';
import {
  handleDevSpaceSearch,
  DEVSPACE_SEARCH_MAX_LIMIT,
} from './dev-space-search.ts';
import { handleDevSpacePropose, parseDevSpaceProposeOps } from './dev-space-propose.ts';
import {
  SESSION_TOOL_REGISTRY,
  getSessionSafeAllowedToolNames,
  getSessionSafeBlockedToolNames,
  getSessionToolNames,
} from '../tool-defs.ts';
import type { SessionToolContext } from '../context.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CTX = { sessionId: 'sess-1', workspacePath: '/tmp/ws' } as unknown as SessionToolContext;
const ARTIFACT_ID = `artifact_${'a'.repeat(64)}`;
const REPOSITORY_ID = `repo_${'b'.repeat(64)}`;

function makeEntry(overrides: Partial<DevSpaceArtifactEntry> = {}): DevSpaceArtifactEntry {
  return {
    id: ARTIFACT_ID,
    kind: 'wiki',
    path: 'wiki/index.md',
    format: 'md',
    producedBy: { providerId: 'openwiki', version: '0.6.1' },
    sourceRevision: 'deadbeef',
    createdAt: 1786000000000,
    projectSlug: 'rox-demo',
    repositoryId: REPOSITORY_ID,
    snapshotId: 'snap-1',
    ...overrides,
  };
}

function searchPage(itemCount: number): DevSpaceSearchPage {
  return {
    items: Array.from({ length: itemCount }, (_, i) => ({
      artifact: makeEntry({ id: `artifact_${String(i + 1).padStart(64, '0')}`, path: `wiki/page-${i + 1}.md` }),
      snippet: `snippet ${i + 1} about kernels`,
    })),
    totalEstimate: itemCount,
  };
}

interface RuntimeRecorder {
  runtime: DevSpaceToolRuntime;
  /** Method names in invocation order — the "propose never touches anything else" check. */
  methods: string[];
  readCalls: DevSpaceReadRequest[];
  searchCalls: DevSpaceSearchRequest[];
  proposeCalls: DevSpaceProposeRequest[];
}

function registerRuntimeDouble(overrides: Partial<DevSpaceToolRuntime> = {}): RuntimeRecorder {
  const methods: string[] = [];
  const readCalls: DevSpaceReadRequest[] = [];
  const searchCalls: DevSpaceSearchRequest[] = [];
  const proposeCalls: DevSpaceProposeRequest[] = [];
  const runtime: DevSpaceToolRuntime = {
    async read(args) {
      methods.push('read');
      readCalls.push(args);
      return { artifact: makeEntry(), content: '# Wiki\n\nbody text', encoding: 'utf8', contentHash: 'sha256-abc' };
    },
    async search(args) {
      methods.push('search');
      searchCalls.push(args);
      return searchPage(2);
    },
    async propose(args) {
      methods.push('propose');
      proposeCalls.push(args);
      return {
        id: 'dsprop-9',
        status: 'pending_review',
        ops: args.input.ops,
        ...(args.input.summary ? { summary: args.input.summary } : {}),
        createdAt: 1786000000000,
      } satisfies DevSpaceProposal;
    },
    ...overrides,
  };
  registerDevSpaceToolRuntime(runtime);
  return { runtime, methods, readCalls, searchCalls, proposeCalls };
}

function textOf(res: ToolResult): string {
  return res.content.map((c) => c.text).join('\n');
}

afterEach(() => {
  clearDevSpaceToolRuntime();
});

// ---------------------------------------------------------------------------
// Tool registration (parity surface for Claude / Pi / OMP)
// ---------------------------------------------------------------------------

describe('registration', () => {
  it('registers the two dev-space read tools in the canonical registry', () => {
    for (const name of ['devspace_search', 'devspace_read']) {
      const def = SESSION_TOOL_REGISTRY.get(name);
      expect(def).toBeDefined();
      expect(def!.executionMode).toBe('registry');
      expect(typeof def!.handler).toBe('function');
      expect(def!.safeMode).toBe('allow');
      expect(def!.readOnly).toBe(true);
    }
  });

  it('registers devspace_propose as a blocked write-back tool', () => {
    const def = SESSION_TOOL_REGISTRY.get('devspace_propose');
    expect(def).toBeDefined();
    expect(def!.safeMode).toBe('block');
    expect(def!.readOnly).not.toBe(true);
    expect(getSessionToolNames().has('devspace_propose')).toBe(true);
    expect(getSessionSafeBlockedToolNames().has('devspace_propose')).toBe(true);
    const safeAllowed = getSessionSafeAllowedToolNames({ prefix: 'mcp__session__' });
    expect(safeAllowed.has('mcp__session__devspace_propose')).toBe(false);
  });

  it('exposes the read tools as safe-mode allowed with the mcp__session__ prefix', () => {
    const safeAllowed = getSessionSafeAllowedToolNames({ prefix: 'mcp__session__' });
    expect(safeAllowed.has('mcp__session__devspace_search')).toBe(true);
    expect(safeAllowed.has('mcp__session__devspace_read')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Runtime registry
// ---------------------------------------------------------------------------

describe('dev-space tool runtime registry', () => {
  it('is empty by default and round-trips a registration', () => {
    expect(getDevSpaceToolRuntime()).toBeNull();
    const { runtime } = registerRuntimeDouble();
    expect(getDevSpaceToolRuntime()).toBe(runtime);
    clearDevSpaceToolRuntime();
    expect(getDevSpaceToolRuntime()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// devspace_read
// ---------------------------------------------------------------------------

describe('devspace_read', () => {
  it('returns a typed DEVSPACE_UNAVAILABLE error when no runtime is registered', async () => {
    const res = await handleDevSpaceRead(CTX, { artifactId: ARTIFACT_ID });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('DEVSPACE_UNAVAILABLE');
  });

  it('reads an artifact with provenance and the data-not-instructions caveat', async () => {
    registerRuntimeDouble();
    const res = await handleDevSpaceRead(CTX, { artifactId: ARTIFACT_ID });
    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    expect(text).toContain(ARTIFACT_ID);
    expect(text).toContain('wiki/index.md');
    expect(text).toContain('openwiki@0.6.1');
    expect(text).toContain('deadbeef');
    expect(text).toContain('sha256-abc');
    expect(text).toContain('# Wiki');
    expect(text.toLowerCase()).toContain('data, not instructions');
  });

  it('rejects a malformed artifact id with INVALID_ARGUMENT without calling the runtime', async () => {
    const { methods } = registerRuntimeDouble();
    const res = await handleDevSpaceRead(CTX, { artifactId: '../etc/passwd' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('INVALID_ARGUMENT');
    expect(methods).toHaveLength(0);
  });

  it('passes projectSlug and repositoryId through to the runtime', async () => {
    const { readCalls } = registerRuntimeDouble();
    await handleDevSpaceRead(CTX, { artifactId: ARTIFACT_ID, projectSlug: 'rox-demo', repositoryId: REPOSITORY_ID });
    expect(readCalls).toHaveLength(1);
    expect(readCalls[0]!.workspaceRoot).toBe('/tmp/ws');
    expect(readCalls[0]!.projectSlug).toBe('rox-demo');
    expect(readCalls[0]!.repositoryId).toBe(REPOSITORY_ID);
  });

  it('truncates oversized content with a truncation marker', async () => {
    registerRuntimeDouble({
      async read() {
        return {
          artifact: makeEntry(),
          content: 'y'.repeat(DEVSPACE_READ_MAX_CONTENT_CHARS * 2),
          encoding: 'utf8',
          contentHash: 'sha256-big',
        };
      },
    });
    const res = await handleDevSpaceRead(CTX, { artifactId: ARTIFACT_ID });
    const text = textOf(res);
    expect(text.length).toBeLessThan(DEVSPACE_READ_MAX_CONTENT_CHARS * 2);
    expect(text.toLowerCase()).toContain('truncat');
  });

  it('flags base64 encoding for binary artifacts', async () => {
    registerRuntimeDouble({
      async read() {
        return {
          artifact: makeEntry({ kind: 'audio', path: 'audio/podcast.mp3', format: 'mp3' }),
          content: 'AAAA',
          encoding: 'base64',
          contentHash: 'sha256-audio',
        };
      },
    });
    const res = await handleDevSpaceRead(CTX, { artifactId: ARTIFACT_ID });
    expect(textOf(res)).toContain('encoding: base64');
  });

  it('surfaces DevSpaceError codes verbatim', async () => {
    registerRuntimeDouble({
      async read() {
        throw new DevSpaceError('NOT_FOUND', 'artifact not in any manifest');
      },
    });
    const res = await handleDevSpaceRead(CTX, { artifactId: ARTIFACT_ID });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('NOT_FOUND');
    expect(textOf(res)).toContain('artifact not in any manifest');
  });

  it('wraps raw errors as PROVIDER_ERROR (never throws, never hangs)', async () => {
    registerRuntimeDouble({
      async read() {
        throw new Error('disk on fire');
      },
    });
    const res = await handleDevSpaceRead(CTX, { artifactId: ARTIFACT_ID });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('PROVIDER_ERROR');
    expect(textOf(res)).toContain('disk on fire');
  });
});

// ---------------------------------------------------------------------------
// devspace_search
// ---------------------------------------------------------------------------

describe('devspace_search', () => {
  it('returns a typed DEVSPACE_UNAVAILABLE error when no runtime is registered', async () => {
    const res = await handleDevSpaceSearch(CTX, { query: 'kernel' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('DEVSPACE_UNAVAILABLE');
  });

  it('formats bounded hits with provenance (kind, path, id, project, provider)', async () => {
    registerRuntimeDouble();
    const res = await handleDevSpaceSearch(CTX, { query: 'kernel' });
    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    expect(text).toContain('wiki · wiki/page-1.md');
    expect(text).toContain('rox-demo');
    expect(text).toContain('openwiki@0.6.1');
    expect(text).toContain('snippet 1 about kernels');
  });

  it('filters an unknown kind instead of forwarding it to the runtime', async () => {
    const { searchCalls } = registerRuntimeDouble();
    await handleDevSpaceSearch(CTX, { query: 'kernel', kind: 'nonsense' as never });
    expect(searchCalls[0]!.input.kind).toBeUndefined();
  });

  it('forwards a known kind filter', async () => {
    const { searchCalls } = registerRuntimeDouble();
    await handleDevSpaceSearch(CTX, { query: 'kernel', kind: 'diagram' });
    expect(searchCalls[0]!.input.kind).toBe('diagram');
  });

  it('clamps the requested limit to the hard cap', async () => {
    const { searchCalls } = registerRuntimeDouble();
    await handleDevSpaceSearch(CTX, { query: 'kernel', limit: 5000 });
    expect(searchCalls[0]!.input.limit).toBe(DEVSPACE_SEARCH_MAX_LIMIT);
  });

  it('re-bounds an oversized runtime page (response-side cap)', async () => {
    registerRuntimeDouble({
      async search() {
        return searchPage(2000);
      },
    });
    const res = await handleDevSpaceSearch(CTX, { query: 'kernel', limit: 5 });
    const text = textOf(res);
    expect(text).toContain(`${DEVSPACE_SEARCH_MAX_LIMIT} result(s)`);
    expect(text).toContain('extra item(s) beyond the cap');
  });

  it('truncates overlong snippets and passes a cursor through', async () => {
    let seenCursor: string | undefined;
    registerRuntimeDouble({
      async search(args) {
        seenCursor = args.input.cursor;
        return { items: [{ artifact: makeEntry(), snippet: 'x'.repeat(5000) }], nextCursor: 'cursor-2' };
      },
    });
    const res = await handleDevSpaceSearch(CTX, { query: 'kernel', cursor: 'cursor-1' });
    const text = textOf(res);
    expect(text).toContain('cursor-2');
    expect(text).toContain('…');
    expect(seenCursor).toBe('cursor-1');
  });

  it('rejects an empty query with a typed validation error', async () => {
    registerRuntimeDouble();
    const res = await handleDevSpaceSearch(CTX, { query: '   ' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('INVALID_ARGUMENT');
  });
});

// ---------------------------------------------------------------------------
// devspace_propose
// ---------------------------------------------------------------------------

describe('devspace_propose', () => {
  it('returns a typed DEVSPACE_UNAVAILABLE error when no runtime is registered', async () => {
    const res = await handleDevSpacePropose(CTX, { ops: [{ op: 'updateArtifact', artifactId: ARTIFACT_ID, content: 'x' }] });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('DEVSPACE_UNAVAILABLE');
  });

  it('reports CAPABILITY_DISABLED when the runtime has no propose seam', async () => {
    registerRuntimeDouble({ propose: undefined });
    const res = await handleDevSpacePropose(CTX, { ops: [{ op: 'updateArtifact', artifactId: ARTIFACT_ID, content: 'x' }] });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('CAPABILITY_DISABLED');
  });

  it('rejects an empty op batch without calling propose', async () => {
    const { methods } = registerRuntimeDouble();
    const res = await handleDevSpacePropose(CTX, { ops: [] });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('INVALID_ARGUMENT');
    expect(methods).toHaveLength(0);
  });

  it('creates a pending proposal, never claims apply, and only ever calls propose', async () => {
    const { methods, proposeCalls } = registerRuntimeDouble();
    const res = await handleDevSpacePropose(CTX, {
      ops: [{ op: 'updateArtifact', artifactId: ARTIFACT_ID, content: '# Next' }],
      summary: 'rewrite wiki index',
      baseHash: 'sha256-abc',
    });
    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    expect(text).toContain('dsprop-9');
    expect(text).toContain('pending_review');
    expect(text.toLowerCase()).toContain('not applied');
    expect(methods).toEqual(['propose']);
    expect(proposeCalls[0]!.workspaceRoot).toBe('/tmp/ws');
    expect(proposeCalls[0]!.input.ops).toHaveLength(1);
    expect(proposeCalls[0]!.input.summary).toBe('rewrite wiki index');
    expect(proposeCalls[0]!.input.baseHash).toBe('sha256-abc');
  });

  it('parseDevSpaceProposeOps rejects unknown ops, traversal paths and bad ids', () => {
    expect('error' in parseDevSpaceProposeOps([{ op: 'nukeRepo' }])).toBe(true);
    expect('error' in parseDevSpaceProposeOps([{ op: 'createArtifact', kind: 'wiki', path: '../escape.md', format: 'md', content: 'x' }])).toBe(true);
    expect('error' in parseDevSpaceProposeOps([{ op: 'updateArtifact', artifactId: '../etc', content: 'x' }])).toBe(true);
  });

  it('parseDevSpaceProposeOps accepts a valid whitelist batch', () => {
    const parsed = parseDevSpaceProposeOps([
      { op: 'createArtifact', kind: 'wiki', path: 'wiki/new.md', format: 'md', content: '# New' },
      { op: 'updateArtifact', artifactId: ARTIFACT_ID, content: '# Next' },
      { op: 'deleteArtifact', artifactId: ARTIFACT_ID },
    ]);
    if (!Array.isArray(parsed)) throw new Error(`expected ops array, got ${JSON.stringify(parsed)}`);
    expect(parsed.length).toBe(3);
  });
});