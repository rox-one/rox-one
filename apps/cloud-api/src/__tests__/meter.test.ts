import { describe, expect, test } from 'bun:test'
import { accruedCents, createMeter } from '../meter.ts'
import type { SandboxState } from '../../../../packages/cloud-runner/src/sandbox.ts'
import { createMemoryStore, type SandboxRecord } from '../store.ts'

const HOUR = 3_600_000

function seed(createdAt: number, state: SandboxState = 'running') {
  const store = createMemoryStore()
  const tenant = store.addTenant('Тест')
  const record: SandboxRecord = {
    id: 'sbx_meter_1',
    tenantId: tenant.id,
    providerId: 'daytona',
    state,
    createdAt,
    costCents: 0,
    spec: { id: 'sbx_meter_1', os: 'linux', cpu: 1, memoryGb: 1 },
  }
  store.sandboxes.set(record.id, record)
  const usage = {
    id: 'usage_1',
    tenantId: tenant.id,
    ref: record.id,
    product: 'sandbox',
    cents: 0,
    currency: 'USD' as const,
    createdAt,
  }
  store.usage.push(usage)
  return { store, record, usage }
}

describe('accruedCents', () => {
  test('rounds up to a whole cent with a one-cent minimum', () => {
    expect(accruedCents(0, 60_000, 100)).toBe(2)
    expect(accruedCents(0, HOUR, 100)).toBe(100)
    expect(accruedCents(0, HOUR / 2, 100)).toBe(50)
    expect(accruedCents(0, 1_000, 100)).toBe(1)
  })

  test('returns zero for a non-positive rate', () => {
    expect(accruedCents(0, HOUR, 0)).toBe(0)
    expect(accruedCents(0, HOUR, -5)).toBe(0)
    expect(accruedCents(0, HOUR, Number.NaN)).toBe(0)
  })

  test('never goes backwards when the clock is earlier than creation', () => {
    expect(accruedCents(10_000, 5_000, 100)).toBe(1)
  })
})

describe('meter tick', () => {
  test('raises a running sandbox and its usage row to the accrued fee', () => {
    const { store, record, usage } = seed(0)
    const meter = createMeter({ store, rateCentsPerHour: 100, now: () => HOUR })
    expect(meter.tick()).toBe(1)
    expect(record.costCents).toBe(100)
    expect(usage.cents).toBe(100)
  })

  test('a paused sandbox keeps accruing', () => {
    const { store, record } = seed(0, 'paused')
    const meter = createMeter({ store, rateCentsPerHour: 100, now: () => HOUR })
    meter.tick()
    expect(record.costCents).toBe(100)
  })

  test('a stopped sandbox does not change', () => {
    const { store, record } = seed(0, 'stopped')
    const meter = createMeter({ store, rateCentsPerHour: 100, now: () => HOUR })
    expect(meter.tick()).toBe(0)
    expect(record.costCents).toBe(0)
  })

  test('a second tick at the same instant changes nothing', () => {
    const { store } = seed(0)
    let now = 0
    const meter = createMeter({ store, rateCentsPerHour: 100, now: () => now })
    now = HOUR
    expect(meter.tick()).toBe(1)
    expect(meter.tick()).toBe(0)
  })
})

describe('per-record rate', () => {
  test('a record with its own rate is metered at it, not at the deployment rate', () => {
    const { store, record } = seed(0)
    store.sandboxes.set(record.id, { ...record, rateCentsPerHour: 786 })
    const meter = createMeter({ store, rateCentsPerHour: 25, now: () => HOUR })
    meter.tick()
    expect(store.sandboxes.get(record.id)?.costCents).toBe(786)
  })

  test('a record without a rate keeps the old flat deployment rate', () => {
    const { store, record } = seed(0)
    const meter = createMeter({ store, rateCentsPerHour: 25, now: () => HOUR })
    meter.tick()
    expect(record.costCents).toBe(25)
  })
})
