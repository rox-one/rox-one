import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BUBBLE_GROUP_IDS, BUBBLE_GROUPS, type BubbleGroupId } from '../bubbles-catalog'
import type { InterestBubbles as InterestBubblesComponent } from '../InterestBubbles'

useDomForFile()

// The component only reads `t` and `i18n.language`; stub both so it renders
// under Bun without booting the full i18n stack.
mock.module('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

let InterestBubbles: typeof InterestBubblesComponent

// Static import cannot work: the component graph resolves `react-i18next`, so
// the mock below must be registered before the module is loaded.
beforeAll(async () => {
  ({ InterestBubbles } = await import('../InterestBubbles'))
})

afterEach(() => { resetDom() })

async function render(node: React.ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(node) })
  return { container, root }
}

async function unmount(root: Root): Promise<void> {
  await act(async () => { root.unmount() })
}

function chipOf(container: HTMLElement, id: string): HTMLButtonElement {
  const chip = container.querySelector<HTMLButtonElement>(`button[role="checkbox"][data-bubble-id="${id}"]`)
  if (!chip) throw new Error(`bubble not rendered: ${id}`)
  return chip
}

function orderOf(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]'))
    .map((chip) => chip.dataset.bubbleId ?? '')
}

/** Selection lives in the parent, so the harness owns it like the wizard will. */
function Harness({
  groupId,
  initial = [],
  rankedIds,
  locale,
  onChange,
}: {
  groupId: BubbleGroupId
  initial?: string[]
  rankedIds?: string[]
  locale?: 'ru' | 'en'
  onChange?: (next: string[]) => void
}) {
  const [selected, setSelected] = useState<string[]>(initial)
  return (
    <InterestBubbles
      groupId={groupId}
      selected={selected}
      rankedIds={rankedIds}
      locale={locale}
      onChange={(next) => { onChange?.(next); setSelected(next) }}
    />
  )
}

describe('bubbles-catalog', () => {
  it('exposes six groups of exactly 15 unique items', () => {
    expect(BUBBLE_GROUP_IDS).toHaveLength(6)
    for (const groupId of BUBBLE_GROUP_IDS) {
      const group = BUBBLE_GROUPS[groupId]
      expect(group.items).toHaveLength(15)
      expect(new Set(group.items.map((item) => item.id)).size).toBe(15)
      for (const item of group.items) {
        expect(item.ru.length).toBeGreaterThan(0)
        expect(item.en.length).toBeGreaterThan(0)
      }
    }
  })

  it('hints that deep interests depend on professional interests', () => {
    expect(BUBBLE_GROUPS.deepInterests.dependsOn).toBe('professionalInterests')
  })
})

describe('InterestBubbles', () => {
  it('selects an unselected bubble and deselects a selected one', async () => {
    const calls: string[][] = []
    const { container, root } = await render(
      <Harness groupId="careerGoals" onChange={(next) => calls.push(next)} />,
    )

    expect(chipOf(container, 'higherIncome').getAttribute('aria-checked')).toBe('false')

    await act(async () => { chipOf(container, 'higherIncome').click() })
    expect(chipOf(container, 'higherIncome').getAttribute('aria-checked')).toBe('true')
    expect(calls).toEqual([['higherIncome']])

    await act(async () => { chipOf(container, 'remoteWork').click() })
    expect(chipOf(container, 'remoteWork').getAttribute('aria-checked')).toBe('true')
    expect(calls[1]).toEqual(['higherIncome', 'remoteWork'])

    await act(async () => { chipOf(container, 'higherIncome').click() })
    expect(chipOf(container, 'higherIncome').getAttribute('aria-checked')).toBe('false')
    expect(calls[2]).toEqual(['remoteWork'])

    await unmount(root)
  })

  it('keeps selected bubbles visible and checked when deep interests are re-ranked', async () => {
    const { container, root } = await render(
      <Harness
        groupId="deepInterests"
        initial={['aiEthics']}
        rankedIds={['openSource', 'aiEthics', 'security']}
      />,
    )

    expect(chipOf(container, 'aiEthics').getAttribute('aria-checked')).toBe('true')
    expect(orderOf(container).slice(0, 3)).toEqual(['openSource', 'aiEthics', 'security'])

    // A fresh ranking reorders the cloud but must not drop the selection.
    await act(async () => {
      root.render(<Harness groupId="deepInterests" initial={['aiEthics']} rankedIds={['security', 'openSource']} />)
    })

    expect(orderOf(container).slice(0, 2)).toEqual(['security', 'openSource'])
    expect(chipOf(container, 'aiEthics').getAttribute('aria-checked')).toBe('true')
    expect(orderOf(container)).toHaveLength(15)
    await unmount(root)
  })

  it('renders anchored deep interests even when they are not ranked', async () => {
    const { container, root } = await render(
      <Harness groupId="deepInterests" rankedIds={['security']} />,
    )
    expect(chipOf(container, 'security')).not.toBeNull()
    expect(chipOf(container, 'openSource').dataset.bubbleAnchor).toBe('true')
    expect(chipOf(container, 'climate')).not.toBeNull()
    await unmount(root)
  })

  it('renders Russian labels when the locale prop asks for them', async () => {
    const { container, root } = await render(<Harness groupId="role" locale="ru" />)
    expect(chipOf(container, 'student').textContent).toBe('Студент')
    await unmount(root)
  })
})