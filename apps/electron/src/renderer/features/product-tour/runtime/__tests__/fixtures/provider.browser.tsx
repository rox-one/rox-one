import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Provider, createStore } from 'jotai'
import { ModalProvider } from '../../../../../context/ModalContext'
import { DismissibleLayerProvider } from '../../../../../context/DismissibleLayerContext'
import { focusedPanelIdAtom, panelStackAtom } from '../../../../../atoms/panel-stack'
import { parseRouteToNavigationState } from '../../../../../../shared/route-parser'
import { ProductTourProvider, ProductTourHost, useProductLearning } from '../../ProductTourProvider'
import { useTourSignals, useTourTarget, type TourObservation } from '../../hooks'
import { createLeaseRepository, createLearningProfileRepository, createLearningScopeKey, createProgressRepository } from '../../../persistence'
import { deriveMeetingsAutomationSignals } from '../../../adapters/work/meetings-automations'
import { productTourCatalogue } from '../../../catalogue'
import type { PersistResult, TourProgress } from '../../../contracts'
import type { LocalMeeting } from '../../../../../../shared/meetings-local'

// Production provider, engine, repositories, registries, presentation and meeting adapter.
// Only navigation/readonly native bootstrap and an explicit rendering fault are isolated.
const store = createStore()
const listeners = new Set<() => void>()
let route = 'settings/learning'
const f = (window as any).learningProviderTest = {
  controller: null as ReturnType<typeof useProductLearning>,
  failPresentation: false,
  workspaceId: 'workspace-a',
  navSnapshot: null as any,
  subscribe: (callback: () => void) => { listeners.add(callback); return () => listeners.delete(callback) },
  navigation: { navigate: (next: string) => navigate(next), isReady: true, navigationRevision: 1,
    navigationState: parseRouteToNavigationState(route) },
  meetingObservation: null as TourObservation | null,
  render: () => {},
  switchWorkspace(next: string) { f.workspaceId = next; f.render() },
  storageGateHeld: false,
  releaseStorage: () => {},
  async holdStorage() {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('rox-product-tour')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['leases', 'meta'], 'readwrite')
        f.storageGateHeld = true
        f.releaseStorage = () => { f.storageGateHeld = false }
        tx.oncomplete = () => db.close()
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error) }
        const keepAlive = () => {
          const read = tx.objectStore('leases').get('test-only-storage-gate')
          read.onsuccess = () => { resolve(); if (f.storageGateHeld) keepAlive() }
        }
        keepAlive()
      }
    })
  },
  async seedWorkspace(workspaceId: string) {
    const profile = await createLearningProfileRepository().read()
    if (profile.status === 'failed') throw new Error('Expected isolated profile')
    const leases = createLeaseRepository()
    const lease = await leases.acquire(profile.value.clientProfileId, 'test-only-seed', Date.now())
    if (!lease) throw new Error('Expected seed ownership')
    await createProgressRepository().apply(createLearningScopeKey(profile.value.clientProfileId, workspaceId), productTourCatalogue.find(tour => tour.id === 'OBT-25')!,
      { kind: 'evidence', stepId: 'learning.library', stepVersion: 1, level: 'shown', at: 1 }, { profileId: profile.value.clientProfileId, lease })
    await leases.release(profile.value.clientProfileId, lease)
  },
  async read(id: string, workspaceId?: string): Promise<PersistResult<TourProgress | null>> {
    const profile = await createLearningProfileRepository().read()
    if (profile.status === 'failed') throw new Error('Expected isolated profile')
    return createProgressRepository().read(createLearningScopeKey(profile.value.clientProfileId, workspaceId ?? f.workspaceId), id as any)
  },
  async releaseForeignLease() {
    const profile = await createLearningProfileRepository().read()
    if (profile.status === 'failed') throw new Error('Expected isolated profile')
    await createLeaseRepository().release(profile.value.clientProfileId, f.foreignLease)
  },
  async holdForeignLease() {
    const profile = await createLearningProfileRepository().read()
    if (profile.status === 'failed') throw new Error('Expected isolated profile')
    f.foreignLease = await createLeaseRepository().acquire(profile.value.clientProfileId, 'foreign-window', Date.now())
    if (!f.foreignLease) throw new Error('Expected foreign window ownership')
  },
  foreignLease: null as any,
  navigate: (next: string) => navigate(next),
}
function navigate(next: string) {
  route = next
  f.navigation = { ...f.navigation, navigationRevision: f.navigation.navigationRevision + 1,
    navigationState: parseRouteToNavigationState(next) }
  f.navSnapshot = f.navigation
  store.set(panelStackAtom, [{ id: 'panel-a', route: next as any, proportion: 1, panelType: 'other', laneId: 'main' }])
  for (const callback of listeners) callback()
}
f.navSnapshot = f.navigation
store.set(focusedPanelIdAtom, 'panel-a')
store.set(panelStackAtom, [{ id: 'panel-a', route: route as any, proportion: 1, panelType: 'settings', laneId: 'main' }])
localStorage.setItem('craft-feature-product-tour-v1', 'true')
;(window as any).electronAPI = { getSessionMessages: async () => [], listMeetings: async () => [] }
const meeting: LocalMeeting = { schema: 1, id: 'meeting-a', title: 'Existing meeting', workspaceId: 'workspace-a',
  createdAt: 1, updatedAt: 10, durationMs: 0, status: 'ready', source: 'none', participants: [], notes: '', audio: null,
  transcript: { status: 'none', progress: 0 }, summary: { text: 'Existing summary', generated: false, updatedAt: 10 }, actions: [], documents: [] }
