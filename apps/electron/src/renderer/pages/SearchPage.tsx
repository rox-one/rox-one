import { useAtomValue } from 'jotai'
import { useNotesTitleKey } from '@/platform/useNotesTitleKey'
import { useTourTarget } from '@/features/product-tour/runtime/hooks'
import { useKnowledgeSignals } from '@/features/product-tour/adapters/knowledge/hooks'
import { createSearchFence, openCurrentSearchResult } from '@/features/product-tour/adapters/knowledge'
import { Search } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { SearchHit } from '@rox/core/knowledge'
import { windowWorkspaceIdAtom, sessionMetaMapAtom } from '@/atoms/sessions'
import { Input } from '@/components/ui/input'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { resolveKnowledgeApi, resolveSearchHitNoteId, searchHitRoute, searchKnowledge } from '../knowledge/KnowledgeHome'

type NoteResult = Awaited<ReturnType<Window['electronAPI']['searchNotes']>>[number]
type SessionResult = Awaited<ReturnType<Window['electronAPI']['searchSessionContent']>>[number]
type SourceState<T> = { status: 'idle' | 'loading' | 'done' | 'unavailable'; items: T[] }

interface SearchPageProps {
  initialQuery: string
}

export default function SearchPage({ initialQuery }: SearchPageProps) {
  const { t } = useTranslation()
  const notesHeadingKey = useNotesTitleKey('searchPage.notes')
  const { navigate: navigateInPanel } = useNavigation()
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  const sessionMeta = useAtomValue(sessionMetaMapAtom)
  const knowledgeSignals = useKnowledgeSignals({ workspaceId: workspaceId ?? undefined })
  const searchInputTarget = useTourTarget('search.input', { workspaceId: workspaceId ?? undefined })
  const searchResultsTarget = useTourTarget('search.results', { workspaceId: workspaceId ?? undefined })
  const signalsRef = useRef(knowledgeSignals)
  signalsRef.current = knowledgeSignals
  const [searchFence] = useState(createSearchFence)
  const notesAvailable = typeof window.electronAPI.searchNotes === 'function'
  const sessionsAvailable = typeof window.electronAPI.searchSessionContent === 'function'
  const [sourceReadFailed, setSourceReadFailed] = useState(false)
  const searchAvailable = !sourceReadFailed && !!workspaceId && (notesAvailable || sessionsAvailable || !!resolveKnowledgeApi())
  useEffect(() => knowledgeSignals.capability('search.available', searchAvailable ? { state: 'ready' } : { state: 'unavailable', reason: 'api-unavailable' }), [knowledgeSignals, searchAvailable])
  const [query, setQuery] = useState(initialQuery)
  const [notes, setNotes] = useState<SourceState<NoteResult>>({ status: 'idle', items: [] })
  const [sessions, setSessions] = useState<SourceState<SessionResult>>({ status: 'idle', items: [] })
  const [knowledge, setKnowledge] = useState<SourceState<SearchHit>>({ status: 'idle', items: [] })
  const requestVersion = useRef(0)
  const currentQuery = useRef(query.trim())
  const currentWorkspaceId = useRef(workspaceId)
  if (currentQuery.current !== query.trim() || currentWorkspaceId.current !== workspaceId) {
    searchFence.invalidate()
    ++requestVersion.current
  }
  currentQuery.current = query.trim()
  currentWorkspaceId.current = workspaceId

  useEffect(() => {
    setQuery(initialQuery)
  }, [initialQuery])

  useEffect(() => {
    const request = ++requestVersion.current
    const q = query.trim()
    setSourceReadFailed(false)
    setNotes({ status: q ? 'loading' : 'idle', items: [] })
    setSessions({ status: q ? 'loading' : 'idle', items: [] })
    setKnowledge({ status: q ? 'loading' : 'idle', items: [] })
    if (!q || !workspaceId) {
      if (!workspaceId && q) {
        setNotes({ status: 'unavailable', items: [] })
        setSessions({ status: 'unavailable', items: [] })
        setKnowledge({ status: 'unavailable', items: [] })
      }
      return
    }

    const ticket = searchFence.begin(workspaceId, q)
    const isCurrent = () => request === requestVersion.current && searchFence.current(ticket) && currentQuery.current === q && currentWorkspaceId.current === workspaceId
    const timer = window.setTimeout(() => {
      const observation = signalsRef.current.capture()
      let successfulSources = 0
      const noteRequest = Promise.resolve().then(() => { if (!notesAvailable) throw new Error('Unavailable'); return window.electronAPI.searchNotes(workspaceId, q) }).then(
        (items) => { successfulSources++; if (isCurrent()) setNotes({ status: 'done', items }) },
        () => { if (isCurrent()) setNotes({ status: 'unavailable', items: [] }) },
      )
      const sessionRequest = Promise.resolve().then(() => { if (!sessionsAvailable) throw new Error('Unavailable'); return window.electronAPI.searchSessionContent(workspaceId, q) }).then(
        (items) => { successfulSources++; if (isCurrent()) setSessions({ status: 'done', items }) },
        () => { if (isCurrent()) setSessions({ status: 'unavailable', items: [] }) },
      )
      const knowledgeRequest = searchKnowledge(resolveKnowledgeApi(), workspaceId, q).then(
        (items) => {
          if (items !== null) successfulSources++
          if (!isCurrent()) return
          setKnowledge(items === null
            ? { status: 'unavailable', items: [] }
            : { status: 'done', items })
        },
        () => { if (isCurrent()) setKnowledge({ status: 'unavailable', items: [] }) },
      )
      void Promise.all([noteRequest, sessionRequest, knowledgeRequest]).then(() => {
        signalsRef.current.publish(observation, { kind: 'search-finished', workspaceId, current: isCurrent(), succeeded: successfulSources > 0 })
        if (isCurrent()) setSourceReadFailed(successfulSources === 0)
      })
    }, 180)

    return () => {
      window.clearTimeout(timer)
      requestVersion.current++
      searchFence.invalidate()
    }
  }, [query, workspaceId, searchFence, notesAvailable, sessionsAvailable])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextQuery = query.trim()
    if (!nextQuery) return
    navigateInPanel(routes.view.search(nextQuery))
  }

  const currentOpening = () => {
    if (!workspaceId || !query.trim()) return null
    const q = query.trim()
    const request = requestVersion.current
    const observation = knowledgeSignals.capture()
    return { q, observation, current: () => request === requestVersion.current && currentQuery.current === q && currentWorkspaceId.current === workspaceId }
  }
  const openNote = async (note: NoteResult) => {
    const opening = currentOpening()
    if (!workspaceId || !opening) return
    const opened = await openCurrentSearchResult({
      read: () => window.electronAPI.searchNotes(workspaceId, opening.q), current: opening.current,
      matches: (item) => item.id === note.id, open: (item) => navigateInPanel(routes.view.notes(item.id)),
    })
    knowledgeSignals.publish(opening.observation, { kind: 'search-result-opened', workspaceId, current: opened, succeeded: opened })
  }
  const openSession = async (session: SessionResult) => {
    const opening = currentOpening()
    if (!workspaceId || !opening) return
    const opened = await openCurrentSearchResult({
      read: () => window.electronAPI.searchSessionContent(workspaceId, opening.q), current: opening.current,
      matches: (item) => item.sessionId === session.sessionId, open: (item) => navigateInPanel(routes.view.allSessions(item.sessionId)),
    })
    knowledgeSignals.publish(opening.observation, { kind: 'search-result-opened', workspaceId, current: opened, succeeded: opened })
  }
  const openKnowledge = async (hit: SearchHit) => {
    const opening = currentOpening()
    if (!workspaceId || !opening) return
    let routedEntity = false
    const opened = await openCurrentSearchResult({
      read: () => searchKnowledge(resolveKnowledgeApi(), workspaceId, opening.q), current: opening.current,
      matches: (item) => item.ref.kind === hit.ref.kind && item.ref.id === hit.ref.id,
      open: (item) => { routedEntity = !!resolveSearchHitNoteId(item); return navigateInPanel(searchHitRoute(item)) },
    })
    knowledgeSignals.publish(opening.observation, { kind: 'search-result-opened', workspaceId, current: opened, succeeded: opened && routedEntity })
  }

  const sourceHeading = (title: string, source: SourceState<unknown>) => (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="text-sm font-semibold">{title}</h2>
      {source.status === 'unavailable' && <span className="text-xs text-muted-foreground">{t('searchPage.unavailable')}</span>}
      {source.status === 'loading' && <span className="text-xs text-muted-foreground">{t('searchPage.loading')}</span>}
    </div>
  )

  const hasResults = notes.items.length + sessions.items.length + knowledge.items.length > 0
  const allDone = [notes, sessions, knowledge].every((source) => source.status === 'done' || source.status === 'unavailable')

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b px-6 py-5">
        <h1 className="mb-4 text-xl font-semibold">{t('searchPage.title')}</h1>
        <form className="flex gap-2" onSubmit={submit} role="search">
          <div className="relative flex-1">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputTarget}
              aria-label={t('searchPage.placeholder')}
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('searchPage.placeholder')}
              value={query}
            />
          </div>
          <button className="rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" type="submit">
            {t('searchPage.submit')}
          </button>
        </form>
      </div>
      <div ref={searchResultsTarget} aria-live="polite" className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {!query.trim() ? (
          <p className="text-sm text-muted-foreground">{t('searchPage.empty')}</p>
        ) : (
          <div className="space-y-7">
            <section>
              {sourceHeading(t(notesHeadingKey), notes)}
              <ul className="space-y-1">
                {notes.items.map((note) => (
                  <li key={note.id}>
                    <button className="flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-muted" onClick={() => void openNote(note)} type="button">
                      <span className="truncate text-sm font-medium">{note.title || t('searchPage.noteFallback')}</span>
                      <span className="truncate text-xs text-muted-foreground">{note.relativePath}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              {sourceHeading(t('searchPage.sessions'), sessions)}
              <ul className="space-y-1">
                {sessions.items.map((session) => {
                  const metadata = sessionMeta.get(session.sessionId)
                  return (
                    <li key={session.sessionId}>
                      <button className="flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-muted" onClick={() => void openSession(session)} type="button">
                        <span className="truncate text-sm font-medium">{metadata?.name || t('searchPage.sessionFallback')}</span>
                        <span className="line-clamp-2 text-xs text-muted-foreground">{session.matches[0]?.snippet ?? ''}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
            <section>
              {sourceHeading(t('searchPage.knowledge'), knowledge)}
              <ul className="space-y-1">
                {knowledge.items.map((hit) => (
                  <li key={`${hit.ref.kind}:${hit.ref.id}`}>
                    <button className="flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-muted" onClick={() => void openKnowledge(hit)} type="button">
                      <span className="truncate text-sm font-medium">{hit.title || hit.ref.id}</span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">{hit.snippet || hit.notebookPath}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            {allDone && [notes, sessions, knowledge].some((source) => source.status === 'done') && !hasResults && (
              <p className="text-sm text-muted-foreground">{t('searchPage.noResults')}</p>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
