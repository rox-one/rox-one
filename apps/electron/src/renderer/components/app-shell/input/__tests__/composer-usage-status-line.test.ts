/**
 * DSH-P1 composer usage status line: row content (RU/EN, plurals, "—" for
 * provider-missing fields), tooltip breakdown, trajectory.open click, and
 * under-composer wiring. Real i18n, static markup + DOM mount (repo idiom:
 * entities/__tests__/test-env).
 */
import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { readFileSync } from 'fs'
import { join } from 'path'
import { mount, renderMarkup, setupEntityTestEnv } from '../../entities/__tests__/test-env'
import {
  ComposerUsageStatusLine,
  formatUsageCost,
  UsageStatusLineView,
  UsageStatusTooltipContent,
  type UsageStatusNumbers,
} from '../ComposerUsageStatusLine'

setupEntityTestEnv()

const full: UsageStatusNumbers = {
  turns: 1,
  steps: 2,
  input: 3_200,
  output: 150,
  costUsd: 0.02,
  contextPercent: 42,
  cacheRead: 3_000,
  cacheWrite: 50,
  breakdown: { system: 500, tools: 200, messages: 2_500 },
  lastAttempt: { model: 'rox/r1-max', output: 150 },
}

describe('formatUsageCost', () => {
  it('keeps sub-cent costs readable instead of rounding to $0.00', () => {
    expect(formatUsageCost(0.0042)).toBe('~$0.004')
    expect(formatUsageCost(0.02)).toBe('~$0.02')
    expect(formatUsageCost(1.5)).toBe('~$1.50')
  })
})

describe('UsageStatusLineView row', () => {
  it('renders turns/steps/tokens/context/cost in Russian', async () => {
    const html = await renderMarkup(<UsageStatusLineView numbers={full} sessionId="s1" />, { lang: 'ru' })
    expect(html).toContain('1 ход')
    expect(html).toContain('2 шага')
    expect(html).toContain('↑3.2K')
    expect(html).toContain('↓150')
    expect(html).toContain('контекст 42%')
    expect(html).toContain('~$0.02')
  })

  it('renders English with singular/plural forms', async () => {
    const html = await renderMarkup(<UsageStatusLineView numbers={full} sessionId="s1" />, { lang: 'en' })
    expect(html).toContain('1 turn')
    expect(html).toContain('2 steps')
    expect(html).toContain('context 42%')
  })

  it('uses Russian few/many plurals', async () => {
    const html = await renderMarkup(
      <UsageStatusLineView numbers={{ ...full, turns: 5, steps: 5 }} sessionId="s1" />,
      { lang: 'ru' },
    )
    expect(html).toContain('5 ходов')
    expect(html).toContain('5 шагов')
  })

  it('renders "—" for fields no provider reported and omits cost', async () => {
    const html = await renderMarkup(<UsageStatusLineView numbers={{ turns: 0, steps: 0 }} sessionId="s1" />, { lang: 'ru' })
    expect(html).toContain('↑—')
    expect(html).toContain('↓—')
    expect(html).toContain('контекст —')
    expect(html).not.toContain('data-stat="cost"')
    expect(html).toContain('0 ходов')
    expect(html).toContain('0 шагов')
  })

  it('is one muted 11px row with an accessible Trajectory label', async () => {
    const html = await renderMarkup(<UsageStatusLineView numbers={full} sessionId="s1" />, { lang: 'ru' })
    expect(html).toContain('text-[11px]')
    expect(html).toContain('text-muted-foreground')
    expect(html).toContain('data-testid="usage-status-line"')
    expect(html).toContain('Открыть Траекторию')
  })
})

describe('UsageStatusTooltipContent', () => {
  it('shows cache, ≈ breakdown and last attempt with "—" for missing timing', async () => {
    const html = await renderMarkup(<UsageStatusTooltipContent numbers={full} />, { lang: 'ru' })
    expect(html).toContain('Кэш:')
    expect(html).toContain('≈')
    expect(html).toContain('rox/r1-max')
    // No provider reports TTFT/decode yet: honest dashes, never invented.
    expect(html).toContain('TTFT —')
  })

  it('omits sections with no data', async () => {
    const html = await renderMarkup(<UsageStatusTooltipContent numbers={{ turns: 0, steps: 0 }} />, { lang: 'en' })
    expect(html).toContain('Cache:')
    expect(html).not.toContain('≈')
  })
})

describe('trajectory.open click', () => {
  it('dispatches a no-op-safe window event carrying the session id', async () => {
    const seen: Array<{ sessionId: string }> = []
    const listener = (e: Event) => { seen.push((e as CustomEvent).detail) }
    window.addEventListener('trajectory.open', listener)
    try {
      const mounted = await mount(<UsageStatusLineView numbers={full} sessionId="s-9" />)
      try {
        const button = mounted.container.querySelector('[data-testid="usage-status-line"]') as HTMLElement | null
        expect(button).not.toBeNull()
        await act(async () => { button!.click() })
        expect(seen).toEqual([{ sessionId: 's-9' }])
      } finally {
        await mounted.unmount()
      }
    } finally {
      window.removeEventListener('trajectory.open', listener)
    }
  })
})

describe('under-composer wiring (repo source-assertion idiom)', () => {
  const dir = join(__dirname, '..')
  it('ChatInputZone renders the journal line under the composer outside compact mode', () => {
    const zone = readFileSync(join(dir, 'ChatInputZone.tsx'), 'utf8')
    expect(zone).toContain('<ComposerUsageStatusLine sessionId={sessionId}')
    expect(zone).toContain('{!compactMode && (')
  })
  it('ChatDisplay feeds session token usage as the context-window fallback', () => {
    const display = readFileSync(join(dir, '..', 'ChatDisplay.tsx'), 'utf8')
    expect(display).toContain('tokenUsage={session.tokenUsage ? {')
    expect(display).toContain('contextWindow: session.tokenUsage.contextWindow')
  })
  it('the container export exists for the live journal fold', () => {
    expect(typeof ComposerUsageStatusLine).toBe('function')
  })
})
