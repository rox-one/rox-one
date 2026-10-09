// Keep the polyfill + mock imports first: renderer modules read
// `window.electronAPI.*` at module-load time and need the mock in place.
import './playground-polyfills'
import './playground/mock-utils'

import * as React from 'react'
import { useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { setupI18n } from '@rox/shared/i18n'
import { initReactI18next } from 'react-i18next'
import { createDomNotes, createDomSessionRows } from './perf/dom-fixtures'
import { DOM_PERF_FIXTURE } from './perf/dom-budgets'
import type { RoxPerfDomProbe, RoxPerfDomWarmup } from './perf/dom-probe'
import { NotesPanel, SessionPanel } from './perf/dom-scenario'
import './index.css'

setupI18n([initReactI18next])

/**
 * Chromium DOM performance fixture entry (W3.4c).
 *
 * Mounts the real session-list and notes-navigator primitives against large
 * fixtures and exposes a probe object the Playwright spec drives to measure
 * first render, scroll and switch timings. Nothing here runs in the production
 * app bundle: `perf-dom.html` is a dev-server-only entry.
 *
 * The initial mount is treated as a warm-up (module eval, JIT, first layout of
 * a fresh heap) and is NOT gated; the spec gates the warm repeat mounts, which
 * is what a returning user actually experiences.
 */

const sessionRows = createDomSessionRows(DOM_PERF_FIXTURE.sessionRows)
const notesFixture = createDomNotes(DOM_PERF_FIXTURE.vaultNotes)

function resolveContainer(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (!element) throw new Error(`perf DOM fixture is missing #${id}`)
  return element
}

const sessionsEl = resolveContainer('perf-sessions')
const notesEl = resolveContainer('perf-notes')
/**
 * `#perf-notes` itself scrolls (`height: 100vh; overflow: auto` in
 * `perf-dom.html`), exactly like the notes list viewport the app passes to the
 * navigator — so the fixture hands it over as the windowing viewport instead of
 * mounting the whole 5,000-note tree.
 */
const notesViewportRef: React.RefObject<HTMLDivElement | null> = { current: notesEl as HTMLDivElement }

let sessionsRoot: Root | null = null
let notesRoot: Root | null = null

function unmountAll(): void {
  sessionsRoot?.unmount()
  notesRoot?.unmount()
  sessionsRoot = null
  notesRoot = null
  sessionsEl.replaceChildren()
  notesEl.replaceChildren()
}

function mountSessions(variant: 'virtualized' | 'unvirtualized'): Promise<number> {
  const { promise, resolve } = Promise.withResolvers<number>()
  const started = performance.now()
  sessionsRoot = createRoot(sessionsEl)
  sessionsRoot.render(
    <SessionPanel rows={sessionRows} variant={variant} onReady={() => resolve(performance.now() - started)} />,
  )
  return promise
}

function NotesHarness({ onReady }: { onReady: () => void }) {
  const [active, setActive] = useState<string | null>(null)
  return (
    <NotesPanel notes={notesFixture} activeNoteId={active} onOpenNote={setActive} viewportRef={notesViewportRef} onReady={onReady} />
  )
}

function mountNotes(): Promise<number> {
  const { promise, resolve } = Promise.withResolvers<number>()
  const started = performance.now()
  notesRoot = createRoot(notesEl)
  notesRoot.render(<NotesHarness onReady={() => resolve(performance.now() - started)} />)
  return promise
}

function nextFrame(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  requestAnimationFrame(() => resolve())
  return promise
}

async function scrollSessions(steps: number): Promise<number[]> {
  const viewport = sessionsEl.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
  if (!viewport) throw new Error('session list viewport not found')
  const max = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
  const durations: number[] = []
  // First step warms the virtualizer's windowed re-render; not recorded.
  for (let i = 0; i <= steps; i++) {
    const target = (max * i) / steps
    const started = performance.now()
    viewport.scrollTop = target
    await nextFrame()
    if (i > 0) durations.push(performance.now() - started)
  }
  return durations
}

async function switchNotes(steps: number): Promise<number[]> {
  const buttons = Array.from(notesEl.querySelectorAll<HTMLElement>('[data-note-id]'))
  if (buttons.length === 0) throw new Error('notes navigator rows not found')
  const durations: number[] = []
  // First click warms the sidebar re-render; not recorded.
  for (let i = 0; i <= steps; i++) {
    const button = buttons[Math.floor((i * buttons.length) / (steps + 1))]
    if (!button) continue
    const started = performance.now()
    button.click()
    await nextFrame()
    if (i > 0) durations.push(performance.now() - started)
  }
  return durations
}

const warmup: RoxPerfDomWarmup = { sessions: 0, notes: 0 }

async function initialMount(): Promise<void> {
  unmountAll()
  warmup.sessions = await mountSessions('virtualized')
  warmup.notes = await mountNotes()
}

async function remount(iterations: number): Promise<{ sessions: number[]; notes: number[] }> {
  const sessions: number[] = []
  const notes: number[] = []
  for (let i = 0; i < iterations; i++) {
    unmountAll()
    sessions.push(await mountSessions('virtualized'))
    notes.push(await mountNotes())
  }
  return { sessions, notes }
}

async function measureUnvirtualizedSessions(): Promise<number> {
  sessionsRoot?.unmount()
  sessionsRoot = null
  sessionsEl.replaceChildren()
  return mountSessions('unvirtualized')
}

const probe: RoxPerfDomProbe = {
  fixture: { sessionRows: DOM_PERF_FIXTURE.sessionRows, vaultNotes: DOM_PERF_FIXTURE.vaultNotes },
  warmup,
  remount,
  measureUnvirtualizedSessions,
  scrollSessions,
  switchNotes,
}
window.__ROX_PERF_DOM__ = probe

void initialMount()