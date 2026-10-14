import { afterEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Provider, createStore, useAtomValue } from 'jotai'
import { useDomForFile } from '../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { sessionMetaByIdAtom, sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'

useDomForFile()

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  root = null
  host = null
})

function meta(id: string): SessionMeta {
  return { id, workspaceId: 'w', name: id }
}

describe('sessionMetaByIdAtom', () => {
  it('does not re-render a consumer of session A when session B meta updates', async () => {
    const store = createStore()
    store.set(sessionMetaMapAtom, new Map<string, SessionMeta>([['a', meta('a')], ['b', meta('b')]]))
    let rendersA = 0
    function Consumer() {
      const value = useAtomValue(sessionMetaByIdAtom('a'))
      rendersA++
      return <span>{value?.name}</span>
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    await act(async () => {
      root = createRoot(host!)
      root.render(<Provider store={store}><Consumer /></Provider>)
    })
    const afterMount = rendersA
    await act(async () => {
      const next = new Map(store.get(sessionMetaMapAtom))
      next.set('b', { ...meta('b'), name: 'b-updated' })
      store.set(sessionMetaMapAtom, next)
    })
    expect(rendersA).toBe(afterMount)
    expect(host!.textContent).toBe('a')
  })
})

describe('FeedPage meta refetch', () => {
  it('does not schedule a 1500ms refetch timer', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(import.meta.dir, '../../pages/FeedPage.tsx'), 'utf8')
    expect(src).not.toMatch(/setTimeout\(\s*\(\)\s*=>\s*void load\(\),\s*1500\)/)
    expect(src).toMatch(/onFeedChanged/)
  })
})
