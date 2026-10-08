import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { ChatDisplay } from '../../../ChatDisplay'
import { SkillsListPanel } from '../../../SkillsListPanel'
import { ActionRegistryProvider } from '@/actions'
import { ModalProvider } from '@/context/ModalContext'
import { DismissibleLayerProvider } from '@/context/DismissibleLayerContext'
import { TooltipProvider } from '@rox/ui'
import { TourPanelScope, TourRuntimeContext, type TourRuntimePort } from '@/features/product-tour/runtime/hooks'
import { createTargetRegistry } from '@/features/product-tour/ui/target-registry'
import { measureTargetGeometry } from '@/features/product-tour/ui/geometry'
import { SpotlightOverlay } from '@/features/product-tour/ui/SpotlightOverlay'
import { productTourCatalogue } from '@/features/product-tour/catalogue'
import type { TargetId, TourBinding, TourTargetRegistration } from '@/features/product-tour/contracts'
import en from '../../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '../../../../../index.css'

await i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, keySeparator: false, interpolation: { escapeValue: false } })
const skills = Array.from({ length: 80 }, (_, i) => ({ slug: `skill-${i}`, path: `/fixture/skill-${i}`, source: 'workspace', metadata: { name: `Native skill ${i}`, description: `Skill catalogue row ${i}`, icon: '⚡' } }))
;(window as any).electronAPI = { getSendMessageKey: async () => 'enter', readPreferences: async () => ({ content: '{}' }), openUrl: () => {}, sessionCommand: async () => {}, listPendingSkills: async () => [], getSkillUsage: async () => Object.fromEntries(skills.map(skill => [skill.slug, { used: 1 }])), onSkillsPendingChanged: () => () => {}, onSkillsChanged: () => () => {}, listBundledSkillPacks: async () => [], onBundledSkillsChanged: () => () => {}, getEntityIcon: async () => null }
const binding: TourBinding = { workspaceId: 'workspace-a', panelId: 'panel-a', sessionId: 'session-a', clientProfileId: 'profile-a', runToken: 'run-a' }
const targets = new Map<string, TourTargetRegistration>(), registry = createTargetRegistry(), pauses: string[] = []
const geometryObservers: Array<{ targets: Element[]; connected: boolean }> = []
const NativeResizeObserver = window.ResizeObserver
window.ResizeObserver = class extends NativeResizeObserver {
  record = { targets: [] as Element[], connected: true }
  constructor(callback: ResizeObserverCallback) { super(callback); geometryObservers.push(this.record) }
  observe(target: Element, options?: ResizeObserverOptions) { this.record.targets.push(target); super.observe(target, options) }
  disconnect() { this.record.connected = false; super.disconnect() }
}
const runtime: TourRuntimePort = { enabled: true, capture: () => null, emit: () => {}, setCapability: () => () => {}, register: target => { targets.set(target.registrationToken, target); const stop = registry.register(target); return () => { targets.delete(target.registrationToken); stop() } } }
const hugeParagraph = 'A single native paragraph with a completed answer. '.repeat(1300)
function session(kind: string) {
  const messages: any[] = [{ id: 'accepted-user', role: 'user', content: 'Read the connected source', timestamp: 1 }]
  if (kind !== 'final-only') messages.push({ id: 'native-tool', role: 'tool', toolName: 'mcp__fixture-source__read', toolUseId: 'native-tool-use', toolStatus: 'completed', toolResult: 'Native connected source result', content: '', timestamp: 2, ...(kind === 'tool-error' ? { isError: true } : {}) })
  if (kind !== 'source-only') messages.push({ id: 'exact-native-final', role: 'assistant', content: hugeParagraph, timestamp: 3, ...(kind === 'ineligible' ? { isIntermediate: true } : {}) })
  return { id: 'session-a', workspaceId: 'workspace-a', messages, enabledSourceSlugs: ['fixture-source'], isProcessing: false, sessionStatus: 'in_progress' } as any
}
let controls: any
function App() {
  const [kind, setKind] = React.useState('result'), [compact, setCompact] = React.useState(false), [mounted, setMounted] = React.useState(true), [overlay, setOverlay] = React.useState<TargetId | null>(null), [currentSession, setSession] = React.useState(session('result'))
  controls = { mount: (nextKind: string, nextCompact: boolean) => flushSync(() => { setKind(nextKind); setCompact(nextCompact); setOverlay(null); setMounted(true); setSession(session(nextKind)) }), unmount: () => flushSync(() => setMounted(false)), showOverlay: (id: TargetId) => flushSync(() => setOverlay(id)), closeOverlay: () => flushSync(() => setOverlay(null)), replace: (nextKind: string) => flushSync(() => setSession(session(nextKind))) }
  const resolution = overlay ? registry.resolve(overlay, binding) : null
  const step = productTourCatalogue.flatMap(tour => tour.steps).find(step => step.target === overlay)!
  return <ModalProvider><DismissibleLayerProvider><TooltipProvider><ActionRegistryProvider><TourRuntimeContext.Provider value={runtime}><TourPanelScope {...binding}>
    <div id="panel" style={{ display: 'flex', flexDirection: 'column', height: 330, width: 700, margin: 80, overflow: 'hidden' }}>
      {mounted && (kind === 'skills' ? <SkillsListPanel skills={skills as any} onDeleteSkill={() => {}} onSkillClick={() => {}} workspaceId="workspace-a" /> : <ChatDisplay key={String(compact)} session={currentSession} onSendMessage={() => {}} onOpenFile={() => {}} onOpenUrl={() => {}} onModelChange={() => {}} currentModel="fixture" workspaceId="workspace-a" compactMode={compact} />)}
    </div>
    {resolution?.status === 'ready' && <SpotlightOverlay target={resolution.target} binding={binding} step={step} onPause={reason => pauses.push(reason)} />}
  </TourPanelScope></TourRuntimeContext.Provider></ActionRegistryProvider></TooltipProvider></DismissibleLayerProvider></ModalProvider>
}
;(window as any).__learningResults = {
  get controls() { return controls }, pauses,
  resolve: (id: TargetId, override?: Partial<TourBinding>) => { const result = registry.resolve(id, { ...binding, ...override }); const raw = [...targets.values()].filter(target => target.id === id); return { status: result.status, reason: result.status === 'blocked' ? result.reason : null, count: raw.length, strict: raw[0] ? measureTargetGeometry(raw[0].element) : null, rect: raw[0]?.element.getBoundingClientRect().toJSON(), element: raw[0]?.element.tagName, response: raw[0]?.element.getAttribute('data-search-root') } },
  target: (id: TargetId) => [...targets.values()].find(target => target.id === id)?.element,
  activeGeometryObservers: () => geometryObservers.filter(record => record.connected && record.targets.includes(document.body)).length,
  clippedControl: () => { const element = [...targets.values()].find(target => target.id === 'session.final-result')!.element; const stop = registry.register({ id: 'composer.input', element, context: binding, scope: 'bound-panel', variant: 'regular', registrationToken: 'ordinary-clipped-control' }); const result = registry.resolve('composer.input', binding); stop(); return result.status === 'blocked' ? result.reason : result.status },
}
createRoot(document.getElementById('root')!).render(<App />)
