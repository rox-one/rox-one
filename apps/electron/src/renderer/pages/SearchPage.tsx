import { useAtomValue } from 'jotai'
import { Search } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { SearchHit } from '@rox/core/knowledge'
import { windowWorkspaceIdAtom, sessionMetaMapAtom } from '@/atoms/sessions'
import { Input } from '@/components/ui/input'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { resolveKnowledgeApi, searchHitRoute, searchKnowledge } from '../knowledge/KnowledgeHome'

type NoteResult = Awaited<ReturnType<Window['electronAPI']['searchNotes']>>[number]
type SessionResult = Awaited<ReturnType<Window['electronAPI']['searchSessionContent']>>[number]
type SourceState<T> = { status: 'idle' | 'loading' | 'done' | 'unavailable'; items: T[] }

interface SearchPageProps {
  initialQuery: string
}

export default function SearchPage({ initialQuery }: SearchPageProps) {
  const { t } = useTranslation()
  const { navigate: navigateInPanel } = useNavigation()
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  const sessionMeta = useAtomValue(sessionMetaMapAtom)
  const [query, setQuery] = useState(initialQuery)
  const [notes, setNotes] = useState<SourceState<NoteResult>>({ status: 'idle', items: [] })
  const [sessions, setSessions] = useState<SourceState<SessionResult>>({ status: 'idle', items: [] })
  const [knowledge, setKnowledge] = useState<SourceState<SearchHit>>({ status: 'idle', items: [] })
  const requestVersion = useRef(0)
  const currentQuery = useRef(query.trim())
  const currentWorkspaceId = useRef(workspaceId)
  currentQuery.current = query.trim()
  currentWorkspaceId.current = workspaceId

  useEffect(() => {
    setQuery(initialQuery)
  }, [initialQuery])

  useEffect(() => {
    const request = ++requestVersion.current
    const q = query.trim()
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

    const isCurrent = () => request === requestVersion.current
    const timer = window.setTimeout(() => {
      void window.electronAPI.searchNotes(workspaceId, q).then(
        (items) => { if (isCurrent()) setNotes({ status: 'done', items }) },
        () => { if (isCurrent()) setNotes({ status: 'unavailable', items: [] }) },
      )
      void window.electronAPI.searchSessionContent(workspaceId, q).then(
        (items) => { if (isCurrent()) setSessions({ status: 'done', items }) },
        () => { if (isCurrent()) setSessions({ status: 'unavailable', items: [] }) },
      )
      void searchKnowledge(resolveKnowledgeApi(), workspaceId, q).then(
        (items) => {
          if (!isCurrent()) return
          setKnowledge(items === null
            ? { status: 'unavailable', items: [] }
            : { status: 'done', items })
        },
        () => { if (isCurrent()) setKnowledge({ status: 'unavailable', items: [] }) },
      )
    }, 180)

    return () => {
      window.clearTimeout(timer)
      requestVersion.current++
    }
  }, [query, workspaceId])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextQuery = query.trim()
    if (!nextQuery) return
    navigateInPanel(routes.view.search(nextQuery))
  }

  const openNote = async (note: NoteResult) => {
    if (!workspaceId || !query.trim()) return
    try {
      const current = await window.electronAPI.searchNotes(workspaceId, query.trim())
      if (currentQuery.current !== query.trim() || currentWorkspaceId.current !== workspaceId) return
      if (!current.some((candidate) => candidate.id === note.id)) return
      navigateInPanel(routes.view.notes(note.id))
    } catch {
      // A failed freshness check must never open a stale search result.
    }
  }

  const openSession = async (session: SessionResult) => {
    if (!workspaceId || !query.trim()) return
    try {
      const current = await window.electronAPI.searchSessionContent(workspaceId, query.trim())
      if (currentQuery.current !== query.trim() || currentWorkspaceId.current !== workspaceId) return
      if (!current.some((candidate) => candidate.sessionId === session.sessionId)) return
      navigateInPanel(routes.view.allSessions(session.sessionId))
    } catch {
      // A failed freshness check must never open a stale search result.
    }
  }

  const openKnowledge = async (hit: SearchHit) => {
    if (!workspaceId || !query.trim()) return
    try {
      const current = await searchKnowledge(resolveKnowledgeApi(), workspaceId, query.trim())
      if (currentQuery.current !== query.trim() || currentWorkspaceId.current !== workspaceId) return
      if (!current?.some((candidate) => candidate.ref.kind === hit.ref.kind && candidate.ref.id === hit.ref.id)) return
      navigateInPanel(searchHitRoute(hit))
    } catch {
      // A failed freshness check must never open a stale search result.
    }
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
      <div aria-live="polite" className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {!query.trim() ? (
          <p className="text-sm text-muted-foreground">{t('searchPage.empty')}</p>
        ) : (
          <div className="space-y-7">
            <section>
              {sourceHeading(t('searchPage.notes'), notes)}
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
