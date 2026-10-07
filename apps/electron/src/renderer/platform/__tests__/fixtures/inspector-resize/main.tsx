import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { createStore, Provider, useAtomValue } from 'jotai'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { TooltipProvider } from '@rox/ui'
import { InspectorHost } from '@/platform/InspectorHost'
import { focusedPanelIdAtom, panelStackAtom } from '@/atoms/panel-stack'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import {
  featureWorkbenchHarnessInspectorV1Atom,
  inspectorChromeCollapsedAtom,
  inspectorPanelWidthAtom,
  inspectorSectionAtom,
  inspectorVisibleAtom,
} from '@/atoms/unified-shell'
import { routes } from '../../../../../shared/routes'
import { getKeyString, KEYS } from '@/lib/local-storage'
import en from '../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '../../../../index.css'
await i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, keySeparator: false })
const FIXTURE_SESSION_ID = 'fixture-session'
const FIXTURE_PANEL_ID = 'fixture-panel'
if (typeof localStorage !== 'undefined') {
  localStorage.setItem(getKeyString(KEYS.inspectorVisible), JSON.stringify(true))
  localStorage.setItem(getKeyString(KEYS.featureWorkbenchHarnessInspectorV1), JSON.stringify(true))
  localStorage.setItem(getKeyString(KEYS.inspectorPanelWidth), JSON.stringify(320))
  localStorage.setItem(getKeyString(KEYS.inspectorChromeCollapsed), JSON.stringify(false))
}
const store = createStore()
store.set(inspectorVisibleAtom, true)
store.set(inspectorChromeCollapsedAtom, false)
store.set(featureWorkbenchHarnessInspectorV1Atom, true)
store.set(inspectorSectionAtom, 'git')
store.set(
  sessionMetaMapAtom,
  new Map([
    [
      FIXTURE_SESSION_ID,
      {
        id: FIXTURE_SESSION_ID,
        workspaceId: 'synthetic-workspace',
        workingDirectory: '/tmp/fixture-workspace',
      },
    ],
  ]),
)
store.set(panelStackAtom, [
  {
    id: FIXTURE_PANEL_ID,
    route: routes.view.allSessions(FIXTURE_SESSION_ID),
    proportion: 1,
    panelType: 'session',
    laneId: 'main',
  },
])
store.set(focusedPanelIdAtom, FIXTURE_PANEL_ID)
if (typeof window !== 'undefined') {
  window.electronAPI = {
    ...(window.electronAPI ?? {}),
    getSessionFiles: async () => [{ type: 'file', path: 'readme.md' }],
  } as typeof window.electronAPI
}
let mount: (value: boolean) => void
const fixtureApi = {
  width: () => store.get(inspectorPanelWidthAtom),
  keyPreviewAndCancel: (cancel: string) => {
    const sash = document.querySelector<HTMLElement>('[role="separator"]')!
    flushSync(() => sash.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
    const preview = sash.getAttribute('aria-valuenow'), persisted = store.get(inspectorPanelWidthAtom)
    flushSync(() => cancel === 'blur' ? window.dispatchEvent(new Event('blur')) : sash.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    return { preview, persisted, cancelled: sash.getAttribute('aria-valuenow'), saved: store.get(inspectorPanelWidthAtom) }
  },
  persisted: () => localStorage.getItem(getKeyString(KEYS.inspectorPanelWidth)),
  mount: (value: boolean) => mount(value),
  visible: (value: boolean) => store.set(inspectorVisibleAtom, value),
}
function Fixture() {
  const [mounted, setMounted] = useState(true)
  const [ready, setReady] = useState(false)
  mount = setMounted
  const width = useAtomValue(inspectorPanelWidthAtom)
  useEffect(() => {
    ;(window as any).__inspectorFixture = fixtureApi
    document.documentElement.dataset.inspectorFixtureReady = 'true'
    setReady(true)
  }, [])
  return <main className="flex h-[500px] w-full bg-background text-foreground" data-inspector-fixture-ready={ready ? 'true' : undefined}><div data-panel-role="content" className="min-w-0 flex-1"><input aria-label="Editor" defaultValue="Unsent draft" /><output data-testid="persisted-width">{width}</output></div>{mounted && <InspectorHost />}</main>
}
createRoot(document.getElementById('root')!).render(<Provider store={store}><TooltipProvider><Fixture /></TooltipProvider></Provider>)
