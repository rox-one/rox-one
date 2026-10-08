/**
 * W1-08 (#1505) — flag-off inertness.
 *
 * With `entities.previews.v1` off (the default) — or on without
 * `entities.links.v1` — nothing fetches, no hover card can open, Tasks shows
 * no backlinks panel and Notes loads no entity nodes.
 */
import { flush, mount, renderMarkup, resetDom, testWindow, wait } from './test-env'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createStore, Provider } from 'jotai'
import type { EntityRef } from '@rox/core/entities'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { EntityChip } from '../EntityChip'
import { TaskEntityBacklinks } from '../TaskEntityBacklinks'
import { useNoteEntityMentions } from '../NoteEntityMentions'
import {
  ENTITIES_LINKS_STORAGE_KEY,
  ENTITIES_PREVIEWS_STORAGE_KEY,
  entitiesLinksRequestedAtom,
  entitiesPreviewsRequestedAtom,
  entityUiFlagsAtom,
  resolveEntityUiFlags,
} from '../flags'
import { setEntityDataSource, type EntityDataSource } from '../entity-data-source'
import { resetEntityPreviewStores } from '../use-entity-preview'
import { EntityWorkspaceContext } from '../entity-context'

const calls = { resolve: 0, backlinks: 0 }
const spySource: EntityDataSource = {
  async resolve(_ws, refs) { calls.resolve++; return refs.map((ref) => ({ ref, status: 'ok' as const, title: 'T', kindLabel: 'Task', icon: 'circle-check', authority: 'local' as const, etag: 'e' })) },
  async backlinks() { calls.backlinks++; return { links: [] } },
  async search() { return [] },
  onLinksChanged() { return () => {} },
}

beforeEach(() => {
  calls.resolve = 0
  calls.backlinks = 0
  testWindow.localStorage.clear()
  setEntityDataSource(spySource)
})
afterEach(() => {
  setEntityDataSource(null)
  resetEntityPreviewStores()
  resetDom()
})

const TASK: EntityRef = { kind: 'task', id: '42' }

/** React synthesises pointerenter from pointerover. */
async function hover(element: Element) {
  await act(async () => { element.dispatchEvent(new testWindow.PointerEvent('pointerover', { bubbles: true }) as unknown as Event) })
}

function withFlags(node: React.ReactNode, flags: { links: boolean; previews: boolean }) {
  const store = createStore()
  store.set(entitiesLinksRequestedAtom, flags.links)
  store.set(entitiesPreviewsRequestedAtom, flags.previews)
  return <Provider store={store}>{node}</Provider>
}

describe('flag resolution', () => {
  it('defaults are off and previews needs links', () => {
    expect(resolveEntityUiFlags({})).toEqual({ links: false, previews: false })
    expect(resolveEntityUiFlags({ previews: true })).toEqual({ links: false, previews: false })
    expect(resolveEntityUiFlags({ links: true })).toEqual({ links: true, previews: false })
    expect(resolveEntityUiFlags({ links: true, previews: true })).toEqual({ links: true, previews: true })
  })

  it('reads craft-feature-* localStorage keys, default false', () => {
    expect(ENTITIES_PREVIEWS_STORAGE_KEY).toBe('craft-feature-entities-previews-v1')
    expect(ENTITIES_LINKS_STORAGE_KEY).toBe('craft-feature-entities-links-v1')
    const store = createStore()
    expect(store.get(entityUiFlagsAtom)).toEqual({ links: false, previews: false })
  })
})

describe('inert when off', () => {
  for (const flags of [{ links: false, previews: false }, { links: false, previews: true }, { links: true, previews: false }]) {
    const name = `links=${flags.links} previews=${flags.previews}`

    it(`EntityChip makes no resolve call and has no hover card (${name})`, async () => {
      const mounted = await mount(withFlags(
        <EntityWorkspaceContext.Provider value="ws"><EntityChip entityRef={TASK} label="Release" /></EntityWorkspaceContext.Provider>,
        flags,
      ))
      const button = mounted.container.querySelector('button')!
      await hover(button)
      await act(async () => { (button as HTMLElement).focus() })
      await wait(350)
      await flush()
      const html = document.body.innerHTML
      await mounted.unmount()
      expect(calls.resolve).toBe(0)
      expect(html).not.toContain('data-entity-hover-card')
      expect(html).toContain('Release')
    })

    it(`TaskEntityBacklinks renders nothing and fetches nothing (${name})`, async () => {
      const html = await renderMarkup(withFlags(<TaskEntityBacklinks taskId="42" workspaceId="ws" />, flags))
      expect(html).toBe('<div class="light" data-theme="light"></div>')
      const mounted = await mount(withFlags(<TaskEntityBacklinks taskId="42" workspaceId="ws" />, flags))
      await flush()
      await mounted.unmount()
      expect(calls.backlinks).toBe(0)
    })

    it(`useNoteEntityMentions returns no entity nodes and no picker (${name})`, async () => {
      let result: ReturnType<typeof useNoteEntityMentions> | null = null
      function Probe() {
        const editorRef = React.useRef(null)
        result = useNoteEntityMentions({ workspaceId: 'ws', editorRef })
        return null
      }
      const mounted = await mount(withFlags(<Probe />, flags))
      await mounted.unmount()
      expect(result!.entityNodes).toBeUndefined()
      expect(result!.picker).toBeNull()
    })
  }

  it('without entity nodes the editor keeps [[kind:id|label]] as plain text', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = new Editor({ element, extensions: [StarterKit, Markdown.configure({ html: false })], content: 'See [[task:42|Release]]' })
    const json = JSON.stringify(editor.getJSON())
    editor.destroy()
    expect(json).not.toContain('"mention"')
    expect(json).toContain('[[task:42|Release]]')
  })
})

describe('active when both flags are on (positive control)', () => {
  it('chip resolves, hover card opens after 300 ms, Tasks shows the panel', async () => {
    const flags = { links: true, previews: true }
    const mounted = await mount(withFlags(
      <EntityWorkspaceContext.Provider value="ws">
        <EntityChip entityRef={TASK} label="Release" />
        <TaskEntityBacklinks taskId="42" workspaceId="ws" />
      </EntityWorkspaceContext.Provider>,
      flags,
    ))
    await flush()
    const button = mounted.container.querySelector('button[data-entity-chip]')!
    await hover(button)
    await wait(100)
    expect(document.body.innerHTML).not.toContain('data-entity-hover-card')
    await wait(260)
    await flush()
    const html = document.body.innerHTML
    await mounted.unmount()
    expect(calls.resolve).toBe(1)
    expect(calls.backlinks).toBe(1)
    expect(html).toContain('data-entity-hover-card')
    expect(html).toContain('Упоминается в')
  })
})
