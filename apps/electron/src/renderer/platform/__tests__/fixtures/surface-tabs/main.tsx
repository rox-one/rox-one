import React from 'react'
import { createRoot } from 'react-dom/client'
import { createStore, Provider, useAtomValue } from 'jotai'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { SurfaceTabs } from '@/platform/SurfaceTabs'
import { panelStackAtom, focusedPanelIdAtom, type PanelStackEntry } from '@/atoms/panel-stack'
import { topBarSurfaceTabsSlotAtom } from '@/atoms/unified-shell'
import { workspaceAtom } from './context'
import en from '../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '../../../../index.css'

await i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, keySeparator: false, interpolation: { escapeValue: false } })
const store = createStore()
const entries: PanelStackEntry[] = [
  { id: 'one', route: 'notes', proportion: 1, panelType: 'other', laneId: 'main' },
  { id: 'two', route: 'tasks', proportion: 1, panelType: 'other', laneId: 'main' },
  { id: 'three', route: 'knowledge/document/n1', proportion: 1, panelType: 'knowledge', laneId: 'main' },
]
store.set(panelStackAtom, entries)
store.set(focusedPanelIdAtom, 'one')
const mode = new URLSearchParams(location.search).get('mode')
const reads: Array<{ workspaceId: string; ref: { id: string } }> = []
const pending: Array<(value: { title: string }) => void> = []
let failed = false
;(window as any).electronAPI = { knowledge: {
  listConnections: async () => [{ id: 'native-journal' }],
  get: async (input: { workspaceId: string; ref: { id: string } }) => {
    reads.push(input)
    if (mode === 'fail' && !failed) { failed = true; throw Error('offline') }
    if (mode === 'pending') return new Promise(resolve => pending.push(resolve))
    return { title: input.workspaceId === 'a' ? 'Resolved note' : 'Other workspace' }
  },
} }
;(window as any).__tabsFixture = {
  reads, refresh: () => store.set(panelStackAtom, [...store.get(panelStackAtom)]),
  resolve: (index: number, title: string) => pending[index]?.({ title }),
  workspace: (id: string) => store.set(workspaceAtom, id),
  focus: (id: string) => store.set(focusedPanelIdAtom, id),
  hiddenBrowser: () => {
    store.set(panelStackAtom, [...store.get(panelStackAtom), { id: 'browser', route: 'browser/instance/hidden', proportion: 1, panelType: 'browser', laneId: 'main' }])
    store.set(focusedPanelIdAtom, 'browser')
  },
  portal: (enabled: boolean) => store.set(topBarSurfaceTabsSlotAtom, enabled ? document.getElementById('topbar') : null),
}
function Fixture() {
  const focused = useAtomValue(focusedPanelIdAtom)
  return <main className="bg-background p-4 text-foreground"><div id="topbar" /><SurfaceTabs /><p data-testid="focused">{focused}</p><input aria-label="Editor" defaultValue="Unsent draft" /></main>
}
createRoot(document.getElementById('root')!).render(<Provider store={store}><Fixture /></Provider>)
