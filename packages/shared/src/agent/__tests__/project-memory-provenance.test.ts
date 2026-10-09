/**
 * Provenance gate over the project-memory injection path (spec c1.2).
 *
 * `resolveProjectContext` reads `projects/<slug>/MEMORY.md` directly (outside
 * the chunk index), so the write-time provenance override sidecar must also
 * gate it: an `untrusted` stamp keeps the document out of the project-memory
 * prompt block on every backend. All three backends (claude / omp / pi) share
 * `isProjectMemoryInjectable`, which is what these tests exercise — plus a real
 * `OmpAgent.resolveProjectContext` call to prove the path, not just the helper.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BackendConfig } from '../backend/types.ts'
import type { ProjectPromptContext } from '../../projects/types.ts'
import { isMemoryDocumentInjectable, isProjectMemoryInjectable } from '../../memory/document-provenance.ts'
import { OmpAgent } from '../omp-agent.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const PROJECT_ID = 'proj-1'

function makeWorkspace(): { root: string; slug: string } {
  const root = mkdtempSync(join(tmpdir(), 'rox-projmem-'))
  roots.push(root)
  const slug = 'demo'
  mkdirSync(join(root, 'projects', slug, 'assets'), { recursive: true })
  writeFileSync(
    join(root, 'projects', slug, 'config.json'),
    JSON.stringify({ id: PROJECT_ID, slug, name: 'Demo', createdAt: 0, updatedAt: 0 }),
  )
  writeFileSync(join(root, 'projects', slug, 'MEMORY.md'), 'Deploy previews go through vercel.')
  return { root, slug }
}

function stampUntrusted(root: string, slug: string): void {
  mkdirSync(join(root, 'memory'), { recursive: true })
  writeFileSync(
    join(root, 'memory', 'index-provenance.json'),
    JSON.stringify({
      [`projects/${slug}/MEMORY.md`]: { originClass: 'untrusted', sessionKind: 'unknown', observedAt: '2026-01-01T00:00:00.000Z' },
    }),
  )
}

/** Real agent path: OmpAgent is headless (no spawn) and only resolveProjectContext is read. */
function resolveProjectMemory(root: string): string | undefined {
  const config = {
    provider: 'omp',
    workspace: { id: 'ws', name: 'Test', rootPath: root },
    session: { id: 'session-test', workspaceRootPath: root, createdAt: 0, lastUsedAt: 0, projectId: PROJECT_ID },
    isHeadless: true,
  } as unknown as BackendConfig
  const agent = new OmpAgent(config)
  // TS `private` is erased at runtime; this is the only way to exercise the
  // injection decision without spawning the backend.
  const seam = agent as unknown as { resolveProjectContext(): ProjectPromptContext | null }
  try {
    return seam.resolveProjectContext()?.memoryContent
  } finally {
    agent.dispose()
  }
}

describe('project MEMORY.md provenance gate (c1.2)', () => {
  it('injects a trusted project memory document through the agent path', () => {
    const { root } = makeWorkspace()
    expect(resolveProjectMemory(root)).toContain('Deploy previews go through vercel.')
  })

  it('drops a document stamped untrusted from the agent path', () => {
    const { root, slug } = makeWorkspace()
    stampUntrusted(root, slug)
    expect(resolveProjectMemory(root)).toBeUndefined()
  })

  it('allows a trusted (unlisted) project memory document', () => {
    const { root, slug } = makeWorkspace()
    expect(isProjectMemoryInjectable(root, slug, undefined)).toBe(true)
  })

  it('drops a document stamped untrusted from the shared gate', () => {
    const { root, slug } = makeWorkspace()
    stampUntrusted(root, slug)
    expect(isProjectMemoryInjectable(root, slug, undefined)).toBe(false)
  })

  it('honours memoryScope "none" regardless of provenance', () => {
    const { root, slug } = makeWorkspace()
    expect(isProjectMemoryInjectable(root, slug, 'none')).toBe(false)
  })

  it('fail-open: an unknown document is still injectable', () => {
    const { root } = makeWorkspace()
    expect(isMemoryDocumentInjectable(root, 'projects/demo/MEMORY.md')).toBe(true)
    expect(isMemoryDocumentInjectable(root, 'projects/demo/MEMORY.md', {})).toBe(true)
  })

  it('resolves the override independent of path separators', () => {
    const { root, slug } = makeWorkspace()
    stampUntrusted(root, slug)
    expect(isMemoryDocumentInjectable(root, `projects/${slug}/MEMORY.md`)).toBe(false)
    expect(isMemoryDocumentInjectable(root, `projects\\${slug}\\MEMORY.md`)).toBe(false)
  })
})