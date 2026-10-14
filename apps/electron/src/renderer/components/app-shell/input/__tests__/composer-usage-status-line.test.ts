import { useDomForFile, resetDom } from '../../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'

useDomForFile()

import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { TooltipProvider } from '@rox/ui/tooltip'
import type { RuntimeEvent } from '@rox/core/runtime-trace/types'
import {
  ComposerUsageStatusLine,
  computeUsageStatusNumbers,
  formatUsageCostBody,
  UsageStatusLineView,
  UsageStatusTooltipContent,
} from '../ComposerUsageStatusLine'

const localesDir = join(__dirname, '..', '..', '..', '..', '..', '..', '..', '..', 'packages', 'shared', 'src', 'i18n', 'locales')
const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>

let i18n: I18n
async function testI18n(): Promise<I18n> {
  if (i18n) return i18n
  i18n = createInstance()
  await i18n.init({ lng: 'en', fallbackLng: 'en', keySeparator: false, interpolation: { escapeValue: false }, resources: { en: { translation: en } } })
  return i18n
}

const journalAttempt = (seq: number, usage: Record<string, number | undefined>, extra: Record<string, unknown> = {}): RuntimeEvent =>
  ({
    schemaVersion: 1, eventId: `ui:${seq}`, sourceEventId: `ui:${seq}`, sourceId: 'ui', sourceSeq: seq,
    workspaceId: 'w', rootSessionId: 's', runId: 'r', rootRunId: 'r', agentId: 'a', seq,
    occurredAt: { state: 'known', value: seq, source: 'ui', origin: 'observed' }, receivedAt: seq,
    clockDomain: 'ui', origin: 'observed',
    kind: 'llm.attempt.completed',
    payload: { turnId: 'turn-1', step: seq, usage, ...extra },
  }) as unknown as RuntimeEvent

afterEach(() => resetDom())

describe('computeUsageStatusNumbers', () => {
  it('folds journal attempts; missing fields stay undefined for "—"', () => {
    const numbers = computeUsageStatusNumbers([
      journalAttempt(1, { uncachedInput: 100, output: 20, cacheRead: 800, cacheWrite: 10 }, { costUsd: 0.02, contextWindow: 100_000, route: { provider: 'pi', model: 'rox/r1-max' } }),
      journalAttempt(2, { uncachedInput: 50, output: 5 }, { retryOf: 'ui:1', route: { provider: 'pi', model: 'rox/r1-max' } }),
    ])
    expect(numbers.turns).toBe(1)
    expect(numbers.steps).toBe(2)
    expect(numbers.input).toBe(150 + 800 + 10)
    expect(numbers.output).toBe(25)
    expect(numbers.costUsd).toBe(0.02)
    expect(numbers.cacheRead).toBe(800)
    expect(numbers.cacheWrite).toBe(10)
    expect(numbers.contextPercent).toBe(0) // last prompt 50/100000 rounds to 0%
    expect(numbers.lastAttempt?.model).toBe('rox/r1-max')
  })

  it('falls back to session tokenUsage and message stats without journal data', () => {
    const numbers = computeUsageStatusNumbers([], { turns: 3, steps: 4, sessionTokens: null, cacheHitPercent: null, contextPercent: null },
      { inputTokens: 50_000, outputTokens: 1_200, contextWindow: 200_000, costUsd: 0.05 })
    expect(numbers.turns).toBe(3)
    expect(numbers.steps).toBe(4)
    expect(numbers.input).toBeUndefined()
    expect(numbers.output).toBe(1_200)
    expect(numbers.costUsd).toBe(0.05)
    expect(numbers.contextPercent).toBe(25)
    expect(numbers.lastAttempt).toBeUndefined()
  })

  it('merges journal and transcript with max; empty session shows zeros and unknowns', () => {
    const numbers = computeUsageStatusNumbers([journalAttempt(1, { uncachedInput: 10, output: 2 })],
      { turns: 5, steps: 1, sessionTokens: null, cacheHitPercent: null, contextPercent: null }, null)
    expect(numbers.turns).toBe(5)
    expect(numbers.steps).toBe(1)
    const empty = computeUsageStatusNumbers([], null, null)
    expect(empty).toMatchObject({ turns: 0, steps: 0 })
    expect(empty.input).toBeUndefined()
    expect(empty.contextPercent).toBeUndefined()
  })
})

describe('formatUsageCostBody', () => {
  it('keeps sub-cent costs readable, two decimals otherwise', () => {
    expect(formatUsageCostBody(0.004)).toBe('0.004')
    expect(formatUsageCostBody(1.5)).toBe('1.50')
  })
})

