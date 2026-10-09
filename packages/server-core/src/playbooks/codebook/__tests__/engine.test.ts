import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { CodebookCell } from '@rox/shared/playbooks'
import { CodebookRunError } from '@rox/shared/playbooks'
import {
  runCodebook, type CodebookEngineInput, type CodebookProcessInput, type CodebookProgress,
} from '../engine.ts'

const SCRIPT: CodebookCell = { id: 'c1', kind: 'script', command: 'echo', args: ['hi'] }

function fixture(cells: readonly CodebookCell[], overrides: Partial<CodebookEngineInput> = {}) {
  const progress: CodebookProgress[] = []
  const input: CodebookEngineInput = {
    root: '/tmp/root', workspaceId: 'ws', projectSlug: 'demo', notebookId: 'nb1', runId: 'codebookrun_0123456789abcdef',
    cells, signal: new AbortController().signal, onProgress: entry => progress.push(entry), ...overrides,
  }
  return { input, progress }
}

function codeOf(error: unknown): string | undefined {
  return error instanceof CodebookRunError ? error.code : undefined
}

describe('codebook engine', () => {
  it('executes cells strictly in order and reports progress to done', async () => {
    const order: string[] = []
    const cwds: string[] = []
    const runner = async (procInput: CodebookProcessInput) => {
      order.push(procInput.command)
      cwds.push(procInput.cwd)
      return { code: 0, stdout: `out-${procInput.command}`, stderr: '' }
    }
    const cells: CodebookCell[] = [
      { id: 'a', kind: 'script', command: 'first' },
      { id: 'b', kind: 'script', command: 'second' },
    ]
    const { input, progress } = fixture(cells, { workingDirectory: '/repo/checkout' })
    const run = await runCodebook(input, { run: runner })
    expect(order).toEqual(['first', 'second'])
    // A script cell defaults to the repository working directory (isolation, §6.4).
    expect(cwds).toEqual(['/repo/checkout', '/repo/checkout'])
    expect(run.status).toBe('succeeded')
    expect(run.steps.map(step => step.status)).toEqual(['succeeded', 'succeeded'])
    expect(run.steps[0]!.output?.text).toBe('out-first')
    expect(progress[0]!.state).toBe('running')
    expect(progress.at(-1)!.state).toBe('done')
    expect(progress.at(-1)!.doneSteps).toBe(2)
  })

  it('cancels mid-run and never reports success', async () => {
    const controller = new AbortController()
    const run = await runCodebook(fixture([SCRIPT], { signal: controller.signal }).input, {
      run: async () => { controller.abort(); return { code: 0, stdout: '', stderr: '' } },
    })
    expect(run.status).toBe('cancelled')
    expect(run.error?.code).toBe('cancelled')
    expect(run.error?.cellIndex).toBe(0)
    expect(run.steps[0]!.status).toBe('cancelled')
  })

  it('fails with the failing cell index and stops the run', async () => {
    const ran: string[] = []
    const cells: CodebookCell[] = [SCRIPT, { id: 'c2', kind: 'script', command: 'boom' }, { id: 'c3', kind: 'script', command: 'later' }]
    const { input, progress } = fixture(cells)
    const run = await runCodebook(input, {
      run: async (procInput) => {
        ran.push(procInput.command)
        return { code: procInput.command === 'boom' ? 2 : 0, stdout: '', stderr: 'kaboom' }
      },
    })
    expect(run.status).toBe('failed')
    expect(run.error?.cellIndex).toBe(1)
    expect(run.error?.code).toBe('step-failed')
    expect(run.steps[1]!.status).toBe('failed')
    expect(run.steps[1]!.output?.stderr).toBe('kaboom')
    expect(ran).toEqual(['echo', 'boom'])
    expect(progress.at(-1)!.state).toBe('failed')
  })

  it('maps a missing executable to command-unavailable', async () => {
    const run = await runCodebook(fixture([SCRIPT]).input, {
      run: async () => { throw Object.assign(new Error('spawn echo ENOENT'), { code: 'ENOENT' }) },
    })
    expect(run.status).toBe('failed')
    expect(run.error?.code).toBe('command-unavailable')
  })

  it('answers agent-unavailable without an agent seam instead of inventing output', async () => {
    const run = await runCodebook(fixture([{ id: 'a', kind: 'agent', prompt: 'explain' }]).input)
    expect(run.status).toBe('failed')
    expect(run.error?.code).toBe('agent-unavailable')
    expect(run.steps[0]!.output).toBeUndefined()
  })

  it('reuses the injected agent runner and records its session id', async () => {
    const run = await runCodebook(fixture([{ id: 'a', kind: 'agent', prompt: 'explain the repo' }]).input, {
      agent: { run: async () => ({ sessionId: 'sess_1', text: 'the repo is small' }) },
    })
    expect(run.status).toBe('succeeded')
    expect(run.steps[0]!.output).toMatchObject({ text: 'the repo is small', sessionId: 'sess_1' })
  })

  it('references an existing artifact by id and never copies its content', async () => {
    const run = await runCodebook(fixture([{ id: 'a', kind: 'artifact', artifactId: 'artifact_x' }]).input, {
      artifacts: { resolve: async input => ({ artifactId: input.artifactId, path: 'wiki/index.md', format: 'md' }) },
    })
    expect(run.status).toBe('succeeded')
    expect(run.steps[0]!.output).toEqual({ artifactId: 'artifact_x', artifactPath: 'wiki/index.md', artifactFormat: 'md' })
    expect(run.steps[0]!.output).not.toHaveProperty('text')
  })

  it('answers artifact-unavailable without a resolver', async () => {
    const run = await runCodebook(fixture([{ id: 'a', kind: 'artifact', artifactId: 'artifact_x' }]).input)
    expect(run.status).toBe('failed')
    expect(run.error?.code).toBe('artifact-unavailable')
  })

  it('publishes a step output as an artifact reference, dropping the inline copy', async () => {
    const run = await runCodebook(fixture([SCRIPT]).input, {
      run: async () => ({ code: 0, stdout: 'lots of output', stderr: '' }),
      publishArtifact: async input => ({ artifactId: `artifact_${input.cellId}`, path: `codebook/${input.cellId}.txt`, format: 'md' }),
    })
    expect(run.status).toBe('succeeded')
    expect(run.steps[0]!.output).toEqual({ artifactId: 'artifact_c1', artifactPath: 'codebook/c1.txt', artifactFormat: 'md', exitCode: 0 })
  })

  it('refuses a shell-string command before spawning anything', async () => {
    const { input } = fixture([{ id: 'a', kind: 'script', command: 'echo hi && rm -rf /' }])
    const error = await runCodebook(input, { run: async () => ({ code: 0, stdout: '', stderr: '' }) }).catch(caught => caught)
    expect(codeOf(error)).toBe('invalid-input')
  })

  it('never routes through shell:exec (spawn-only contract)', () => {
    const source = readFileSync(fileURLToPath(new URL('../engine.ts', import.meta.url)), 'utf8')
    expect(source.includes('shell:exec')).toBe(false)
    expect(source).toContain('shell: false')
    expect(source).toContain("from 'node:child_process'")
  })
})