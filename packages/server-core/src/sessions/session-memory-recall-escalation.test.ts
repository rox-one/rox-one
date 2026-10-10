// Isolation first: guarantees a temp CONFIG_DIR even when this file is run
// directly from the package dir (root preload only covers repo-root runs).
import './__test-config-isolation'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager } from './SessionManager.ts'
import { MemoryFileStore } from '../memory/MemoryFileStore'
import { resetMemoryIndexServiceCache } from '../memory/MemoryIndexService'

// c1.5 lane two must be reachable through the PRODUCTION construction path.
// SessionManager.memoryServiceFor builds the workspace MemoryService, and it
// previously passed no `recallAgent`, so MemoryService.assembleRecall returned
// early at `!this.deps.recallAgent` and lane two could never fire in production.
//
// This test drives that exact path (memoryServiceFor → buildMemoryBlocks) with
// ONLY the one-shot mini-model runner stubbed (the same runner the distiller
// uses). The recall lane code itself runs for real: lane one finds no strong
// hit, the auto-mode decision requires recall intent, and the reply is parsed
// and validated against the ids the sub-agent was actually offered.

interface RecallBlocks {
  recall?: { lane: number; refs: Array<{ chunkId: string }> }
}

/** Test-only view of SessionManager's private memory seams. */
interface TestSeams {
  memoryServices: Map<string, { stop(): void }>
  runMemoryDistillOneShot: (workspace: unknown, prompt: string) => Promise<string>
  memoryServiceFor(workspace: unknown): { buildMemoryBlocks(opts?: { query?: string }): Promise<RecallBlocks | undefined> } | null
}

describe('c1.5 recall escalation wired through SessionManager (production path)', () => {
  let tmpRoot: string
  let sm: SessionManager
  let seams: TestSeams

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-mem-recall-'))
    sm = new SessionManager()
    seams = sm as unknown as TestSeams
  })

  afterEach(() => {
    for (const svc of seams.memoryServices.values()) svc.stop()
    resetMemoryIndexServiceCache()
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildWorkspace() {
    return { id: 'ws_recall', name: 'Recall WS', rootPath: tmpRoot, createdAt: Date.now() } as never
  }

  /** Stub the shared one-shot runner; records each prompt and answers with the first offered id. */
  function stubOneShot(): string[] {
    const prompts: string[] = []
    seams.runMemoryDistillOneShot = async (_workspace, prompt) => {
      prompts.push(prompt)
      const match = prompt.match(/id=(\w+)/)
      if (!match?.[1]) throw new Error('recall agent got no candidate ids')
      return JSON.stringify({ ids: [match[1]] })
    }
    return prompts
  }

  it('escalates exactly once on recall intent, validating the reply against the offered ids', async () => {
    new MemoryFileStore('workspace', tmpRoot).writeContext('Deploy previews run through the vercel pipeline.')
    const prompts = stubOneShot()

    const svc = seams.memoryServiceFor(buildWorkspace())
    expect(svc).not.toBeNull()
    const blocks = await svc!.buildMemoryBlocks({ query: 'what did we decide about the vercel pipeline' })

    // Lane one is inconclusive here (weak lexical overlap), the message shows
    // recall intent, so auto mode escalates — this is the assertion that fails
    // when the production service is built without a recallAgent.
    expect(blocks?.recall?.lane).toBe(2)
    expect(prompts.length).toBe(1)

    const offered = new Set([...prompts[0]!.matchAll(/id=(\w+)/g)].map((m) => m[1]!))
    expect(offered.size).toBeGreaterThan(0)
    const refs = blocks?.recall?.refs ?? []
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) expect(offered.has(ref.chunkId)).toBe(true)
  }, 30000)

  it('does not escalate without recall intent (recallMode left at its auto default)', async () => {
    new MemoryFileStore('workspace', tmpRoot).writeContext('Deploy previews run through the vercel pipeline.')
    const prompts = stubOneShot()

    const blocks = await seams.memoryServiceFor(buildWorkspace())!.buildMemoryBlocks({ query: 'zebra unrelated weather question' })
    expect(blocks?.recall).toBeUndefined()
    expect(prompts.length).toBe(0)
  }, 30000)
})