function Harness() {
  const controller = useProductLearning()
  f.controller = controller
  const library = useTourTarget('learning.library')
  const preferences = useTourTarget('learning.preferences')
  const meetingList = useTourTarget('meetings.list')
  const meetingArtifact = useTourTarget('meetings.artifacts')
  const signals = useTourSignals()
  const nav = f.navigation.navigationState
  const selected = nav && 'details' in nav && nav.details && 'meetingId' in nav.details ? nav.details.meetingId : undefined
  React.useEffect(() => {
    const off = signals.capability('meetings.available', { state: 'ready' })
    const artifact = signals.capability('meeting.artifact-present', selected === 'meeting-a'
      ? { state: 'ready' } : { state: 'pending', reason: 'missing-entity' })
    return () => { off(); artifact() }
  }, [signals, selected])
  return <main style={{ padding: 100 }}>
    <div ref={library} style={{ width: 300, height: 70 }}>Learning library</div>
    <div ref={preferences} style={{ width: 300, height: 70 }}>Preferences</div>
    <div ref={meetingList} style={{ width: 300, height: 70 }}>Existing native meetings</div>
    <div ref={meetingArtifact} style={{ width: 300, height: 70 }}>
      <button onClick={() => {
        const observation = signals.capture()
        f.meetingObservation = observation
        const scope = { workspaceId: f.workspaceId, panelId: 'panel-a', entityId: selected }
        const events = deriveMeetingsAutomationSignals({ observation, scope, selectedId: selected ?? null,
          meeting, expectedMeetingId: meeting.id, expectedUpdatedAt: meeting.updatedAt,
          artifactRendered: true, at: Date.now(), eventToken: crypto.randomUUID() })
        for (const signal of events) signals.emit(observation, signal.name, signal.level, signal.origin, signal.eventToken)
      }}>Open existing artifact</button>
    </div>
    <ProductTourHost />
  </main>
}
const root = createRoot(document.getElementById('root')!)
f.render = () => flushSync(() => root.render(<Provider store={store}><ModalProvider><DismissibleLayerProvider>
  <ProductTourProvider workspaceId={f.workspaceId} shellReady><Harness /></ProductTourProvider>
</DismissibleLayerProvider></ModalProvider></Provider>))
f.render()
