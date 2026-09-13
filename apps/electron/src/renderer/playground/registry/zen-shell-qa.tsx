import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { ComponentEntry } from './types'
import { SidebarDisclosureButton, sidebarSectionDomId } from '@/components/app-shell/SidebarDisclosure'
import { ResizeHandle } from '@/components/app-shell/ResizeHandle'
import { usePanelResize } from '@/hooks/usePanelResize'
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from '@/lib/shell-layout-preferences'
import { buildZenShellQaFixture } from '@/lib/zen-shell-qa-fixture'

const FIXTURE = buildZenShellQaFixture()

function ZenShellQaFixtureView() {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>(() => {
    const next: Record<string, boolean> = {}
    for (const row of FIXTURE.rows) {
      if (row.expandable) next[row.id] = row.depth === 0
    }
    return next
  })
  const [sidebarWidth, setSidebarWidth] = React.useState(SIDEBAR_WIDTH_DEFAULT)
  const [previewWidth, setPreviewWidth] = React.useState(SIDEBAR_WIDTH_DEFAULT)
  const [draft, setDraft] = React.useState(FIXTURE.longTitle)
  const [clicks, setClicks] = React.useState(0)
  const [scrolls, setScrolls] = React.useState(0)

  const bounds = React.useMemo(() => ({
    leftId: 'sidebar',
    rightId: 'content',
    total: 800,
    sizeA: sidebarWidth,
    minA: SIDEBAR_WIDTH_MIN,
    maxA: SIDEBAR_WIDTH_MAX,
    minB: 440,
    maxB: Number.POSITIVE_INFINITY,
  }), [sidebarWidth])

  const resize = usePanelResize({
    onPreview: (sizeA) => { setPreviewWidth(sizeA) },
    onCommit: (sizeA) => {
      setPreviewWidth(sizeA)
      setSidebarWidth(sizeA)
    },
    onCancel: (sizeA) => { setPreviewWidth(sizeA) },
  })

  const visible = React.useMemo(() => {
    const open = new Set<string>()
    for (const [id, isOpen] of Object.entries(expanded)) {
      if (isOpen) open.add(id)
    }
    return FIXTURE.rows.filter((row) => {
      if (!row.parentId) return true
      return open.has(row.parentId)
    })
  }, [expanded])

  const width = resize.dragging ? previewWidth : sidebarWidth

  return (
    <div
      className="flex h-[720px] min-w-[800px] overflow-hidden rounded-[8px] bg-[var(--shell-content,#f4f4f5)]"
      data-testid="zen-shell-qa-fixture"
      data-shell-style="zen"
      style={{ gap: 8, padding: 4 }}
    >
      <aside
        id="zen-shell-qa-sidebar"
        className="flex min-h-0 flex-col overflow-hidden rounded-[8px]"
        data-shell-role="chrome"
        data-testid="zen-shell-qa-sidebar"
        style={{ width }}
        aria-label={t('settings.appearance.zenShellQaSidebar')}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
          {visible.map((row) => {
            const sectionId = sidebarSectionDomId(row.id)
            return (
              <div
                key={row.id}
                className="group/row flex items-center gap-1 py-0.5"
                style={{ paddingLeft: 8 + row.depth * 12 }}
                data-testid={`zen-shell-qa-row-${row.id}`}
              >
                {row.expandable ? (
                  <SidebarDisclosureButton
                    expanded={Boolean(expanded[row.id])}
                    sectionId={sectionId}
                    sectionTitle={row.title}
                    onToggle={() => {
                      setExpanded((prev) => ({ ...prev, [row.id]: !prev[row.id] }))
                    }}
                  />
                ) : (
                  <span className="inline-block h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
                <span className="truncate text-xs" title={row.title}>{row.title}</span>
              </div>
            )
          })}
        </div>
      </aside>
      <ResizeHandle
        labelKey="shell.resize.sidebar"
        controlsId="zen-shell-qa-sidebar"
        valueNow={width}
        valueMin={SIDEBAR_WIDTH_MIN}
        valueMax={SIDEBAR_WIDTH_MAX}
        dragging={resize.dragging}
        onPointerDown={(event) => { resize.handlePointerDown(event, bounds) }}
        onPointerMove={resize.handlePointerMove}
        onPointerUp={resize.handlePointerUp}
        onPointerCancel={resize.handlePointerCancel}
        onLostPointerCapture={resize.handleLostPointerCapture}
        onKeyAdjust={(delta) => { resize.handleKeyAdjust(delta, bounds) }}
        onKeyCommit={resize.handleKeyCommit}
        onKeyCancel={resize.handleKeyCancel}
      />
      <div className="grid min-w-[440px] flex-1 grid-cols-2 gap-2">
        <section
          className="flex flex-col rounded-[8px] p-3"
          data-shell-role="content"
          data-testid="zen-shell-qa-draft"
        >
          <label className="mb-2 text-xs font-medium" htmlFor="zen-shell-qa-draft-input">
            {t('settings.appearance.zenShellQaDraft')}
          </label>
          <textarea
            id="zen-shell-qa-draft-input"
            className="min-h-0 flex-1 resize-none rounded border bg-background p-2 text-sm"
            value={draft}
            onChange={(event) => { setDraft(event.target.value) }}
          />
        </section>
        <section
          className="flex flex-col rounded-[8px] p-3"
          data-shell-role="content"
          data-testid="zen-shell-qa-browser"
        >
          <p className="mb-2 text-xs font-medium">{t('settings.appearance.zenShellQaBrowser')}</p>
          <p className="text-xs" data-testid="zen-shell-qa-clicks">
            {t('settings.appearance.zenShellQaClicks', { count: clicks })}
          </p>
          <p className="mb-2 text-xs" data-testid="zen-shell-qa-scrolls">
            {t('settings.appearance.zenShellQaScrolls', { count: scrolls })}
          </p>
          <button
            type="button"
            className="mb-2 h-8 rounded border px-2 text-xs"
            onClick={() => { setClicks((value) => value + 1) }}
          >
            {t('settings.appearance.zenShellQaBrowser')}
          </button>
          <div
            className="min-h-0 flex-1 overflow-auto rounded border p-2 text-xs"
            data-testid="zen-shell-qa-browser-scroll"
            onScroll={() => { setScrolls((value) => value + 1) }}
          >
            {Array.from({ length: 40 }, (_, index) => (
              <p key={index}>{FIXTURE.longTitle} · {index + 1}</p>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

export const zenShellQaComponents: ComponentEntry[] = [
  {
    id: 'zen-shell-qa-fixture',
    name: 'Zen Shell QA fixture',
    category: 'Unified Shell',
    level: 'Screens',
    description: 'ZS-08 stress fixture: ≥500 nested Russian sidebar rows, two opaque panels, draft + browser click/scroll counters.',
    component: ZenShellQaFixtureView,
    props: [],
    layout: 'full',
    viewport: { id: 'desktop', name: 'Desktop', width: 1440, height: 900 },
  },
]
