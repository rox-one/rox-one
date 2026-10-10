/**
 * «Библиотека» — one catalog screen over six sections (Навыки, Источники,
 * MCP/инструменты, Подключения, Интеграции, Расширения и маркетплейс).
 *
 * The left column holds the section nav and a query field; the right pane
 * renders either the active section (lazily imported) or cross-section search
 * results. Section bodies reuse the shipped catalog pages/components instead of
 * copying them; the pure search/grouping lives in `library-model.ts`.
 */
import { Suspense, lazy, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Blocks, Boxes, DatabaseZap, Package, Plug, Zap } from 'lucide-react'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import { EmptyState, ListRow, ScreenColumn, ScreenDetail, ScreenHeader, ScreenRoot, SectionLabel, TextField } from '../ui'
import {
  LIBRARY_SECTIONS,
  filterLibrarySections,
  groupLibrary,
  isLibrarySectionId,
  librarySectionCounts,
  searchLibrary,
  type LibraryEntry,
  type LibrarySectionId,
} from './library-model'
import { useLibraryIndex } from './use-library-index'

const SECTION_ICON: Record<LibrarySectionId, typeof Zap> = {
  skills: Zap,
  sources: DatabaseZap,
  mcp: Boxes,
  connections: Plug,
  integrations: Blocks,
  extensions: Package,
}

const SkillsSection = lazy(() => import('./sections/SkillsSection'))
const SourcesSection = lazy(() => import('./sections/SourcesSection'))
const McpSection = lazy(() => import('./sections/McpSection'))
const ConnectionsSection = lazy(() => import('./sections/ConnectionsSection'))
const IntegrationsSection = lazy(() => import('./sections/IntegrationsSection'))
const ExtensionsSection = lazy(() => import('./sections/ExtensionsSection'))

interface SectionProps {
  workspaceId: string
  rootPath?: string
}

function SectionBody({ section, workspaceId, rootPath }: { section: LibrarySectionId } & SectionProps) {
  switch (section) {
    case 'skills':
      return <SkillsSection workspaceId={workspaceId} rootPath={rootPath} />
    case 'sources':
      return <SourcesSection workspaceId={workspaceId} rootPath={rootPath} />
    case 'mcp':
      return <McpSection workspaceId={workspaceId} rootPath={rootPath} />
    case 'connections':
      return <ConnectionsSection />
    case 'integrations':
      return <IntegrationsSection workspaceId={workspaceId} rootPath={rootPath} />
    case 'extensions':
      return <ExtensionsSection />
  }
}

export default function LibraryPage({ itemId }: { itemId: string | null }) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? ''
  const [active, setActive] = useState<LibrarySectionId>(isLibrarySectionId(itemId) ? itemId : 'skills')
  const [query, setQuery] = useState('')
  const [indexEnabled, setIndexEnabled] = useState(false)
  const index = useLibraryIndex(workspaceId, indexEnabled)

  const searching = query.trim().length > 0
  const results = useMemo(() => groupLibrary(searchLibrary(index.entries, query)), [index.entries, query])
  const navSections = useMemo(
    () => filterLibrarySections(LIBRARY_SECTIONS, query, (section) => t(section.labelKey)),
    [query, t],
  )
  const counts = useMemo(() => librarySectionCounts(index.entries), [index.entries])

  const openEntry = (entry: LibraryEntry) => {
    if (entry.section === 'skills') {
      navigate(routes.view.skills(entry.id))
      return
    }
    if (entry.section === 'sources' || entry.section === 'mcp') {
      navigate(routes.view.sources({ sourceSlug: entry.id }))
      return
    }
    setActive(entry.section)
    setQuery('')
  }

  const activeDef = LIBRARY_SECTIONS.find((section) => section.id === active)!

  return (
    <ScreenRoot>
      <ScreenColumn width="clamp(240px, 30%, 340px)">
        <ScreenHeader title={t('extraScreens.library.title')} />
        <div className="px-4 pb-2">
          <TextField
            value={query}
            onChange={(value) => {
              setQuery(value)
              if (!indexEnabled) setIndexEnabled(true)
            }}
            placeholder={t('workbench.library.searchPlaceholder')}
            ariaLabel={t('workbench.library.searchPlaceholder')}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-3" data-testid="library-section-nav">
          {navSections.length === 0 && (
            <div className="px-4 py-2 text-small text-muted-foreground">{t('workbench.library.noResults')}</div>
          )}
          {navSections.map((section) => {
            const Icon = SECTION_ICON[section.id]
            const hint = section.hintKey ? t(section.hintKey) : undefined
            const count = indexEnabled && !index.loading ? counts[section.id] : undefined
            return (
              <ListRow key={section.id} active={active === section.id && !searching} onClick={() => { setActive(section.id); setQuery('') }}>
                <Icon aria-hidden className="icon-inline mt-0.5 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body">{t(section.labelKey)}</span>
                  {hint && <span className="block truncate text-small text-muted-foreground">{hint}</span>}
                </span>
                {typeof count === 'number' && <span className="shrink-0 text-small text-muted-foreground">{count}</span>}
              </ListRow>
            )
          })}
        </div>
      </ScreenColumn>

      <ScreenDetail className="min-h-0">
        {!workspaceId ? (
          <EmptyState title={t('workbench.library.noWorkspace')} />
        ) : searching ? (
          <div className="mx-auto w-full max-w-[760px]" data-testid="library-search-results">
            {index.loading && <div className="text-small text-muted-foreground">{t('common.loading')}</div>}
            {!index.loading && results.length === 0 && (
              <div className="text-small text-muted-foreground">{t('workbench.library.noResults')}</div>
            )}
            {results.map((group) => (
              <section key={group.section.id} className="mb-5">
                <SectionLabel>{t(group.section.labelKey)} · {group.entries.length}</SectionLabel>
                {group.entries.map((row) => (
                  <button
                    key={`${group.section.id}:${row.id}`}
                    type="button"
                    onClick={() => openEntry(row)}
                    className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-surface-hover"
                  >
                    <span className="min-w-0 flex-1 truncate" title={row.title}>{row.title}</span>
                    {row.subtitle && <span className="max-w-[45%] shrink-0 truncate text-small text-muted-foreground" title={row.subtitle}>{row.subtitle}</span>}
                  </button>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground" data-testid="library-section-loading">{t('common.loading')}</div>}>
            <div role="region" className="h-full min-h-0" data-testid={`library-section-${active}`} aria-label={t(activeDef.labelKey)}>
              <SectionBody section={active} workspaceId={workspaceId} rootPath={workspace?.rootPath} />
            </div>
          </Suspense>
        )}
      </ScreenDetail>
    </ScreenRoot>
  )
}