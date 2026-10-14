/** Split view: only the sidebar owner is a SCREEN; every other panel is a bare PANEL (no second sidebar, no duplicated titles). */
import { afterEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { BarePanelContext, ShellSidebarContext, ShellSidebarPortal, useDedupedPanelTitle, useSidebarHandledOutside } from '../ShellSidebarPortal'

// eslint-disable-next-line react-hooks/rules-of-hooks -- test DOM environment setup, not a React hook
useDomForFile()

let root: Root | null = null
afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.innerHTML = ''
})

function Title({ value }: { value: string }) {
  const shown = useDedupedPanelTitle(value)
  return <h2 data-testid="title">{shown ?? ''}</h2>
}

function Handled() {
  return <span data-testid="handled">{String(useSidebarHandledOutside())}</span>
}

async function render(node: React.ReactNode) {
  const host = document.createElement('div')
  document.body.append(host)
  await act(async () => { root = createRoot(host); root.render(node) })
  return host
}

describe('split panels without a second sidebar', () => {
  it('the owner screen portals its nav into the shared slot; a bare panel renders no nav at all', async () => {
    const slot = document.createElement('div')
    document.body.append(slot)
    const host = await render(
      <ShellSidebarContext.Provider value={slot}>
        <ShellSidebarPortal>sessions-tree</ShellSidebarPortal>
        <ShellSidebarContext.Provider value={null}>
          <BarePanelContext.Provider value={{ title: 'Входящие' }}>
            <ShellSidebarPortal data-testid="inbox-nav">inbox-tree</ShellSidebarPortal>
          </BarePanelContext.Provider>
        </ShellSidebarContext.Provider>
      </ShellSidebarContext.Provider>,
    )
    expect(slot.textContent).toBe('sessions-tree')
    expect(host.textContent).not.toContain('inbox-tree')
    expect(host.querySelector('[data-panel-secondary]')).toBeNull()
  })

  it('without bare context the inline fallback still renders (single window, retained surfaces)', async () => {
    const host = await render(<ShellSidebarPortal>inline-tree</ShellSidebarPortal>)
    expect(host.querySelector('[data-panel-secondary]')?.textContent).toBe('inline-tree')
  })

  it('suppresses a heading that repeats the tile title, keeps others', async () => {
    const host = await render(
      <BarePanelContext.Provider value={{ title: 'Входящие' }}>
        <Title value="Входящие" />
      </BarePanelContext.Provider>,
    )
    expect(host.textContent).toBe('')
    act(() => root!.render(
      <BarePanelContext.Provider value={{ title: 'Входящие' }}>
        <Title value="Письмо от Анны" />
      </BarePanelContext.Provider>,
    ))
    expect(host.textContent).toBe('Письмо от Анны')
  })

  it('layouts treat a bare panel as having its navigation handled outside', async () => {
    const host = await render(<><Handled /><BarePanelContext.Provider value={{ title: null }}><Handled /></BarePanelContext.Provider></>)
    expect(Array.from(host.querySelectorAll('[data-testid="handled"]')).map(el => el.textContent)).toEqual(['false', 'true'])
  })
})
