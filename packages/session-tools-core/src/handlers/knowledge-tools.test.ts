/**
 * Knowledge session tools (knowledge_search / knowledge_read / knowledge_get_backlinks) —
 * K-10 §3.1 read capabilities exposed through the canonical SESSION_TOOL_DEFS registry.
 *
 * Tests run the handlers against an in-memory KnowledgeToolRuntime double (registered
 * through the same registry the server-core knowledge RPC layer populates in
 * production), asserting: bounded output caps, provenance (connection id, refs,
 * siyuan:// deep links), ref-string parsing forms, and typed error mapping
 * (CONNECTION_UNAVAILABLE when no runtime/provider is up, KnowledgeError codes
 * surfaced verbatim, raw errors wrapped as PROVIDER_ERROR).
 */
import { afterEach, describe, expect, it } from 'bun:test';
import type {
  ContextPayload,
  KnowledgeNode,
  SearchPage,
} from '@craft-agent/core/knowledge';
import { KnowledgeError } from '@craft-agent/core/knowledge';
import {
  clearKnowledgeToolRuntime,
  getKnowledgeToolRuntime,
  registerKnowledgeToolRuntime,
  type KnowledgeToolRuntime,
} from '../knowledge/runtime.ts';
import {
  handleKnowledgeSearch,
  KNOWLEDGE_SEARCH_MAX_LIMIT,
} from './knowledge-search.ts';
import {
  handleKnowledgeRead,
  KNOWLEDGE_READ_MAX_MARKDOWN_CHARS,
} from './knowledge-read.ts';
import {
  handleKnowledgeGetBacklinks,
  KNOWLEDGE_BACKLINKS_MAX_ITEMS,
} from './knowledge-backlinks.ts';
import {
  SESSION_TOOL_REGISTRY,
  getSessionSafeAllowedToolNames,
  getSessionToolNames,
} from '../tool-defs.ts';
import type { SessionToolContext } from '../context.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CTX = { sessionId: 'sess-1' } as unknown as SessionToolContext;

const DOC_REF = { scheme: 'siyuan', kind: 'document', id: 'doc-1' } as const;

function searchPage(itemCount: number): SearchPage {
  return {
    items: Array.from({ length: itemCount }, (_, i) => ({
      ref: { scheme: 'siyuan', kind: 'document', id: `doc-${i + 1}` },
      title: `Kernel Guide ${i + 1}`,
      snippet: `snippet ${i + 1} about kernels`,
      notebookPath: '/Research',
      updatedAt: 1786000000000,
    })),
    totalEstimate: itemCount,
  };
}

function makeNode(markdown: string): KnowledgeNode {
  return {
    ref: { ...DOC_REF },
    title: 'Kernel Guide',
    markdown,
    path: '/Research/Kernel Guide',
    attributes: [{ key: 'knowledge-topic', value: 'kernel' }],
    createdAt: 1786000000000,
    updatedAt: 1786000001000,
    contentHash: 'hash-1',
    blockCount: 3,
  };
}

function makeContext(backlinkCount: number): ContextPayload {
  return {
    ref: { ...DOC_REF },
    mode: 'snapshot',
    blockId: DOC_REF.id,
    content: '# Kernel Guide',
    children: [{ blockId: 'child-1', content: 'child paragraph' }],
    backlinks: Array.from({ length: backlinkCount }, (_, i) => ({
      ref: { scheme: 'siyuan', kind: 'document', id: `src-${i + 1}` },
      title: `Source Doc ${i + 1}`,
    })),
    attributes: [],
    capturedAt: 1786000002000,
    contentHash: 'hash-1',
  };
}

interface RuntimeRecorder {
  runtime: KnowledgeToolRuntime;
  calls: Array<{ method: string; args: unknown }>;
}

function registerRuntimeDouble(overrides: Partial<KnowledgeToolRuntime> = {}): RuntimeRecorder {
  const calls: RuntimeRecorder['calls'] = [];
  const runtime: KnowledgeToolRuntime = {
    async search(args) {
      calls.push({ method: 'search', args });
      return searchPage(2);
    },
    async read(args) {
      calls.push({ method: 'read', args });
      return { node: makeNode('# Kernel Guide\n\nbody text') };
    },
    async getBacklinks(args) {
      calls.push({ method: 'getBacklinks', args });
      return makeContext(2).backlinks;
    },
    ...overrides,
  };
  registerKnowledgeToolRuntime(runtime);
  return { runtime, calls };
}

afterEach(() => {
  clearKnowledgeToolRuntime();
});

// ---------------------------------------------------------------------------
// Tool registration (parity surface for Claude / Pi / OMP)
// ---------------------------------------------------------------------------

