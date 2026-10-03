// Test-only entry: the production selector and spotlight run in a real browser.
import { useCallback, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SourceSelectorPopover } from '../../../../components/ui/SourceSelectorPopover'
import { ModalProvider, useModalRegistry } from '../../../../context/ModalContext'
import { DismissibleLayerProvider, useDismissibleLayerRegistry } from '../../../../context/DismissibleLayerContext'
import { SpotlightOverlay } from '../../ui/SpotlightOverlay'
import { TourPanelScope, TourRuntimeContext, type TourRuntimePort } from '../../runtime/hooks'
import { clearChatObservations, observeChatSessionEvent } from '../chat'
import type { Session } from '@rox/shared/protocol'
import type { TourBinding, TourStep, TourTargetRegistration } from '../../contracts'
import type { LoadedSource } from '../../../../../shared/types'

const binding: TourBinding = { workspaceId: 'w', panelId: 'p', sessionId: 's', clientProfileId: 'c', runToken: 'r' }
const source: LoadedSource = { config: { id: 'a', slug: 'a', name: 'Native source A', type: 'mcp', provider: 'test', icon: '🔌', enabled: true, connectionStatus: 'connected', mcp: { transport: 'stdio', command: 'unused', authType: 'none' } }, guide: null, workspaceId: 'w', workspaceRootPath: '/unused', folderPath: '/unused' }
const step: TourStep = { id: 'sources.select', version: 1, target: 'composer.sources', routeKey: 'current-session', scope: 'bound-panel', copyKey: 'sources', copy: { en: { title: 'Sources', body: 'Choose a source' }, ru: { title: 'Sources', body: 'Choose a source' } }, completion: { kind: 'signal', signal: 'session.sources-committed', evidence: 'observed', priorState: 'after-activation', requireAcknowledgementAfterEvidence: false }, handoff: true, optional: false, requires: [], onUnavailable: 'block', missingTarget: 'block-and-offer-retry-or-pause', notes: '', testId: 'T-SOURCES-SELECT' }
const stats = { paused: 0, captured: 0, committed: 0, selected: [] as string[], nativeLayers: () => 0 }

function Harness({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [target, setTarget] = useState<TourTargetRegistration | null>(null)
  const anchor = useRef<HTMLButtonElement | null>(null)
  const registerAnchor = useCallback((node: HTMLButtonElement | null) => { anchor.current = node; if (node) setTarget({ id: 'composer.sources', element: node, context: binding, registrationToken: 'target', scope: 'bound-panel', variant: 'regular' }) }, [])
  const modals = useModalRegistry()
  const layers = useDismissibleLayerRegistry()
  stats.nativeLayers = () => layers.getSnapshot().filter(layer => !layer.id.startsWith('product-tour-')).length + modals.getSnapshot().filter(layer => !layer.id.startsWith('product-tour-')).length
  const port = useMemo<TourRuntimePort>(() => ({ enabled, capture: () => { if (stats.paused) return null; stats.captured++; return { binding, operationToken: 'source-choice', at: Date.now() } }, emit: () => {}, register: () => () => {}, setCapability: () => () => {} }), [enabled])
  return <TourRuntimeContext.Provider value={port}><TourPanelScope {...binding}>
    <button ref={registerAnchor} style={{ margin: 100, width: 180, height: 40 }} onClick={() => setOpen(true)}>Choose sources</button>
    <SourceSelectorPopover open={open} onOpenChange={setOpen} anchorRef={anchor} sources={[source]} selectedSlugs={selected} tourSessionSelection onToggleSlug={slug => {
      const next = selected.includes(slug) ? selected.filter(item => item !== slug) : [...selected, slug]
      const previous = { id: 's', workspaceId: 'w', messages: [], enabledSourceSlugs: selected } as unknown as Session
      const committed = { ...previous, enabledSourceSlugs: next }
      stats.committed += observeChatSessionEvent({ type: 'sources_changed', sessionId: 's', enabledSourceSlugs: next }, previous, committed).length
      stats.selected = next; setSelected(next)
    }} />
    {enabled && target && <SpotlightOverlay target={target} step={step} binding={binding} onPause={() => { stats.paused++ }} />}
  </TourPanelScope></TourRuntimeContext.Provider>
}
const root = createRoot(document.getElementById('root')!)
Object.assign(window, { sourcePickerTest: { stats, mount(enabled: boolean) { clearChatObservations(); stats.paused = 0; stats.captured = 0; stats.committed = 0; stats.selected = []; root.render(<ModalProvider><DismissibleLayerProvider><Harness key={String(enabled)} enabled={enabled} /></DismissibleLayerProvider></ModalProvider>) } } })
