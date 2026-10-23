// happy-dom globals first: react-dom feature-detects `document` at load time.
import { useDomForFile, resetDom } from '../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { useRailState as UseRailState } from '../ActivityRail'

useDomForFile()

let useRailState: typeof UseRailState
beforeAll(async () => {
  ;({ useRailState } = await import('../ActivityRail'))
})

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  resetDom()
})

function mount() {
  const committed: string[] = []
  const rendered: Array<[boolean, string]> = []
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  function Probe({ collapsed }: { collapsed: boolean }) {
    const state = useRailState(collapsed)
    rendered.push([collapsed, state])
    return createElement('nav', { 'data-rail-state': state })
  }
  const render = (collapsed: boolean) => {
    act(() => root!.render(createElement(Probe, { collapsed })))
    committed.push(container.querySelector('nav')!.getAttribute('data-rail-state')!)
  }
  return { render, committed, container, rendered }
}

describe('useRailState', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  it('mounting expanded never animates', () => {
    const { render, committed } = mount()
    render(false)
    expect(committed).toEqual(['expanded'])
  })

  it('the first committed frame after collapsed -> expanded is already expanding', () => {
    const { render, committed, container, rendered } = mount()
    render(true)
    const observer = new MutationObserver(() => {})
    observer.observe(container, { attributes: true, attributeOldValue: true, subtree: true })
    render(false)
    const oldValues = observer.takeRecords().map((r) => r.oldValue)
    observer.disconnect()
    expect(committed).toEqual(['collapsed', 'expanding'])
    // No intermediate `expanded` commit before `expanding`.
    expect(oldValues).toEqual(['collapsed'])
    // The very first render with collapsed=false (the frame that mounts the
    // labels) already returns `expanding`.
    expect(rendered.find(([c]) => !c)?.[1]).toBe('expanding')
  })

  it('settles to expanded after the disclosure and collapses immediately', async () => {
    const { render, container } = mount()
    render(true)
    render(false)
    await act(async () => { await new Promise((r) => setTimeout(r, 450)) })
    expect(container.querySelector('nav')!.getAttribute('data-rail-state')).toBe('expanded')
    render(true)
    expect(container.querySelector('nav')!.getAttribute('data-rail-state')).toBe('collapsed')
  })
})
