import '../../../../../apps/webui/src/browser-globals'
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { setupI18n } from '../../../../../packages/shared/src/i18n'
import { initReactI18next } from 'react-i18next'
import { ModalProvider, useModalRegistry } from '../../../../../apps/electron/src/renderer/context/ModalContext'
import { DismissibleLayerProvider, useDismissibleLayerRegistry } from '../../../../../apps/electron/src/renderer/context/DismissibleLayerContext'
import { createTargetRegistry, SpotlightOverlay } from '../../../../../apps/electron/src/renderer/features/product-tour/ui'
import type { TourBinding, TourStep, TourTargetRegistration } from '../../../../../apps/electron/src/renderer/features/product-tour/contracts'
import '../../../../../apps/electron/src/renderer/index.css'

await setupI18n([initReactI18next]).changeLanguage('en')
const registry = createTargetRegistry({ getTargetScope: () => 'bound-panel', getPreferredVariant: () => 'regular' })
const binding: TourBinding = { clientProfileId: 'profile-a', workspaceId: 'workspace-a', panelId: 'panel-a', runToken: 'run-a' }
const step: TourStep = {
  id: 'first.compose', version: 1, target: 'composer.input', routeKey: 'current-session', scope: 'bound-panel', copyKey: 'productTour.steps.first.compose',
  copy: { en: { title: 'Component fixture', body: 'Production popup with a test-only target.' }, ru: { title: 'Тест', body: 'Тест.' } },
  completion: { kind: 'signal', signal: 'draft.nonempty', evidence: 'observed', priorState: 'after-activation', requireAcknowledgementAfterEvidence: false },
  handoff: true, optional: false, requires: [], onUnavailable: 'block', missingTarget: 'block-and-offer-retry-or-pause', notes: '', testId: 'T-FIRST-COMPOSE',
}
function Harness() {
  const first = useRef<HTMLTextAreaElement>(null), second = useRef<HTMLTextAreaElement>(null)
  const [target, setTarget] = useState<TourTargetRegistration | null>(null)
  const [open, setOpen] = useState(false), [outside, setOutside] = useState(0), [paused, setPaused] = useState(''), [native, setNative] = useState(false)
  const modals = useModalRegistry(), layers = useDismissibleLayerRegistry()
  useEffect(() => {
    const targets = [first, second].map((ref, index) => ({ id: 'composer.input' as const, element: ref.current!, scope: 'bound-panel' as const, context: { workspaceId: 'workspace-a', panelId: index === 0 ? 'panel-a' : 'panel-b' }, variant: 'regular' as const, registrationToken: `target-${index}` }))
    const cleanups = targets.map(value => registry.register(value))
    ;(window as any).__productTourComponent = {
      marker: 'rox-product-tour-component-test-only', registry,
      resolve: (panelId: string) => registry.resolve('composer.input', { ...binding, panelId }),
      hide: () => { setOpen(false) }, show: () => { setTarget(targets[0]); setOpen(true) }, handoff: () => setNative(true),
      move: () => { first.current!.style.transform = 'translate(60px, 25px)'; window.dispatchEvent(new Event('resize')) },
      staleCleanup: () => { const old = registry.register({ ...targets[0], context: { ...targets[0].context, entityId: 'old' } }); registry.register({ ...targets[0], context: { ...targets[0].context, entityId: 'replacement' } }); old(); return registry.resolve('composer.input', binding) },
    }
    return () => { cleanups.forEach(cleanup => cleanup()) }
  }, [])
  useEffect(() => {
    if (!native) return
    return modals.registerModal('owned-native-handoff', () => setNative(false), 10)
  }, [native, modals])
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (modals.closeTopModal() || layers.handleEscape()) event.preventDefault()
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [modals, layers])
  return <main style={{ padding: 40, height: 1600 }}>
    <button onClick={() => (window as any).__productTourComponent.show()}>Start component tour</button>
    <div style={{ display: 'flex', gap: 120, marginTop: 100 }}>
      <textarea ref={first} aria-label="First panel draft" style={{ width: 320, height: 80 }} />
      <textarea ref={second} aria-label="Second panel draft" style={{ width: 320, height: 80 }} />
    </div>
    <button onClick={() => setOutside(value => value + 1)} style={{ marginTop: 160 }}>Ordinary action</button>
    <output data-testid="ordinary-count">{outside}</output><output data-testid="pause-reason">{paused}</output>
    {native && <div role="dialog" aria-label="Native handoff fixture"><button onClick={() => setNative(false)}>Close handoff</button></div>}
    {open && target && <SpotlightOverlay target={target} step={step} binding={binding} onPause={reason => { setPaused(reason); setOpen(false) }} onNext={() => setOpen(false)} canNext={false} />}
  </main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ModalProvider><DismissibleLayerProvider><Harness /></DismissibleLayerProvider></ModalProvider></React.StrictMode>)
