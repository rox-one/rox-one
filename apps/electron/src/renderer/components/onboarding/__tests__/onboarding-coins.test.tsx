import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CoinsBurst as CoinsBurstComponent } from '../CoinsBurst'
import { createRewardLedger, rewardAmountFor, type RewardStorage } from '../onboarding-rewards'
import {
  createLearningCurve,
  drainLearningEvents,
  LEARNING_CURVE_MAX_BUFFER,
  trackLearningEvent,
} from '../learning-curve'

useDomForFile()

// CoinsBurst reaches the UI/i18n packages when rendered under Bun; stub both
// like the sibling onboarding suites.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

let CoinsBurst: typeof CoinsBurstComponent

// Static import cannot work: the component graph must load after the mocks.
beforeAll(async () => {
  ({ CoinsBurst } = await import('../CoinsBurst'))
})

afterEach(() => {
  resetDom()
})

function memoryStorage(seed: Record<string, string> = {}): RewardStorage & { snapshot: () => Record<string, string> } {
  const data = { ...seed }
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
    snapshot: () => data,
  }
}

async function render(node: React.ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(node)
  })
  return { container, root }
}

async function unmount(root: Root): Promise<void> {
  await act(async () => {
    root.unmount()
  })
}

describe('onboarding reward ledger', () => {
  it('awards each step once, idempotent by step id, and survives a reload', () => {
    const storage = memoryStorage()
    const ledger = createRewardLedger({ storage, now: () => 1 })

    const first = ledger.awardStep('username')
    const again = ledger.awardStep('username', 'deferred')

    expect(first.amount).toBe(5)
    expect(first.status).toBe('pending')
    expect(again).toBe(first)
    expect(ledger.entries()).toHaveLength(1)
    expect(ledger.pendingTotal).toBe(5)

    const reloaded = createRewardLedger({ storage })
    expect(reloaded.isAwarded('username')).toBe(true)
    expect(reloaded.entries()).toHaveLength(1)
    expect(reloaded.entries()[0]?.stepId).toBe('username')
  })

  it('caps a deferred step at +1 Rox coin', () => {
    const ledger = createRewardLedger({ storage: memoryStorage() })

    expect(rewardAmountFor('telegram')).toBe(15)
    expect(rewardAmountFor('telegram', 'deferred')).toBe(1)

    const entry = ledger.awardStep('telegram', 'deferred')
    expect(entry.source).toBe('deferred')
    expect(entry.amount).toBe(1)
    expect(ledger.pendingTotal).toBe(1)
  })

  it('adds the +50 full-onboarding bonus and exposes pendingTotal', () => {
    const ledger = createRewardLedger({ storage: memoryStorage() })

    ledger.awardStep('username')
    ledger.awardStep('org')
    ledger.awardStep('github')
    const bonus = ledger.awardStep('full-onboarding')

    expect(bonus.amount).toBe(50)
    expect(ledger.pendingTotal).toBe(65)
  })

  it('moves a pending award to confirmed with the server amount', () => {
    const ledger = createRewardLedger({ storage: memoryStorage() })

    ledger.awardStep('telegram')
    const confirmed = ledger.confirmStep('telegram', 15)

    expect(confirmed?.status).toBe('confirmed')
    expect(confirmed?.amount).toBe(15)
    expect(ledger.pendingTotal).toBe(0)
    expect(ledger.confirmedTotal).toBe(15)
    expect(ledger.total).toBe(15)
    expect(ledger.confirmStep('missing')).toBeNull()
  })
})

describe('learning curve buffer', () => {
  it('attributes saw/tried/result events and drains them locally', () => {
    const curve = createLearningCurve({ now: () => 42 })

    const human = curve.trackLearningEvent({ name: 'saw', stepId: 'username', source: 'human' })
    const agent = curve.trackLearningEvent({ name: 'tried', stepId: 'username', source: 'agent' })
    const unknown = curve.trackLearningEvent({ name: 'result', stepId: 'username' })

    expect(human.source).toBe('human')
    expect(human.at).toBe(42)
    expect(agent.source).toBe('agent')
    expect(unknown.source).toBe('unknown')
    expect(curve.size).toBe(3)

    const drained = curve.drain()
    expect(drained.map((event) => event.name)).toEqual(['saw', 'tried', 'result'])
    expect(curve.size).toBe(0)
    expect(curve.drain()).toEqual([])
  })

  it('keeps only the newest 500 events', () => {
    const curve = createLearningCurve({ now: () => 0 })

    for (let i = 0; i < LEARNING_CURVE_MAX_BUFFER + 25; i += 1) {
      curve.trackLearningEvent({ name: 'repeated', stepId: `step-${i}`, source: 'human' })
    }

    expect(curve.size).toBe(LEARNING_CURVE_MAX_BUFFER)
    const events = curve.peek()
    expect(events[0]?.stepId).toBe('step-25')
    expect(events[events.length - 1]?.stepId).toBe(`step-${LEARNING_CURVE_MAX_BUFFER + 24}`)
  })

  it('persists the buffer through the storage adapter', () => {
    const storage = memoryStorage()
    createLearningCurve({ storage, now: () => 7 }).trackLearningEvent({
      name: 'returned',
      stepId: 'org',
      source: 'human',
    })

    const restored = createLearningCurve({ storage })
    expect(restored.peek()).toEqual([{ name: 'returned', stepId: 'org', source: 'human', at: 7 }])
  })

  it('exposes a process-wide local buffer and never touches the network', () => {
    trackLearningEvent({ name: 'saw', stepId: 'telegram', source: 'human' })
    expect(drainLearningEvents().some((event) => event.stepId === 'telegram')).toBe(true)

    const source = readFileSync(join(import.meta.dir, '../learning-curve.ts'), 'utf8')
    expect(source).not.toContain('fetch(')
    expect(source).not.toContain('XMLHttpRequest')
    expect(source).not.toContain('navigator.sendBeacon')
  })
})

describe('CoinsBurst', () => {
  it('renders the confirmed amount and the Rox coins name', async () => {
    const { container, root } = await render(<CoinsBurst count={5} confirmed reducedMotion={false} />)

    expect(container.querySelector('[data-testid="onboarding-coins-burst"]')).not.toBeNull()
    expect(container.textContent).toContain('+5')
    expect(container.textContent).toContain('Rox coins')

    await unmount(root)
  })

  it('shows a static notice under reduced motion with no falling coins', async () => {
    const { container, root } = await render(
      <CoinsBurst count={1} reason="deferred" confirmed reducedMotion />,
    )

    expect(container.querySelector('[data-testid="onboarding-coins-static"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="onboarding-coins-burst"]')).toBeNull()
    expect(container.textContent).toContain('+1')
    expect(container.textContent).toContain('Rox coins')
    expect(container.textContent).toContain('onboarding.rewards.reason.deferred')

    await unmount(root)
  })

  it('stays hidden until the award is confirmed', async () => {
    const { container, root } = await render(<CoinsBurst count={5} confirmed={false} />)

    expect(container.textContent).toBe('')
    expect(container.querySelector('[data-testid="onboarding-coins-burst"]')).toBeNull()
    expect(container.querySelector('[data-testid="onboarding-coins-static"]')).toBeNull()

    await unmount(root)
  })
})