/**
 * Home shell: page tabs over either the built-in «Обзор» dashboard or a
 * Glance-style page. The page view is a lazy chunk, loaded on first use.
 */
import * as React from 'react'
import { Suspense, lazy, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, SlidersHorizontal } from 'lucide-react'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { HomePageTabs } from './GlanceTabs'
import { useGlanceLayout } from './useGlanceLayout'

const GlancePageView = lazy(() => import('./GlanceHome').then((m) => ({ default: m.GlancePageView })))

export function HomeGlanceShell({ overview }: { overview: React.ReactNode }) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const [layout, setLayout, writable] = useGlanceLayout(workspaceId)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const page = activeId ? layout.pages.find((p) => p.id === activeId) ?? null : null
  useEffect(() => {
    if (activeId && !page) setActiveId(null)
  }, [activeId, page])
  useEffect(() => setEditing(false), [activeId, workspaceId])
  return (
    <div className="flex h-full min-h-0 flex-col" data-home-shell="">
      <div className="mx-auto flex w-full max-w-[1920px] shrink-0 items-center gap-2 px-6 pt-3">
        <HomePageTabs layout={layout} activeId={page?.id ?? null} onSelect={setActiveId} onChange={setLayout} editing={editing} />
        {page ? (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            disabled={!writable}
            data-home-action={editing ? 'done' : 'customize'}
            className={cn('flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-control)] px-2.5 text-sm font-bold', editing ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-surface-pressed hover:text-foreground')}
          >
            {editing ? <Check className="icon-toolbar" /> : <SlidersHorizontal className="icon-toolbar" />}
            {editing ? t('workbench.home.edit.done') : t('workbench.home.edit.customize')}
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        {page ? (
          <div className="h-full overflow-y-auto overflow-x-hidden px-6 pb-8 pt-3" data-panel-density="grid">
            <Suspense fallback={<GlancePageSkeleton />}>
              <GlancePageView layout={layout} page={page} onChange={setLayout} editing={editing} onDeleted={() => setActiveId(null)} />
            </Suspense>
          </div>
        ) : (
          overview
        )}
      </div>
    </div>
  )
}

/** Shown while the page chunk loads: placeholder cards in a small/full/small layout. */
function GlancePageSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-[1600px] gap-3" style={{ gridTemplateColumns: '300px minmax(0, 1fr) 300px' }} aria-busy="true" data-glance-skeleton="">
      {[3, 4, 3].map((n, c) => (
        <div key={c} className="flex flex-col gap-3">
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-[var(--radius-card)] bg-surface-hover" />
          ))}
        </div>
      ))}
    </div>
  )
}
