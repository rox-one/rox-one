/**
 * A6 — MemoryRepoDreamsPanel: empty state, run button gating, last-run card
 * with the «оценка» marker, and the in-order event stream / runs list.
 */
import { setupEntityTestEnv, mount, resetDom, i18n } from '../../../entities/__tests__/test-env'
import { afterEach, describe, expect, it } from 'bun:test'
import type { MemoryDreamEvent, MemoryDreamStatus } from '@rox/shared/memory/repo'
import { MemoryRepoDreamsPanel, groupDreamRuns } from '../MemoryRepoDreamsPanel'

setupEntityTestEnv()

afterEach(() => resetDom())

const STATUS: MemoryDreamStatus = {
  bankId: 'main',
  running: false,
  lastRun: {
    dreamId: 'd1',
    bankId: 'main',
    startedAt: '2026-10-09T08:00:00.000Z',
    endedAt: '2026-10-09T08:01:00.000Z',
    status: 'ok',
    model: 'gpt-5-mini',
    costUsd: 0.0123,
    costIsEstimate: true,
  },
  nextRunAt: '2026-10-09T12:00:00.000Z',
  intervalHours: 4,
  model: 'gpt-5-mini',
  costTodayUsd: 0.0123,
  costIsEstimate: true,
  pendingNoteIds: [],
}

const LOG: MemoryDreamEvent[] = [
  { ts: '2026-10-09T08:00:00.000Z', dreamId: 'd1', bankId: 'main', kind: 'start', message: 'dream start' },
  { ts: '2026-10-09T08:00:10.000Z', dreamId: 'd1', bankId: 'main', kind: 'distill', message: 'distilled 3', model: 'gpt-5-mini', inputTokens: 100, outputTokens: 40, costUsd: 0.0123 },
  { ts: '2026-10-09T08:01:00.000Z', dreamId: 'd1', bankId: 'main', kind: 'end', message: 'done' },
]

describe('MemoryRepoDreamsPanel', () => {
  it('renders the empty state when status is null', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoDreamsPanel bankId="main" status={null} log={[]} running={false} onRunNow={() => {}} />,
    )
    expect(container.querySelector('[data-testid="memory-repo-dreams-empty"]')).not.toBeNull()
    await unmount()
  })

  it('renders the last-run card with model, cost and the «оценка» marker', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoDreamsPanel bankId="main" status={STATUS} log={LOG} running={false} onRunNow={() => {}} />,
    )
    expect(container.querySelector('[data-testid="memory-repo-dreams-model"]')?.textContent).toContain('gpt-5-mini')
    expect(container.querySelector('[data-testid="memory-repo-dreams-cost-today"]')?.textContent).toContain(i18n.t('memory.repo.costEstimate'))
    expect(container.querySelector('[data-testid="memory-repo-dreams-status-ok"]')).not.toBeNull()
    await unmount()
  })

  it('disables the run button while running (and enables it otherwise)', async () => {
    const running = await mount(
      <MemoryRepoDreamsPanel bankId="main" status={STATUS} log={LOG} running onRunNow={() => {}} />,
    )
    const runningButton = running.container.querySelector<HTMLButtonElement>('[data-testid="memory-repo-dreams-run"]')
    expect(runningButton?.disabled).toBe(true)
    expect(runningButton?.textContent).toContain(i18n.t('memory.repo.state.dreamRunning'))
    await running.unmount()

    const idle = await mount(
      <MemoryRepoDreamsPanel bankId="main" status={{ ...STATUS, lastRun: null }} log={[]} running={false} onRunNow={() => {}} />,
    )
    const idleButton = idle.container.querySelector<HTMLButtonElement>('[data-testid="memory-repo-dreams-run"]')
    expect(idleButton?.disabled).toBe(false)
    await idle.unmount()
  })

  it('fires onRunNow from the run button', async () => {
    let calls = 0
    const { container, unmount } = await mount(
      <MemoryRepoDreamsPanel bankId="main" status={STATUS} log={[]} running={false} onRunNow={() => { calls += 1 }} />,
    )
    container.querySelector<HTMLButtonElement>('[data-testid="memory-repo-dreams-run"]')?.click()
    expect(calls).toBe(1)
    await unmount()
  })

  it('renders stream events in order', async () => {
    const { container, unmount } = await mount(
      <MemoryRepoDreamsPanel bankId="main" status={STATUS} log={LOG} running={false} onRunNow={() => {}} />,
    )
    const kinds = Array.from(container.querySelectorAll('[data-testid="memory-repo-dreams-event"]')).map((el) => el.getAttribute('data-kind'))
    expect(kinds).toEqual(['start', 'distill', 'end'])
    await unmount()
  })

  it('shows the failure banner for a failed last run', async () => {
    const failed: MemoryDreamStatus = { ...STATUS, lastRun: { ...STATUS.lastRun!, status: 'error', error: 'boom' } }
    const { container, unmount } = await mount(
      <MemoryRepoDreamsPanel bankId="main" status={failed} log={LOG} running={false} onRunNow={() => {}} />,
    )
    const banner = container.querySelector('[data-testid="memory-repo-dreams-failed"]')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain('boom')
    await unmount()
  })
})

describe('groupDreamRuns', () => {
  it('groups events per dreamId in first-seen order and resolves the final status', () => {
    const runs = groupDreamRuns([
      ...LOG,
      { ts: '2026-10-09T09:00:00.000Z', dreamId: 'd2', bankId: 'main', kind: 'start', message: 's' },
      { ts: '2026-10-09T09:00:01.000Z', dreamId: 'd2', bankId: 'main', kind: 'error', message: 'nope' },
    ])
    expect(runs.map((run) => run.dreamId)).toEqual(['d1', 'd2'])
    expect(runs[0]!.status).toBe('ok')
    expect(runs[0]!.costUsd).toBeCloseTo(0.0123)
    expect(runs[1]!.status).toBe('error')
    expect(runs[1]!.error).toBe('nope')
  })
})
