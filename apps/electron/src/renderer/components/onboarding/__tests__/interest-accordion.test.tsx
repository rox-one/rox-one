/**
 * InterestAccordion — one group open at a time, «Далее» advances, collapsed
 * groups summarise their chips, headers support arrow-key roving.
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type * as AccordionModule from '../InterestAccordion'
import { BUBBLE_GROUP_IDS, type BubbleGroupId } from '../bubbles-catalog'

useDomForFile()

mock.module('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }),
}))

let mod: typeof AccordionModule
beforeAll(async () => {
  mod = await import('../InterestAccordion')
})
afterEach(() => { resetDom() })

const empty = () =>
  BUBBLE_GROUP_IDS.reduce((acc, id) => { acc[id] = []; return acc }, {} as Record<BubbleGroupId, string[]>)

function Harness({ initial }: { initial?: Record<BubbleGroupId, string[]> }) {
  const [selection, setSelection] = React.useState(initial ?? empty())
  return (
    <mod.InterestAccordion
      groupIds={BUBBLE_GROUP_IDS}
      selection={selection}
      onChange={(groupId, next) => setSelection((prev) => ({ ...prev, [groupId]: next }))}
      locale="ru"
    />
  )
}

async function render(node: React.ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(node) })
  return { container, root }
}

const q = (c: HTMLElement, s: string) => {
  const el = c.querySelector<HTMLElement>(s)
  if (!el) throw new Error(`missing ${s}`)
  return el
}

describe('summarizeSelection / nextGroupId', () => {
  it('lists chosen labels in catalogue order', () => {
    expect(mod.summarizeSelection('role', ['founder', 'student'], 'ru')).toEqual(['Студент', 'Основатель / предприниматель'])
    expect(mod.summarizeSelection('role', [], 'en')).toEqual([])
  })
  it('returns the following group or null at the end', () => {
    expect(mod.nextGroupId(BUBBLE_GROUP_IDS, 'role')).toBe(BUBBLE_GROUP_IDS[1])
    expect(mod.nextGroupId(BUBBLE_GROUP_IDS, BUBBLE_GROUP_IDS[BUBBLE_GROUP_IDS.length - 1])).toBeNull()
  })
})

describe('InterestAccordion', () => {
  it('opens only the first group and keeps collapsed chips mounted', async () => {
    const { container, root } = await render(<Harness />)
    const open = container.querySelectorAll('[data-state="open"]')
    expect(open.length).toBe(1)
    expect(q(container, `[data-testid="interest-accordion-header-${BUBBLE_GROUP_IDS[0]}"]`).getAttribute('aria-expanded')).toBe('true')
    // Collapsed bodies are hidden but present (selection/ranking keep working).
    expect(container.querySelector('[data-testid="interest-bubbles-deepInterests"]')).not.toBeNull()
    await act(async () => { root.unmount() })
  })

  it('keeps the group open on a chip click, then «Далее» advances and summarises', async () => {
    const { container, root } = await render(<Harness />)
    await act(async () => { q(container, '[data-testid="interest-accordion-role"] [data-bubble-id="student"]').click() })
    expect(q(container, '[data-testid="interest-accordion-role"]').dataset.state).toBe('open')
    await act(async () => { q(container, '[data-testid="interest-accordion-next-role"]').click() })
    expect(q(container, '[data-testid="interest-accordion-role"]').dataset.state).toBe('closed')
    expect(q(container, `[data-testid="interest-accordion-${BUBBLE_GROUP_IDS[1]}"]`).dataset.state).toBe('open')
    expect(q(container, '[data-testid="interest-accordion-summary-role"]').textContent).toBe('Студент')
    await act(async () => { root.unmount() })
  })

  it('shows the empty summary and toggles via the header', async () => {
    const { container, root } = await render(<Harness />)
    const second = BUBBLE_GROUP_IDS[1]
    expect(q(container, `[data-testid="interest-accordion-summary-${second}"]`).textContent).toBe('onboarding.bubbles.summaryEmpty')
    await act(async () => { q(container, `[data-testid="interest-accordion-header-${second}"]`).click() })
    expect(q(container, `[data-testid="interest-accordion-${second}"]`).dataset.state).toBe('open')
    expect(q(container, '[data-testid="interest-accordion-role"]').dataset.state).toBe('closed')
    await act(async () => { root.unmount() })
  })

  it('roves focus between headers with arrow keys', async () => {
    const { container, root } = await render(<Harness />)
    const first = q(container, `[data-testid="interest-accordion-header-${BUBBLE_GROUP_IDS[0]}"]`)
    first.focus()
    await act(async () => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(document.activeElement).toBe(q(container, `[data-testid="interest-accordion-header-${BUBBLE_GROUP_IDS[1]}"]`))
    await act(async () => { (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })) })
    expect(document.activeElement).toBe(q(container, `[data-testid="interest-accordion-header-${BUBBLE_GROUP_IDS[BUBBLE_GROUP_IDS.length - 1]}"]`))
    await act(async () => { (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(document.activeElement).toBe(first)
    await act(async () => { root.unmount() })
  })
})
