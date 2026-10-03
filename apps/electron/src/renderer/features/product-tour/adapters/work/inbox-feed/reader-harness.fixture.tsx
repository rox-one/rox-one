// Component-harness entry only; no production module imports this fixture.
import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { FeedItem } from '@rox/shared/feed'
import { TourPanelScope, TourRuntimeContext, type TourRuntimePort } from '../../../runtime/hooks'
import type { TourScope, TourSignal, TourTargetRegistration } from '../../../contracts'
import { useFeedReaderTour } from './use-feed-reader-tour'
import { SourcesView } from '../../../../../pages/feed/FeedSources'

const article: FeedItem = { id: 'news:fixture-article', tab: 'news', kind: 'news', title: 'Fixture publication', summary: 'Fixture summary', at: 50, url: 'https://example.invalid/item' }
const baseScope: TourScope = { workspaceId: 'fixture-workspace', panelId: 'fixture-panel' }
const evidence = { signals: [] as TourSignal[], captures: 0, selections: 0, mutations: 0, targets: new Map<string, TourTargetRegistration>() }
Object.assign(window, { readerEvidence: evidence })

function NativeReader({ scope, enabled }: { scope: TourScope; enabled: boolean }) {
  const [selected, setSelected] = useState<FeedItem | null>(null)
  const [version, setVersion] = useState(0)
  const select = (id: string | null) => {
    evidence.selections++
    setSelected(previous => id === article.id ? previous ?? { ...article, summary: version ? 'Updated native material' : article.summary } : null)
  }
  const { selectItem, readerRef } = useFeedReaderTour({ selected, workspaceId: scope.workspaceId, readerVisible: true, loaded: true, failed: false, select })
  const api = useMemo(() => ({ feedAddSource: async () => { evidence.mutations++; return { ok: false, error: 'invalid-url' } }, feedRefresh: async () => { evidence.mutations++ }, feedUpdateSource: async () => { evidence.mutations++ } }) as unknown as Window['electronAPI'], [])
  return <>
    <button data-testid="choose" onClick={() => selectItem({ ...article, summary: version ? 'Updated native material' : article.summary })}>Open native item</button>
    <button data-testid="prior" onClick={() => setSelected(article)}>Restore prior reader</button>
    <button data-testid="update" onClick={() => { setVersion(v => v + 1); setSelected(s => s ? { ...s, summary: 'Updated native material' } : null) }}>Update native material</button>
    <button data-testid="close" onClick={() => setSelected(null)}>Close reader</button>
    {selected ? <div ref={readerRef} data-testid="feed-detail">{selected.summary}</div> : <div ref={readerRef} data-testid="feed-list">Choose an item</div>}
    <SourcesView api={api} sources={[]} items={[]} now={100} x={{ state: 'not-connected' }} suggestions={[]} selectedId={null} onSelect={() => { evidence.selections++ }} onShowItems={() => { evidence.selections++ }} reload={async () => {}} fmt={String} />
    <span data-testid="enabled">{String(enabled)}</span>
  </>
}
function App() {
  const [enabled, setEnabled] = useState(true)
  const [scope, setScope] = useState(baseScope)
  const [run, setRun] = useState('fixture-run-a')
  const port = useMemo<TourRuntimePort>(() => ({
    enabled,
    capture(current) { evidence.captures++; return { binding: { ...baseScope, clientProfileId: 'fixture-profile', runToken: run }, operationToken: `fixture-operation-${evidence.captures}`, at: 100 } },
    emit(signal) { evidence.signals.push(signal) },
    register(target) { evidence.targets.set(target.id, target); return () => { if (evidence.targets.get(target.id)?.registrationToken === target.registrationToken) evidence.targets.delete(target.id) } },
    setCapability() { return () => {} },
  }), [enabled, run])
  return <TourRuntimeContext.Provider value={port}>
    <button data-testid="tour-toggle" onClick={() => setEnabled(v => !v)}>Toggle learning</button>
    <button data-testid="new-run" onClick={() => setRun('fixture-run-b')}>New attempt</button>
    <button data-testid="foreign-panel" onClick={() => setScope({ ...baseScope, panelId: 'foreign-panel' })}>Change panel</button>
    <TourPanelScope {...scope}><NativeReader scope={scope} enabled={enabled} /></TourPanelScope>
  </TourRuntimeContext.Provider>
}
createRoot(document.getElementById('root')!).render(<App />)
