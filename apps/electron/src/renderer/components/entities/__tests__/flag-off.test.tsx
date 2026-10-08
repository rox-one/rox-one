/**
 * W1-08 (#1505) — flag-off inertness.
 *
 * With `entities.previews.v1` off (the default) — or on without
 * `entities.links.v1` — nothing fetches, no hover card can open, Tasks shows
 * no backlinks panel and Notes loads no entity nodes.
 */
import { flush, mount, renderMarkup, resetDom, testWindow, wait, setupEntityTestEnv } from './test-env'
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
  getEntityUiFlags,
  resolveEntityUiFlags,
} from '../flags'
import { __resetEntitiesLinksSyncForTests, applyEntitiesLinksEffectiveState, seedEntitiesLinksGate } from '../../../lib/entities-links-sync'
import { setEntityDataSource, type EntityDataSource } from '../entity-data-source'
import { resetEntityPreviewStores } from '../use-entity-preview'
import { EntityWorkspaceContext } from '../entity-context'
import { featureEntitiesLinksV1Atom } from '../../../atoms/entities-links'
import { openEntity } from '../open-entity'
import { NAVIGATE_EVENT } from '../../../lib/navigate'

setupEntityTestEnv()

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
  __resetEntitiesLinksSyncForTests()
  setEntityDataSource(null)
  resetEntityPreviewStores()
  resetDom()
})

const TASK: EntityRef = { kind: 'task', id: '42' }

/** React synthesises pointerenter from pointerover. */
async function hover(element: Element) {
  await act(async () => { element.dispatchEvent(new testWindow.PointerEvent('pointerover', { bubbles: true }) as unknown as Event) })
}

/**
 * `links` is the saved toggle; `envOverride` simulates main's answer under
 * `CRAFT_FEATURE_ENTITIES_LINKS` (the renderer gates on the effective state).
 */
function withFlags(node: React.ReactNode, flags: { links: boolean; previews: boolean; envOverride?: boolean }) {
  const store = createStore()
  store.set(entitiesLinksRequestedAtom, flags.links)
  store.set(entitiesPreviewsRequestedAtom, flags.previews)
  applyEntitiesLinksEffectiveState({ enabled: flags.envOverride ?? flags.links, persisted: flags.links, envOverride: flags.envOverride })
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
    // #1499's renderer atom, not a second copy (one source of truth per session).
    expect(entitiesLinksRequestedAtom).toBe(featureEntitiesLinksV1Atom)
    expect(getEntityUiFlags(false)).toEqual({ links: false, previews: false })
    expect(getEntityUiFlags(true)).toEqual({ links: false, previews: false })
  })

  it('previews follow the EFFECTIVE links state, not the saved toggle (owner decision, fix8)', () => {
    // Saved links toggle on, env forces links off → previews off.
    applyEntitiesLinksEffectiveState({ enabled: false, persisted: true, envOverride: false })
    expect(getEntityUiFlags(true)).toEqual({ links: false, previews: false })
    // Saved links toggle off, env forces links on → the previews toggle decides.
    applyEntitiesLinksEffectiveState({ enabled: true, persisted: false, envOverride: true })
    expect(getEntityUiFlags(true)).toEqual({ links: true, previews: true })
    expect(getEntityUiFlags(false)).toEqual({ links: true, previews: false })
    // No override: the saved toggle is the effective state.
    applyEntitiesLinksEffectiveState({ enabled: true, persisted: true, envOverride: undefined })
    expect(getEntityUiFlags(true)).toEqual({ links: true, previews: true })
    applyEntitiesLinksEffectiveState({ enabled: false, persisted: false, envOverride: undefined })
    expect(getEntityUiFlags(true)).toEqual({ links: false, previews: false })
  })

  it('main forcing links off at seed time disables previews although both saved toggles are on', () => {
    testWindow.localStorage.setItem(ENTITIES_LINKS_STORAGE_KEY, 'true')
    const api = (testWindow as unknown as { electronAPI?: unknown }).electronAPI
    ;(testWindow as unknown as { electronAPI?: unknown }).electronAPI = {
      syncEntitiesLinksState: (persisted: boolean) => ({ enabled: false, persisted, envOverride: false }),
    }
    try {
      expect(seedEntitiesLinksGate()).toEqual({ enabled: false, persisted: true, envOverride: false })
      expect(getEntityUiFlags(true)).toEqual({ links: false, previews: false })
    } finally {
      ;(testWindow as unknown as { electronAPI?: unknown }).electronAPI = api
    }
  })
})

describe('inert when off', () => {
  const offCases: Array<{ links: boolean; previews: boolean; envOverride?: boolean }> = [
    { links: false, previews: false },
    { links: false, previews: true },
    { links: true, previews: false },
    // Env forces links off while both saved toggles are on (owner decision, fix8).
    { links: true, previews: true, envOverride: false },
  ]
  for (const flags of offCases) {
    const name = `links=${flags.links} previews=${flags.previews}${flags.envOverride === undefined ? '' : ` env=${flags.envOverride}`}`

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
      expect(html).not.toContain('data-entity-status="unavailable"')
      expect(html).toContain('data-entity-status="idle"')
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
  for (const flags of [{ links: true, previews: true }, { links: false, previews: true, envOverride: true }]) {
  it(`chip resolves, hover card opens after 300 ms, Tasks shows the panel (links=${flags.links}${flags.envOverride ? ' env=true' : ''})`, async () => {
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
  }
})

describe('openEntity follows the entities.links.v1 route gate', () => {
  it('kind-first entity routes navigate only while links is effectively on; legacy routes always', () => {
    const routes: string[] = []
    const listener = (event: Event) => { routes.push((event as CustomEvent<{ route: string }>).detail.route) }
    testWindow.addEventListener(NAVIGATE_EVENT, listener as never)
    try {
      applyEntitiesLinksEffectiveState({ enabled: false, persisted: true, envOverride: false })
      expect(openEntity({ kind: 'goal', id: 'g-1' })).toBe(false)
      expect(openEntity(TASK)).toBe(true)
      applyEntitiesLinksEffectiveState({ enabled: true, persisted: true, envOverride: undefined })
      expect(openEntity({ kind: 'goal', id: 'g-1' })).toBe(true)
    } finally {
      testWindow.removeEventListener(NAVIGATE_EVENT, listener as never)
    }
    expect(routes).toEqual(['tasks/task/42', 'goals/goal/g-1'])
  })
})
