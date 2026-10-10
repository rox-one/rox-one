import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CLOUD_RUN_ACTIVE_STATES,
  buildSubmitArgs,
  canCancelRun,
  runStateMessageKey,
  sortRunsNewestFirst,
  type CloudRunListItem,
  type CloudRunState,
} from '../cloud-vm-runs.ts'

const run = (over: Partial<CloudRunListItem> & { id: string }): CloudRunListItem => ({
  id: over.id,
  name: over.name ?? over.id,
  createdAt: over.createdAt ?? 0,
  status: over.status ?? null,
})

describe('buildSubmitArgs — topic validation', () => {
  test('rejects an empty topic', () => {
    expect(buildSubmitArgs('')).toBeNull()
  })

  test('rejects a whitespace-only topic (the handler rejects it too)', () => {
    expect(buildSubmitArgs('   ')).toBeNull()
    expect(buildSubmitArgs('\n\t ')).toBeNull()
  })

  test('trims a valid topic and sends only the required shape', () => {
    expect(buildSubmitArgs('  Dayhoff research  ')).toEqual({ topic: 'Dayhoff research' })
  })
})

describe('canCancelRun — active vs terminal states', () => {
  test('offers cancel for every active state', () => {
    for (const state of CLOUD_RUN_ACTIVE_STATES) {
      expect(canCancelRun(run({ id: 'r', status: { state } }))).toBe(true)
    }
  })

  test('never offers cancel for terminal states', () => {
    const terminal: CloudRunState[] = ['done', 'failed', 'cancelled', 'expired']
    for (const state of terminal) {
      expect(canCancelRun(run({ id: 'r', status: { state } }))).toBe(false)
    }
  })

  test('a missing status is not cancellable', () => {
    expect(canCancelRun(run({ id: 'r', status: null }))).toBe(false)
    expect(canCancelRun(run({ id: 'r' }))).toBe(false)
  })
})

describe('sortRunsNewestFirst', () => {
  test('orders by createdAt descending without mutating the input', () => {
    const input = [
      run({ id: 'old', createdAt: 100 }),
      run({ id: 'newest', createdAt: 300 }),
      run({ id: 'middle', createdAt: 200 }),
    ]
    const sorted = sortRunsNewestFirst(input)
    expect(sorted.map((r) => r.id)).toEqual(['newest', 'middle', 'old'])
    expect(input.map((r) => r.id)).toEqual(['old', 'newest', 'middle'])
  })

  test('breaks createdAt ties deterministically by id', () => {
    const a = run({ id: 'aaa', createdAt: 500 })
    const b = run({ id: 'bbb', createdAt: 500 })
    expect(sortRunsNewestFirst([b, a]).map((r) => r.id)).toEqual(['aaa', 'bbb'])
    expect(sortRunsNewestFirst([a, b]).map((r) => r.id)).toEqual(['aaa', 'bbb'])
  })

  test('treats a missing createdAt as oldest', () => {
    const sorted = sortRunsNewestFirst([{ id: 'no-date' }, run({ id: 'dated', createdAt: 1 })])
    expect(sorted.map((r) => r.id)).toEqual(['dated', 'no-date'])
  })
})

describe('runStateMessageKey', () => {
  test('returns a key for every state the list can report', () => {
    const states: CloudRunState[] = [
      'queued', 'start', 'ready', 'running', 'done', 'failed', 'cancelled', 'expired',
    ]
    const keys = new Set(states.map((state) => runStateMessageKey(state)))
    expect(keys.size).toBe(states.length)
    expect(runStateMessageKey('running')).toBe('cloudRuns.state.running')
    expect(runStateMessageKey('expired')).toBe('cloudRuns.state.expired')
  })

  test('falls back for unknown or missing states', () => {
    expect(runStateMessageKey(null)).toBe('cloudRuns.state.unknown')
    expect(runStateMessageKey(undefined)).toBe('cloudRuns.state.unknown')
    expect(runStateMessageKey('teleporting')).toBe('cloudRuns.state.unknown')
  })
})

describe('cloud-VM surface wiring', () => {
  const app = readFileSync(join(import.meta.dir, '../App.tsx'), 'utf8')
  const surface = readFileSync(join(import.meta.dir, '../cloud-vm-surface.tsx'), 'utf8')

  test('App stores the chosen mode and overlays the surface above the renderer', () => {
    expect(app).toContain("setEnteredMode(mode)")
    expect(app).toContain("setCloudVmOpen(mode === 'cloud-vm')")
    expect(app).toContain('<CloudVmSurface')
    expect(app).toContain('routes.view.cloudRun(id)')
  })

  test('the surface reuses the availability probe and the pure helpers', () => {
    expect(surface).toContain('probeCloudVmState')
    expect(surface).toContain('cloudVmStateMessageKey')
    expect(surface).toContain('buildSubmitArgs')
    expect(surface).toContain('canCancelRun')
    expect(surface).toContain('runStateMessageKey')
  })
})