describe('UsageStatusLineView markup', () => {
  it('renders the 11px row with cost and "—" for unknowns', async () => {
    const html = renderToStaticMarkup(
      React.createElement(TooltipProvider, null, React.createElement(I18nextProvider, { i18n: await testI18n() },
        React.createElement(UsageStatusLineView, {
          sessionId: 's',
          numbers: { turns: 2, steps: 3, input: 960, costUsd: 0.02, contextPercent: 12 },
        }))),
    )
    expect(html).toContain('data-testid="usage-status-line"')
    expect(html).toContain('text-[11px]')
    expect(html).toContain('2 turns')
    expect(html).toContain('3 steps')
    expect(html).toContain('↑960')
    expect(html).toContain('↓—')
    expect(html).toContain('context 12%')
    expect(html).toContain('~$0.02')
  })

  it('renders tooltip content with cache, ≈ breakdown and last attempt', async () => {
    const html = renderToStaticMarkup(
      React.createElement(TooltipProvider, null, React.createElement(I18nextProvider, { i18n: await testI18n() },
        React.createElement(UsageStatusTooltipContent, {
          numbers: {
            turns: 1, steps: 1, cacheRead: 800, cacheWrite: 10,
            breakdown: { system: 100, tools: 14, messages: 5 },
            lastAttempt: { model: 'rox/r1-max', ttftMs: 320 },
          },
        }))),
    )
    expect(html).toContain('data-testid="usage-status-tooltip"')
    expect(html).toContain('Cache: read 800 · write 10')
    expect(html).toContain('≈ System 100 · Tools 14 · Messages 5')
    expect(html).toContain('rox/r1-max · TTFT 320 ms · —')
  })

  it('click dispatches a no-op-safe trajectory.open event with the session id', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const seen: Array<{ sessionId: string }> = []
    const listener = (event: Event) => seen.push((event as CustomEvent).detail)
    window.addEventListener('trajectory.open', listener)
    try {
      const reactRoot = createRoot(root)
      await act(async () => {
        reactRoot.render(
          React.createElement(TooltipProvider, null, React.createElement(I18nextProvider, { i18n: await testI18n() },
            React.createElement(UsageStatusLineView, { sessionId: 's-1', numbers: { turns: 0, steps: 0 } }))),
        )
      })
      const button = root.querySelector('[data-testid="usage-status-line"]') as HTMLButtonElement | null
      expect(button).not.toBeNull()
      await act(async () => { button!.click() })
      expect(seen).toEqual([{ sessionId: 's-1' }])
      await act(async () => { reactRoot.unmount() })
    } finally {
      window.removeEventListener('trajectory.open', listener)
    }
  })
})

describe('usage status i18n', () => {
  it('exists in every locale with proper Russian plurals and real translations', () => {
    expect(en['composer.usageStatus.turns_one']).toBe('{{count}} turn')
    expect(en['composer.usageStatus.turns_other']).toBe('{{count}} turns')
    expect(en['composer.usageStatus.cost']).toBe('~${{cost}}')
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8'))
    expect([ru['composer.usageStatus.turns_one'], ru['composer.usageStatus.turns_few'], ru['composer.usageStatus.turns_many']])
      .toEqual(['{{count}} ход', '{{count}} хода', '{{count}} ходов'])
    expect([ru['composer.usageStatus.steps_one'], ru['composer.usageStatus.steps_few'], ru['composer.usageStatus.steps_many']])
      .toEqual(['{{count}} шаг', '{{count}} шага', '{{count}} шагов'])
    for (const loc of ['de', 'fr', 'es', 'pl', 'hu', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'ar']) {
      const d = JSON.parse(readFileSync(join(localesDir, `${loc}.json`), 'utf8'))
      for (const key of ['line', 'context', 'contextUnknown', 'cost', 'cache', 'breakdown', 'lastAttempt', 'openTrajectory',
        'turns_one', 'turns_few', 'turns_many', 'turns_other', 'steps_one', 'steps_few', 'steps_many', 'steps_other']) {
        expect(typeof d[`composer.usageStatus.${key}`], `${loc}:${key}`).toBe('string')
      }
      expect(d['composer.usageStatus.openTrajectory'], loc).not.toBe(en['composer.usageStatus.openTrajectory'])
    }
  })
})

describe('usage status wiring', () => {
  const dir = join(__dirname, '..')
  it('renders under the composer with journal scope and session fallbacks', () => {
    const zone = readFileSync(join(dir, 'ChatInputZone.tsx'), 'utf8')
    expect(zone).toContain('<ComposerUsageStatusLine sessionId={sessionId} workspaceId={workspaceId} stats={stats} tokenUsage={tokenUsage} />')
  })
  it('ChatDisplay feeds session tokenUsage including output for ↓out fallback', () => {
    const display = readFileSync(join(dir, '..', 'ChatDisplay.tsx'), 'utf8')
    expect(display).toContain('outputTokens: session.tokenUsage.outputTokens')
  })
  it('container is exported for the Trajectory tab to reuse', () => {
    expect(typeof ComposerUsageStatusLine).toBe('function')
  })
})
