import { describe, expect, it } from 'bun:test'
import {
  advanceCodebookJob, applyCodebookJobEvent, CODEBOOK_JOB_TRANSITIONS, createCodebookJob,
} from '../codebook.ts'

const CELLS = [
  { id: 'c1', kind: 'script' as const, command: 'echo' },
  { id: 'c2', kind: 'agent' as const, prompt: 'explain' },
]

describe('codebook job machine', () => {
  it('starts queued with pending steps and zero seq', () => {
    const job = createCodebookJob({ id: 'j', notebookId: 'nb', runId: 'r', projectSlug: 'p', cells: CELLS })
    expect(job.state).toBe('queued')
    expect(job.seq).toBe(0)
    expect(job.totalCells).toBe(2)
    expect(job.steps.map(step => step.status)).toEqual(['pending', 'pending'])
  })

  it('applies non-notebook indexes when cellIds select a subset', () => {
    const job = createCodebookJob({ id: 'j', notebookId: 'nb', runId: 'r', projectSlug: 'p', cells: [CELLS[1]!], indexes: [3] })
    expect(job.steps[0]!.index).toBe(3)
  })

  it('advances along the allowed transitions and records progress', () => {
    const queued = createCodebookJob({ id: 'j', notebookId: 'nb', runId: 'r', projectSlug: 'p', cells: CELLS })
    const running = advanceCodebookJob(queued, 'running', 1, { cellIndex: 0 })
    expect(running).toMatchObject({ state: 'running', seq: 1, cellIndex: 0 })
    const done = advanceCodebookJob(running, 'done', 2, { doneSteps: 2 })
    expect(done).toMatchObject({ state: 'done', seq: 2, doneSteps: 2 })
  })

  it('ignores a non-advancing seq so a late push never rewinds a run', () => {
    const job = createCodebookJob({ id: 'j', notebookId: 'nb', runId: 'r', projectSlug: 'p', cells: CELLS })
    const running = advanceCodebookJob(job, 'running', 5, { cellIndex: 0 })
    expect(advanceCodebookJob(running, 'done', 3)).toEqual(running)
    expect(applyCodebookJobEvent(running, { id: 'j', seq: 4 })).toEqual(running)
  })

  it('ignores an event for a foreign job id', () => {
    const job = createCodebookJob({ id: 'j', notebookId: 'nb', runId: 'r', projectSlug: 'p', cells: CELLS })
    expect(applyCodebookJobEvent(job, { id: 'other', seq: 1 })).toEqual(job)
  })

  it('refuses illegal transitions out of a terminal state', () => {
    const job = createCodebookJob({ id: 'j', notebookId: 'nb', runId: 'r', projectSlug: 'p', cells: CELLS })
    const done = advanceCodebookJob(advanceCodebookJob(job, 'running', 1), 'done', 2)
    expect(advanceCodebookJob(done, 'running', 3)).toEqual(done)
    expect(CODEBOOK_JOB_TRANSITIONS.done).toEqual([])
  })
})