describe('registration', () => {
  it('registers the three knowledge read tools in the canonical registry', () => {
    for (const name of ['knowledge_search', 'knowledge_read', 'knowledge_get_backlinks']) {
      const def = SESSION_TOOL_REGISTRY.get(name);
      expect(def).toBeDefined();
      expect(def!.executionMode).toBe('registry');
      expect(typeof def!.handler).toBe('function');
      expect(def!.safeMode).toBe('allow');
      expect(def!.readOnly).toBe(true);
    }
  });

  it('exposes the tools as safe-mode allowed with the mcp__session__ prefix', () => {
    const names = getSessionToolNames();
    expect(names.has('knowledge_search')).toBe(true);
    expect(names.has('knowledge_read')).toBe(true);
    expect(names.has('knowledge_get_backlinks')).toBe(true);

    const safeAllowed = getSessionSafeAllowedToolNames({ prefix: 'mcp__session__' });
    expect(safeAllowed.has('mcp__session__knowledge_search')).toBe(true);
    expect(safeAllowed.has('mcp__session__knowledge_read')).toBe(true);
    expect(safeAllowed.has('mcp__session__knowledge_get_backlinks')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Runtime registry
// ---------------------------------------------------------------------------

describe('knowledge tool runtime registry', () => {
  it('is empty by default and round-trips a registration', () => {
    expect(getKnowledgeToolRuntime()).toBeNull();
    const { runtime } = registerRuntimeDouble();
    expect(getKnowledgeToolRuntime()).toBe(runtime);
    clearKnowledgeToolRuntime();
    expect(getKnowledgeToolRuntime()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// knowledge_search
// ---------------------------------------------------------------------------

describe('knowledge_search', () => {
  it('returns a typed CONNECTION_UNAVAILABLE error when no runtime is registered', async () => {
    const res = await handleKnowledgeSearch(CTX, { query: 'kernel' });
    expect(res.isError).toBe(true);
    const text = res.content.map((c) => c.text).join('\n');
    expect(text).toContain('CONNECTION_UNAVAILABLE');
  });

  it('formats bounded hits with provenance (connection, ref, deep link)', async () => {
    registerRuntimeDouble();
    const res = await handleKnowledgeSearch(CTX, { query: 'kernel', connectionId: 'conn-9' });
    expect(res.isError).toBeFalsy();
    const text = res.content.map((c) => c.text).join('\n');
    expect(text).toContain('conn-9');
    expect(text).toContain('Kernel Guide 1');
    expect(text).toContain('siyuan/document/doc-1');
    expect(text).toContain('siyuan://blocks/doc-1');
    expect(text).toContain('/Research');
  });

  it('clamps the requested limit to the hard cap before calling the runtime', async () => {
    const { calls } = registerRuntimeDouble();
    await handleKnowledgeSearch(CTX, { query: 'kernel', limit: 5000 });
    const call = calls[0]!;
    expect(call.method).toBe('search');
    const input = (call.args as { input: { limit?: number } }).input;
    expect(input.limit).toBe(KNOWLEDGE_SEARCH_MAX_LIMIT);
  });

  it('truncates overlong snippets instead of passing them through verbatim', async () => {
    const longSnippet = 'x'.repeat(5000);
    registerRuntimeDouble({
      async search() {
        return {
          items: [{
            ref: { scheme: 'siyuan', kind: 'block', id: 'blk-1' },
            title: 'Big Block',
            snippet: longSnippet,
            notebookPath: '/Inbox',
            updatedAt: 1786000000000,
          }],
        };
      },
    });
    const res = await handleKnowledgeSearch(CTX, { query: 'kernel' });
    const text = res.content.map((c) => c.text).join('\n');
    expect(text.length).toBeLessThan(longSnippet.length);
    expect(text).toContain('…');
  });

  it('surfaces KnowledgeError codes verbatim', async () => {
    registerRuntimeDouble({
      async search() {
        throw new KnowledgeError('CONNECTION_UNAVAILABLE', 'SiYuan kernel unreachable');
      },
    });
    const res = await handleKnowledgeSearch(CTX, { query: 'kernel' });
    expect(res.isError).toBe(true);
    const text = res.content.map((c) => c.text).join('\n');
    expect(text).toContain('CONNECTION_UNAVAILABLE');
    expect(text).toContain('SiYuan kernel unreachable');
  });

  it('wraps raw errors as PROVIDER_ERROR (never throws, never hangs)', async () => {
    registerRuntimeDouble({
      async search() {
        throw new Error('socket hangup');
      },
    });
    const res = await handleKnowledgeSearch(CTX, { query: 'kernel' });
    expect(res.isError).toBe(true);
    const text = res.content.map((c) => c.text).join('\n');
    expect(text).toContain('PROVIDER_ERROR');
    expect(text).toContain('socket hangup');
  });

  it('rejects an empty query with a typed validation error', async () => {
    registerRuntimeDouble();
    const res = await handleKnowledgeSearch(CTX, { query: '   ' });
    expect(res.isError).toBe(true);
    const text = res.content.map((c) => c.text).join('\n');
    expect(text).toContain('INVALID_REF');
  });
});

// ---------------------------------------------------------------------------
// knowledge_read
// ---------------------------------------------------------------------------

describe('knowledge_read', () => {
  it('returns a typed CONNECTION_UNAVAILABLE error when no runtime is registered', async () => {
    const res = await handleKnowledgeRead(CTX, { ref: 'document/doc-1' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('CONNECTION_UNAVAILABLE');
  });

  it('reads a node with provenance (title, path, deep link, attributes)', async () => {
    registerRuntimeDouble();
    const res = await handleKnowledgeRead(CTX, { ref: 'document/doc-1' });
    expect(res.isError).toBeFalsy();
    const text = res.content.map((c) => c.text).join('\n');
    expect(text).toContain('Kernel Guide');
    expect(text).toContain('# Kernel Guide');
    expect(text).toContain('/Research/Kernel Guide');
    expect(text).toContain('siyuan://blocks/doc-1');
    expect(text).toContain('knowledge-topic');
  });

  it('accepts mention/deep-link/full/compact ref string forms', async () => {
    const { calls } = registerRuntimeDouble();
    for (const refText of [
      '[knowledge:document/doc-1]',
      '[knowledge:siyuan/document/doc-1]',
      'siyuan://blocks/doc-1',
      'siyuan/document/doc-1',
      'document/doc-1',
    ]) {
      const res = await handleKnowledgeRead(CTX, { ref: refText });
      expect(res.isError).toBeFalsy();
    }
    expect(calls.length).toBe(5);
    for (const call of calls) {
      const args = call.args as { ref: { kind: string; id: string } };
      expect(args.ref.id).toBe('doc-1');
    }
  });

  it('rejects an unparseable ref with INVALID_REF and the accepted forms', async () => {
    registerRuntimeDouble();
    const res = await handleKnowledgeRead(CTX, { ref: 'not-a-ref' });
    expect(res.isError).toBe(true);
    const text = res.content.map((c) => c.text).join('\n');
    expect(text).toContain('INVALID_REF');
    expect(text).toContain('siyuan://');
  });

  it('truncates oversized markdown bodies with a truncation marker', async () => {
    registerRuntimeDouble({
      async read() {
        return { node: makeNode(`# Huge\n\n${'y'.repeat(KNOWLEDGE_READ_MAX_MARKDOWN_CHARS * 2)}`) };
      },
    });
    const res = await handleKnowledgeRead(CTX, { ref: 'document/doc-1' });
    const text = res.content.map((c) => c.text).join('\n');
    expect(text.length).toBeLessThan(KNOWLEDGE_READ_MAX_MARKDOWN_CHARS * 2);
    expect(text.toLowerCase()).toContain('truncat');
  });

  it('passes contextMode through and renders snapshot context (children + backlinks)', async () => {
    const { calls } = registerRuntimeDouble({
      async read(args) {
        calls.push({ method: 'read', args });
        return { node: makeNode('# Kernel Guide'), context: makeContext(1) };
      },
    });
    const res = await handleKnowledgeRead(CTX, { ref: 'document/doc-1', contextMode: 'snapshot' });
    expect(res.isError).toBeFalsy();
    const args = calls[0]!.args as { contextMode?: string };
    expect(args.contextMode).toBe('snapshot');
    const text = res.content.map((c) => c.text).join('\n');
    expect(text).toContain('Source Doc 1');
    expect(text).toContain('child paragraph');
  });
});

// ---------------------------------------------------------------------------
// knowledge_get_backlinks
// ---------------------------------------------------------------------------

describe('knowledge_get_backlinks', () => {
  it('returns a typed CONNECTION_UNAVAILABLE error when no runtime is registered', async () => {
    const res = await handleKnowledgeGetBacklinks(CTX, { ref: 'document/doc-1' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('CONNECTION_UNAVAILABLE');
  });

  it('lists backlinks with refs and deep links', async () => {
    registerRuntimeDouble();
    const res = await handleKnowledgeGetBacklinks(CTX, { ref: 'document/doc-1', connectionId: 'conn-9' });
    expect(res.isError).toBeFalsy();
    const text = res.content.map((c) => c.text).join('\n');
    expect(text).toContain('conn-9');
    expect(text).toContain('Source Doc 1');
    expect(text).toContain('siyuan://blocks/src-1');
  });

  it('caps the backlink list and reports the truncation', async () => {
    registerRuntimeDouble({
      async getBacklinks() {
        return makeContext(KNOWLEDGE_BACKLINKS_MAX_ITEMS + 10).backlinks;
      },
    });
    const res = await handleKnowledgeGetBacklinks(CTX, { ref: 'document/doc-1' });
    const text = res.content.map((c) => c.text).join('\n');
    expect(text).not.toContain(`Source Doc ${KNOWLEDGE_BACKLINKS_MAX_ITEMS + 10}`);
    expect(text.toLowerCase()).toContain('truncat');
  });

  it('reports an honest empty state', async () => {
    registerRuntimeDouble({
      async getBacklinks() {
        return [];
      },
    });
    const res = await handleKnowledgeGetBacklinks(CTX, { ref: 'document/doc-1' });
    expect(res.isError).toBeFalsy();
    expect(res.content[0]!.text.toLowerCase()).toContain('no backlinks');
  });
});
