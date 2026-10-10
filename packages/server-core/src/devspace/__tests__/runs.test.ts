import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DevSpaceRun } from '@rox/shared/dev-space'
import { listDevSpaceRuns, readDevSpaceRun, writeDevSpaceRun } from '../runs.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rox-devspace-runs-'))
  roots.push(root)
  return root
}

function run(overrides: Partial<DevSpaceRun> = {}): DevSpaceRun {
  return {
    schemaVersion: 1,
    id: `devrun_${'a'.repeat(64)}`,
    repositoryId: `repo_${'b'.repeat(64)}`,
    snapshotId: `snapshot_${'c'.repeat(64)}`,
    stages: ['reconcile', 'structural', 'llm', 'publish'],
    status: 'queued',
    progress: { stage: 'reconcile', done: 0, total: 1 },
    startedAt: 1,
    ...overrides,
  }
}

describe('devSpace run journal', () => {
  it('writes and reads a run back byte-for-byte', async () => {
    const root = freshRoot()
    const record = run()
    await writeDevSpaceRun(root, 'demo', record)
    expect(await readDevSpaceRun(root, 'demo', record.id)).toEqual(record)
  })

  it('rejects reads for malformed ids or slugs and returns null for absent journals', async () => {
    const root = freshRoot()
    expect(await readDevSpaceRun(root, 'demo', 'nope')).toBeNull()
    expect(await readDevSpaceRun(root, 'Bad Slug', run().id)).toBeNull()
    expect(await readDevSpaceRun(root, 'demo', run().id)).toBeNull()
  })

  it('returns null for a torn or corrupt journal and skips it when listing', async () => {
    const root = freshRoot()
    const directory = join(root, 'projects', 'demo', 'dev-space', 'runs')
    mkdirSync(directory, { recursive: true })
    const corrupt = `devrun_${'d'.repeat(64)}.json`
    writeFileSync(join(directory, corrupt), '{ not json')
    expect(await readDevSpaceRun(root, 'demo', `devrun_${'d'.repeat(64)}`)).toBeNull()
    expect(await listDevSpaceRuns(root, ['demo'])).toEqual([])
  })

  it('lists runs across projects newest-first and honours the limit', async () => {
    const root = freshRoot()
    await writeDevSpaceRun(root, 'alpha', run({ id: `devrun_${'1'.repeat(64)}`, startedAt: 10 }))
    await writeDevSpaceRun(root, 'alpha', run({ id: `devrun_${'2'.repeat(64)}`, startedAt: 30 }))
    await writeDevSpaceRun(root, 'beta', run({ id: `devrun_${'3'.repeat(64)}`, startedAt: 20 }))
    const all = await listDevSpaceRuns(root, ['alpha', 'beta'])
    expect(all.map(entry => entry.startedAt)).toEqual([30, 20, 10])
    expect((await listDevSpaceRuns(root, ['alpha', 'beta'], 2)).map(entry => entry.startedAt)).toEqual([30, 20])
  })

  it('ignores a project directory that does not exist yet', async () => {
    expect(await listDevSpaceRuns(freshRoot(), ['missing'])).toEqual([])
  })
})