/**
 * KnowledgeNavigator (W2, spec S-01 §Режим Знания) — left-nav composition for
 * the Knowledge mode. Prop-less: reads workspace context via atoms/context
 * internally, so AppShell can mount it directly in the navigator slot
 * (W2-NAV wires it behind `isKnowledgeNavigation`).
 *
 * Contents: the section tree (notebooks + static S-01 sections). Full-kernel
 * chrome is debug-only (`import.meta.env.DEV` or CRAFT_DEBUG_KNOWLEDGE_FULL_UI).
 */
import { useSetAtom } from 'jotai'
import { FileDiff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { knowledgeHomeViewAtom } from './KnowledgeHome'
import { KnowledgeNotebookTree } from './KnowledgeNotebookTree'
import { SIYUAN_FULL_SURFACE_ID } from './siyuan-url'

export function shouldShowFullKnowledgeInterface(
  env: { DEV?: boolean; CRAFT_DEBUG_KNOWLEDGE_FULL_UI?: string } = import.meta.env,
): boolean {
  return (
    env.DEV === true ||
    env.CRAFT_DEBUG_KNOWLEDGE_FULL_UI === '1' ||
    env.CRAFT_DEBUG_KNOWLEDGE_FULL_UI === 'true'
  )
}

export function KnowledgeNavigator() {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const setHomeView = useSetAtom(knowledgeHomeViewAtom)
  const showFullInterface = shouldShowFullKnowledgeInterface()
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="border-b border-border px-3 py-2">
        <h2 className="truncate text-[13px] font-semibold text-foreground">
          {t('knowledge.nav.title')}
        </h2>
      </header>
      <div className={cn('min-h-0 flex-1 overflow-y-auto')}>
        <KnowledgeNotebookTree />
      </div>
      <div className="border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={() => {
            // Surface the proposals list in KnowledgeHome (main panel).
            setHomeView('proposals')
            navigate(routes.view.knowledge())
          }}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
            'hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
        >
          <FileDiff className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/80">
            {t('knowledge.proposals.title')}
          </span>
        </button>
      </div>
      {showFullInterface ? (
        <footer className="border-t border-border px-3 py-2">
          <button
            type="button"
            data-testid="knowledge-open-full-interface"
            onClick={() => {
              navigate(routes.view.siyuan({ kind: 'notebook', id: SIYUAN_FULL_SURFACE_ID }))
            }}
            className={cn(
              'w-full rounded-md px-2 py-1.5 text-left text-[11px] leading-snug text-muted-foreground',
              'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            )}
          >
            {t('knowledge.openFullInterface')}
          </button>
        </footer>
      ) : null}
    </div>
  )
}
