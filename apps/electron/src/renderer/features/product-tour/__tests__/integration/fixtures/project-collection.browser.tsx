/** TEST ONLY: production components/provider/engine; readonly bootstrap and API replies are DI.
 * Status preconditions are explicitly seeded; no native project creation or OS success is claimed.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Provider, createStore } from 'jotai'
import { TooltipProvider } from '@rox/ui'
import { ModalProvider, useModalRegistry } from '@/context/ModalContext'
import { DismissibleLayerProvider, useDismissibleLayerRegistry } from '@/context/DismissibleLayerContext'
import { focusedPanelIdAtom, panelStackAtom } from '@/atoms/panel-stack'
import { parseRouteToNavigationState } from '../../../../../../shared/route-parser'
import { ProductTourProvider, ProductTourHost, useProductLearning } from '../../../runtime/ProductTourProvider'
import { TourPanelScope, TourRuntimeContext, useTourSignals, useTourTarget } from '../../../runtime/hooks'
import { navigationEntity } from '../../../runtime/routes'
import { measureTargetGeometry } from '../../../ui/geometry'
import { useProjects } from '@/hooks/useProjects'
import { ProjectsListPanel } from '@/components/app-shell/ProjectsListPanel'
import ProjectInfoPage from '@/pages/ProjectInfoPage'
import { ActiveOptionBadges } from '@/components/app-shell/ActiveOptionBadges'
import { CollectionViewCycleButton } from '@/components/app-shell/collection/CollectionViewCycleButton'
import { collectionViewRoute } from '@/components/app-shell/collection/collection-view-cycle'
import type { LoadedProject } from '@rox/shared/projects/types'
import type { CollectionViewMode } from '@/components/app-shell/kanban/BoardListToggle'

const TEST_ONLY_OBSCURING_LAYER = 30
const store = createStore()
const listeners = new Set<() => void>()
const project: LoadedProject = { workspaceId: 'workspace-a', folderPath: '/owned-test/project',
  assetsPath: '/owned-test/project/assets', workspaceRootPath: '/owned-test', config: {
  id: 'project-a', slug: 'project-a', name: 'Actually opened project', createdAt: 1, updatedAt: 1,
} }
const f = (window as any).projectCollectionTest = {
  controller: null as ReturnType<typeof useProductLearning> | null,
  nativeLayers: null as null | (()=>{modals:string[];layers:string[]}),
  workspaceId: 'workspace-a', panelId: 'panel-a', kind: 'projects', projects: [project],
  requestedView: null as CollectionViewMode | null, replaceImmediately: true,
  refreshProjects: null as (()=>Promise<void>) | null, denyProjects: false, reads: 0,
  projectWriter: true, coverDestination: false, clipDestination: false, denyDetail:false,
  viewCaptures: [] as any[], viewSignals: [] as any[], registeredViews: [] as any[],
  projectListeners: new Set<(workspaceId:string, projects:unknown)=>void>(),
  selectedProject: '', loadingProject: false, resolveProject: null as (() => void) | null, writes: 0, clicks: 0,
  navigation: { isReady: true, navigationRevision: 1,
    navigationState: parseRouteToNavigationState('allSessions/session/session-a'),
    navigate: (route: string) => f.navigate(route) },
  subscribe(callback: () => void) { listeners.add(callback); return () => listeners.delete(callback) },
  measureTargetGeometry,
  render: () => {},
  navigate(route: string) {
    f.navigation = { ...f.navigation, navigationRevision: f.navigation.navigationRevision + 1,
      navigationState: parseRouteToNavigationState(route) }
    store.set(panelStackAtom, [{ id: f.panelId, route: route as any, proportion: 1, panelType: 'other', laneId: 'main' }])
    for (const listener of listeners) listener()
    f.render()
  },
  reset(kind: string, empty = false) {
    f.kind = kind; f.projects = empty ? [] : [project]; f.selectedProject = ''; f.loadingProject = false; f.resolveProject = null
    f.requestedView = null; f.replaceImmediately = true; f.writes = 0; f.clicks = 0
    f.navigate('allSessions/session/session-a')
    return f.refreshProjects?.()
  },
  showRequested() { if (f.requestedView) f.navigate(collectionViewRoute(f.requestedView)) },
}
store.set(focusedPanelIdAtom, f.panelId)
store.set(panelStackAtom, [{ id: f.panelId, route: 'allSessions/session/session-a', proportion: 1, panelType: 'other', laneId: 'main' }])
// eslint-disable-next-line craft-agent/no-localstorage -- Isolated test enables the production flag through its existing key.
localStorage.setItem('craft-feature-product-tour-v1', 'true')
;(window as any).electronAPI = {
  getSessionMessages: async () => null,
  getProjects: async () => { f.reads++; if(f.denyProjects) throw new Error('Owned Projects read denied'); return f.projects },
  getProject: async () => {if(f.denyDetail)throw new Error('Owned detail read denied'); return f.loadingProject ? new Promise(resolve => { f.resolveProject = () => resolve(project) }) : project },
  getProjectOkr: async () => ({ schemaVersion: 1, revision: 1, cycles: [] }),
  onProjectsChanged: (callback:(workspaceId:string, projects:unknown)=>void) => { f.projectListeners.add(callback); return ()=>f.projectListeners.delete(callback) },
  listProjectAssets: async () => [],
}
function Harness() {
  const controller = useProductLearning()
  f.controller = controller
  const modals = useModalRegistry()
  const layers = useDismissibleLayerRegistry()
  f.nativeLayers = () => ({modals:modals.getSnapshot().filter(layer=>layer.id.startsWith('tour-native-')).map(layer=>layer.id),layers:layers.getSnapshot().filter(layer=>layer.id.startsWith('tour-native-')).map(layer=>layer.id)})
  const projectReader = useProjects(f.workspaceId)
  f.refreshProjects = projectReader.refresh
  const runtime = React.useContext(TourRuntimeContext)
  const trackedRuntime = React.useMemo(() => runtime ? { ...runtime,
    capture(scope:any) { const observation=runtime.capture(scope); if(observation) f.viewCaptures.push(observation); return observation },
    emit(signal:any) { f.viewSignals.push(signal); runtime.emit(signal) },
    register(target:any) { f.registeredViews.push(target); return runtime.register(target) },
  } : null, [runtime])
  const signals = useTourSignals()
  const status = useTourTarget('session.status')
  const labels = useTourTarget('session.labels')
  const nav = f.navigation.navigationState ?? parseRouteToNavigationState('allSessions')!
  const view = (nav.navigator === 'sessions' ? nav.viewMode ?? 'list' : 'list') as CollectionViewMode
  const detail = nav.navigator === 'projects' && nav.details?.type === 'project' ? nav.details.projectSlug : null
  React.useEffect(() => signals.capability('labels.available', { state: 'ready' }), [signals])
  return <main style={{ padding: 100, width: 900, minHeight: 700 }}>
    <button ref={status} onClick={() => signals.emit(signals.capture(), 'session.status-committed', 'observed', 'native-commit')}>Seed prior status</button>
    <button ref={labels} onClick={() => signals.emit(signals.capture(), 'session.labels-committed', 'observed', 'native-commit')}>Seed prior label</button>
    {f.kind === 'projects' && nav.navigator === 'projects' && <div style={{width:850,display:'flex',alignItems:'flex-start',gap:32}}>
      <div style={{width:280,flexShrink:0}}><ProjectsListPanel projects={projectReader.projects} workspaceId={f.workspaceId}
        onAddProject={() => { f.clicks++; f.projects = [project]; for(const callback of f.projectListeners) callback(f.workspaceId,f.projects) }}
        onProjectClick={slug => { f.clicks++; f.navigate(`projects/project/${slug}`) }} /></div>
      {detail && <section style={{width:500}}><ProjectInfoPage key={detail} projectSlug={detail} /></section>}
    </div>}
    {f.kind === 'badges' && <ActiveOptionBadges sessionId="session-a"
      permissionMode="allow-all" onPermissionModeChange={() => {}} projects={[]}
      onSetProjectId={f.projectWriter ? ()=>{f.writes++} : undefined} labels={[]} sessionLabels={[]} onLabelsChange={() => {}} />}
    {f.kind === 'workflow' && nav.navigator === 'sessions' && <TourPanelScope workspaceId={f.workspaceId}
      panelId={f.panelId} {...navigationEntity(nav)}>
      <TourRuntimeContext.Provider value={trackedRuntime}>
      <section key={view} data-actual-collection-view={view} style={{ width: 300, height: f.clipDestination && view !== 'list' ? 8 : 130, overflow: f.clipDestination ? 'hidden' : undefined, position:'relative' }}>
        <h2>{view} destination mounted</h2>
        <CollectionViewCycleButton value={view} onChange={mode => {
          f.requestedView = mode
          if (f.replaceImmediately) f.navigate(collectionViewRoute(mode))
        }} />
        {f.coverDestination && view !== 'list' && <div data-cover-destination style={{position:'absolute',inset:0,zIndex:TEST_ONLY_OBSCURING_LAYER,background:'white'}}>Unrelated covering content</div>}
      </section>
      </TourRuntimeContext.Provider>
    </TourPanelScope>}
    <ProductTourHost />
  </main>
}
const root = createRoot(document.getElementById('root')!)
f.render = () => flushSync(() => root.render(<Provider store={store}><TooltipProvider><ModalProvider><DismissibleLayerProvider>
  <ProductTourProvider workspaceId={f.workspaceId} shellReady><Harness /></ProductTourProvider>
</DismissibleLayerProvider></ModalProvider></TooltipProvider></Provider>))
f.render()
