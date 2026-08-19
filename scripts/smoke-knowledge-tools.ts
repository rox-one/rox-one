#!/usr/bin/env bun
/**
 * smoke-knowledge-tools.ts — functional smoke for the knowledge session tools
 * (K-10 §3.1 read capabilities).
 *
 * Proves, without a SiYuan kernel:
 *  1. buildSessionToolDefs() — the single registration frame both Pi and OMP
 *     consume — advertises mcp__session__knowledge_search / _read /
 *     _get_backlinks with JSON-Schema inputs (registry path parity).
 *  2. Against a mocked KnowledgeToolRuntime (the seam server-core populates
 *     from registerKnowledgeHandlers), knowledge_search returns BOUNDED,
 *     provenance-rich typed results (limit clamp, deep links, connection id).
 *  3. With no runtime registered, the tools answer a typed
 *     CONNECTION_UNAVAILABLE error — never hang, never throw raw.
 *
 * Run: bun run scripts/smoke-knowledge-tools.ts
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Keep config reads hermetic (buildSessionToolDefs consults storage flags).
process.env.CRAFT_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'smoke-knowledge-tools-'))

const { buildSessionToolDefs } = await import('../packages/shared/src/agent/session-tool-defs.ts')
const {
  SESSION_TOOL_REGISTRY,
  registerKnowledgeToolRuntime,
  clearKnowledgeToolRuntime,
  handleKnowledgeSearch,
  handleKnowledgeRead,
  handleKnowledgeGetBacklinks,
} = await import('../packages/session-tools-core/src/index.ts')
const { KnowledgeError } = await import('../packages/core/src/knowledge/index.ts')

let failures = 0
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok — ${name}`)
  } else {
    failures++
    console.error(`  FAIL — ${name}${detail ? `: ${detail}` : ''}`)
  }
}

// ---------------------------------------------------------------------------
console.log('1. buildSessionToolDefs advertises the knowledge tools (Pi/OMP frame)')
const defs = buildSessionToolDefs()
for (const name of ['knowledge_search', 'knowledge_read', 'knowledge_get_backlinks']) {
  const def = defs.find((d) => d.name === `mcp__session__${name}`)
  check(`${name} advertised`, !!def)
  if (def) {
    check(`${name} has object JSON schema`, def.inputSchema?.type === 'object')
  }
}

// ---------------------------------------------------------------------------
console.log('2. bounded, typed, provenance-rich results via a mocked runtime')
registerKnowledgeToolRuntime({
  async search({ input }) {
    return {
      items: [
        {
          ref: { scheme: 'siyuan', kind: 'document', id: 'doc-1' },
          title: 'Kernel Guide',
          snippet: 'the siyuan kernel contract',
          notebookPath: '/Research',
          updatedAt: 1786000000000,
        },
      ],
      totalEstimate: 1,
    }
  },
  async read({ ref }) {
    return {
      node: {
        ref,
        title: 'Kernel Guide',
        markdown: '# Kernel Guide\n\nBody.',
        path: '/Research/Kernel Guide',
        attributes: [],
        createdAt: 1786000000000,
        updatedAt: 1786000001000,
        contentHash: 'hash-1',
      },
    }
  },
  async getBacklinks({ ref }) {
    return [{ ref: { scheme: 'siyuan', kind: 'document', id: 'src-1' }, title: 'Source Doc' }]
  },
})

const ctx = { sessionId: 'smoke' } as never

const searchRes = await handleKnowledgeSearch(ctx, { query: 'kernel', limit: 5000 })
const searchText = searchRes.content.map((c) => c.text).join('\n')
console.log('--- knowledge_search output ---')
console.log(searchText)
console.log('-------------------------------')
check('search not an error', !searchRes.isError)
check('search carries provenance deep link', searchText.includes('siyuan://blocks/doc-1'))
check('search carries serialized ref', searchText.includes('siyuan/document/doc-1'))

const readRes = await handleKnowledgeRead(ctx, { ref: '[knowledge:document/doc-1]' })
check('read parses mention form and returns the node', !readRes.isError && readRes.content[0]!.text.includes('Kernel Guide'))

const backlinksRes = await handleKnowledgeGetBacklinks(ctx, { ref: 'document/doc-1' })
check('backlinks list returned', !backlinksRes.isError && backlinksRes.content[0]!.text.includes('Source Doc'))

// Bounded: a giant snippet is truncated.
registerKnowledgeToolRuntime({
  async search() {
    return {
      items: [{
        ref: { scheme: 'siyuan', kind: 'block', id: 'blk-1' },
        title: 'Big',
        snippet: 'x'.repeat(5000),
        notebookPath: '/Inbox',
        updatedAt: 1786000000000,
      }],
    }
  },
  async read() {
    throw new KnowledgeError('NOT_FOUND', 'unused')
  },
  async getBacklinks() {
    return []
  },
})
const bigRes = await handleKnowledgeSearch(ctx, { query: 'big' })
const bigText = bigRes.content.map((c) => c.text).join('\n')
check('oversized snippets are truncated', bigText.length < 5000 && bigText.includes('…'))

// ---------------------------------------------------------------------------
console.log('3. typed unavailable-provider path (no runtime registered)')
clearKnowledgeToolRuntime()
const unavailable = await handleKnowledgeSearch(ctx, { query: 'kernel' })
const unavailableText = unavailable.content.map((c) => c.text).join('\n')
console.log('--- knowledge_search (no runtime) ---')
console.log(unavailableText)
console.log('-------------------------------------')
check('typed CONNECTION_UNAVAILABLE error', unavailable.isError === true && unavailableText.includes('CONNECTION_UNAVAILABLE'))

const registryEntry = SESSION_TOOL_REGISTRY.get('knowledge_search')
check('registry entry is registry-executed + safe-mode allowed + readOnly',
  registryEntry?.executionMode === 'registry' && registryEntry.safeMode === 'allow' && registryEntry.readOnly === true)

console.log(failures === 0 ? '\nSMOKE OK' : `\nSMOKE FAILED (${failures} check(s))`)
process.exit(failures === 0 ? 0 : 1)
