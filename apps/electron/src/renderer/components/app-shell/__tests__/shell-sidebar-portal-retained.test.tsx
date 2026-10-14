/** WP6: a kept-alive (inactive) surface never portals its nav into the shared sidebar slot. */
import { afterEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { SurfaceActiveProvider } from '@/lib/surface-keepalive'
import { ShellSidebarContext, ShellSidebarPortal } from '../ShellSidebarPortal'

// eslint-disable-next-line react-hooks/rules-of-hooks -- test DOM environment setup, not a React hook
useDomForFile()

let root: Root | null = null
afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('ShellSidebarPortal + retained surfaces', () => {
  it('only the active surface fills the slot (Notes no longer shows the Входящие tree)', async () => {
    const slot = document.createElement('div')
    const host = document.createElement('div')
    document.body.append(slot, host)
    await act(async () => {
      root = createRoot(host)
      root.render(
        <ShellSidebarContext.Provider value={slot}>
          <SurfaceActiveProvider active={false}><ShellSidebarPortal>inbox-tree</ShellSidebarPortal></SurfaceActiveProvider>
          <SurfaceActiveProvider active><ShellSidebarPortal>notes-tree</ShellSidebarPortal></SurfaceActiveProvider>
        </ShellSidebarContext.Provider>,
      )
    })
    expect(slot.textContent).toBe('notes-tree')
    expect(host.textContent).toContain('inbox-tree') // inline in its hidden pane
  })
})
