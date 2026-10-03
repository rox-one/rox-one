import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { atom, createStore } from 'jotai'
import { elementIn, leafComponent } from './rox-readiness-ui-001.leaf-harness'

const source = new URL('../../../pages/TerminalSurfacePage.tsx', import.meta.url)

function terminalHost(terminalId: string | null) {
  const store = createStore()
  const bottomTerminalOpenAtom = atom(false)
  const Component = leafComponent(source, 'TerminalSurfacePage', {
    React: { ...React, useCallback: (fn: unknown) => fn }, useTranslation: () => ({ t: (key: string) => key }),
    bottomTerminalOpenAtom, useSetAtom: (target: typeof bottomTerminalOpenAtom) => (value: boolean) => store.set(target, value),
    InspectorTerminal: () => { throw new Error('Unrelated shell must never mount for an unresolved terminal ID') },
  })
  return { tree: Component({ terminalId }), store, bottomTerminalOpenAtom }
}

describe('UI-001 terminal address authority', () => {
  it('unsupported or deleted explicit terminal IDs are unavailable without an unrelated shell', () => {
    const host = terminalHost('deleted-terminal-A')
    expect(host.tree.props['data-terminal-surface']).toBe('unavailable')
    expect(host.tree.props['data-terminal-id']).toBe('deleted-terminal-A')
    expect(elementIn(host.tree, (element) => typeof element.type !== 'string')).toBeUndefined()
    expect(host.store.get(host.bottomTerminalOpenAtom)).toBe(false)
  })

  it('bare terminal preserves the ordinary dock workflow through the actual callback', () => {
    const host = terminalHost(null)
    expect(host.tree.props['data-terminal-surface']).toBe('empty')
    const open = elementIn(host.tree, (element) => element.props['data-terminal-surface-open-dock'] === 'true')
    expect(open).toBeDefined()
    open!.props.onClick()
    expect(host.store.get(host.bottomTerminalOpenAtom)).toBe(true)
  })

  it('an unavailable selected address offers the explicit existing dock action', () => {
    const host = terminalHost('terminal-old')
    const open = elementIn(host.tree, (element) => element.props['data-terminal-surface-open-dock'] === 'true')
    expect(open).toBeDefined()
    open!.props.onClick()
    expect(host.store.get(host.bottomTerminalOpenAtom)).toBe(true)
    expect(host.tree.props['data-terminal-id']).toBe('terminal-old')
  })
})
