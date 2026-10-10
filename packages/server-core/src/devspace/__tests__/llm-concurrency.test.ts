import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DevSpaceRepositoryRecord } from '@rox/shared/dev-space'
import { readDevSpaceManifest, writeDevSpaceConsent } from '../artifacts.ts'
import { clearDevSpaceStages } from '../runner.ts'
import { runLlmStage, type LlmAdapter } from '../stages/llm.ts'

const roots: string[] = []
afterEach(() => {
  clearDevSpaceStages()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function freshRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `rox-devspace-llm-conc-${prefix}-`))
  roots.push(root)
  return root
}

const repositoryId = `repo_${'b'.repeat(64)}`
const snapshotId = `snapshot_${'c'.repeat(64)}`
const runId = `devrun_${'a'.repeat(64)}`

function record(cwd: string): DevSpaceRepositoryRecord {
  return {
    schemaVersion: 1, id: `devrepo_${'e'.repeat(64)}`, repositoryId, workspaceId: 'ws', projectId: 'proj', projectSlug: 'demo',
    origin: { kind: 'local-folder', path: cwd }, displayName: 'demo', status: 'bound', createdAt: 1, updatedAt: 2,
  }
}

function stageContext(root: string, cwd: string) {
  return {
    runId, repositoryId, snapshotId, workspaceId: 'ws', projectSlug: 'demo', root,
    record: record(cwd), signal: new AbortController().signal, report: () => {},
  }
}

async function grantConsent(root: string): Promise<void> {
  await writeDevSpaceConsent(root, 'demo', {
    schemaVersion: 1, repositoryId, items: { modelConnectors: true, cveNetwork: false, toolUpdates: false }, grantedAt: 1, updatedAt: 1,
  })
}

/** Microtask barrier: resolve the N-th adapter start without any wall-clock timer. */
function startBarrier(): { signal: () => void; when: (at: number) => Promise<void> } {
  let count = 0
  const waiters: Array<{ at: number; resolve: () => void }> = []
  return {
    signal: () => {
      count += 1
      for (const waiter of [...waiters]) {
        if (count >= waiter.at) {
          waiters.splice(waiters.indexOf(waiter), 1)
          waiter.resolve()
        }
      }
    },
    when: (at: number) => {
      if (count >= at) return Promise.resolve()
      const { promise, resolve } = Promise.withResolvers<void>()
      waiters.push({ at, resolve })
      return promise
    },
  }
}

describe('O10 bounded LLM concurrency', () => {
  it('runs at most two adapters at once and merges artifacts in adapter order', async () => {
    const root = freshRoot('root')
    const cwd = freshRoot('cwd')
    mkdirSync(join(cwd, 'src'), { recursive: true })
    writeFileSync(join(cwd, 'src', 'app.ts'), 'export const ok = true\n')
    await grantConsent(root)

    const gates = Array.from({ length: 4 }, () => Promise.withResolvers<void>())
    const starts = startBarrier()
    let active = 0
    let maxActive = 0
    const started: number[] = []
    const adapters: LlmAdapter[] = gates.map((gate, index) => ({
      id: `fake-${index}`,
      kind: 'wiki',
      version: '0',
      detect: async () => ({ available: true }),
      generate: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        started.push(index)
        starts.signal()
        await gate.promise
        active -= 1
        return { status: 'ok', artifacts: [{ name: `a${index}.md`, format: 'md' as const, content: `# ${index}` }] }
      },
    }))

    const run = runLlmStage(adapters, stageContext(root, cwd))

    await starts.when(2)
    expect(started).toEqual([0, 1])
    expect(maxActive).toBe(2)

    // Finish the *second* adapter first: merged order must still follow the adapter list.
    gates[1]!.resolve()
    await starts.when(3)
    expect(maxActive).toBe(2)

    gates[0]!.resolve()
    await starts.when(4)
    expect(maxActive).toBe(2)

    gates[2]!.resolve()
    gates[3]!.resolve()
    const outcome = await run
    expect(outcome.partial).toBe(false)
    expect(outcome.artifacts).toHaveLength(4)

    const manifest = await readDevSpaceManifest(root, 'demo')
    expect(manifest?.entries.map(entry => entry.path)).toEqual([
      'wiki/a0.md', 'wiki/a1.md', 'wiki/a2.md', 'wiki/a3.md',
    ])
  })

  it('keeps a failed adapter partial without blocking its neighbours', async () => {
    const root = freshRoot('root2')
    const cwd = freshRoot('cwd2')
    writeFileSync(join(cwd, 'app.ts'), 'export const ok = true\n')
    await grantConsent(root)

    const okAdapter: LlmAdapter = {
      id: 'fake-ok', kind: 'wiki', version: '0',
      detect: async () => ({ available: true }),
      generate: async () => ({ status: 'ok', artifacts: [{ name: 'ok.md', format: 'md', content: '# ok' }] }),
    }
    const failing: LlmAdapter = {
      id: 'fake-fail', kind: 'understanding', version: '0',
      detect: async () => ({ available: true }),
      generate: async () => ({ status: 'error', detail: 'boom' }),
    }

    const outcome = await runLlmStage([failing, okAdapter], stageContext(root, cwd))
    expect(outcome.partial).toBe(true)
    expect(outcome.artifacts).toHaveLength(1)
    const manifest = await readDevSpaceManifest(root, 'demo')
    expect(manifest?.entries.map(entry => entry.path)).toEqual(['wiki/ok.md'])
  })
})