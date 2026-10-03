import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { createStore, Provider, useAtomValue } from 'jotai'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { TooltipProvider } from '@rox/ui'
import { InspectorHost } from '@/platform/InspectorHost'
import { inspectorPanelWidthAtom, inspectorVisibleAtom, inspectorChromeCollapsedAtom } from '@/atoms/unified-shell'
import { getKeyString, KEYS } from '@/lib/local-storage'
import en from '../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '../../../../index.css'
await i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, keySeparator: false })
const store = createStore()
store.set(inspectorVisibleAtom, true)
store.set(inspectorChromeCollapsedAtom, false)
let mount: (value: boolean) => void
;(window as any).__inspectorFixture = {
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
  mount = setMounted
  const width = useAtomValue(inspectorPanelWidthAtom)
  return <main className="flex h-[500px] w-full bg-background text-foreground"><div data-panel-role="content" className="min-w-0 flex-1"><input aria-label="Editor" defaultValue="Unsent draft" /><output data-testid="persisted-width">{width}</output></div>{mounted && <InspectorHost />}</main>
}
createRoot(document.getElementById('root')!).render(<Provider store={store}><TooltipProvider><Fixture /></TooltipProvider></Provider>)
