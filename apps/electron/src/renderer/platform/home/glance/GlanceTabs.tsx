/**
 * Home page tabs: built-in «Обзор» + Glance pages, presets, import/export.
 * Kept separate from GlanceHome so the Home entry only pulls this small strip.
 */
import * as React from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Download, FileDown, Plus, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { addPage, exportGlance, mergeImportedPages, movePage, parseGlanceImport, replacePage, type GlanceLayout, type GlancePage } from './model'
import { GLANCE_PRESETS } from './presets'

// ---------------------------------------------------------------------------
// Page tabs
// ---------------------------------------------------------------------------

export function HomePageTabs({
  layout,
  activeId,
  onSelect,
  onChange,
  editing,
}: {
  layout: GlanceLayout
  /** `null` = built-in «Обзор» dashboard. */
  activeId: string | null
  onSelect: (id: string | null) => void
  onChange: (next: GlanceLayout) => void
  editing: boolean
}) {
  const { t } = useTranslation()
  const [presetsOpen, setPresetsOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pendingImport, setPendingImport] = useState<GlancePage[] | null>(null)
  const activePage = activeId ? layout.pages.find((p) => p.id === activeId) ?? null : null
  const addFromPreset = (presetId: string) => {
    const preset = GLANCE_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    const next = addPage(layout, preset.build(t(preset.titleKey)))
    onChange(next)
    const created = next.pages[next.pages.length - 1]
    if (created && next.pages.length > layout.pages.length) onSelect(created.id)
    setPresetsOpen(false)
  }
  const doExport = (pageIds?: readonly string[], name = 'rox-home-pages.json') => {
    const data = JSON.stringify(exportGlance(layout, pageIds), null, 2)
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const doImport = async (file: File) => {
    const parsed = parseGlanceImport(await file.text())
    if (!parsed.ok) {
      toast.error(t('glance.import.invalid'))
      return
    }
    setPresetsOpen(false)
    setPendingImport(parsed.pages)
  }
  const applyImport = (mode: 'append' | 'replace' | 'page') => {
    const pages = pendingImport
    setPendingImport(null)
    if (!pages) return
    if (mode === 'page' && activePage && pages[0]) {
      const next = replacePage(layout, activePage.id, pages[0])
      onChange(next)
      const index = layout.pages.findIndex((p) => p.id === activePage.id)
      const created = next.pages[index]
      if (created) onSelect(created.id)
    } else {
      const next = mergeImportedPages(layout, pages, mode === 'replace' ? 'replace' : 'append')
      onChange(next)
      if (mode === 'replace') {
        const before = layout
        const beforeActive = activeId
        onSelect(next.pages[0]?.id ?? null)
        toast.success(t('glance.import.done'), {
          action: { label: t('menu.undo'), onClick: () => { onChange(before); onSelect(beforeActive) } },
          duration: 10_000,
        })
        return
      }
    }
    toast.success(t('glance.import.done'))
  }
  return (
    <div className="relative flex min-w-0 flex-wrap items-center gap-1" role="tablist" aria-label={t('glance.pages')} data-home-tabs="">
      <TabButton active={activeId === null} onClick={() => onSelect(null)}>{t('devSpace.repo.tabs.overview')}</TabButton>
      {layout.pages.map((page, i) => (
        <span key={page.id} className="flex items-center">
          {editing && activeId === page.id && i > 0 ? (
            <IconButton label={t('glance.moveLeft')} onClick={() => onChange(movePage(layout, page.id, -1))}><ChevronLeft className="icon-caption" /></IconButton>
          ) : null}
          <TabButton active={activeId === page.id} onClick={() => onSelect(page.id)} pageId={page.id}>{page.title || t('notes.untitled')}</TabButton>
          {editing && activeId === page.id && i < layout.pages.length - 1 ? (
            <IconButton label={t('glance.moveRight')} onClick={() => onChange(movePage(layout, page.id, 1))}><ChevronRight className="icon-caption" /></IconButton>
          ) : null}
        </span>
      ))}
      <IconButton label={t('glance.addPage')} onClick={() => setPresetsOpen((v) => !v)} pressed={presetsOpen} testId="add-page"><Plus className="icon-toolbar" /></IconButton>
      <span className="flex-1" />
      {activePage ? (
        <IconButton label={t('glance.exportPage')} onClick={() => doExport([activePage.id], 'rox-home-page.json')} testId="export-page"><FileDown className="icon-toolbar" /></IconButton>
      ) : null}
      {layout.pages.length > 0 ? (
        <IconButton label={t('glance.export')} onClick={() => doExport()} testId="export"><Download className="icon-toolbar" /></IconButton>
      ) : null}
      <IconButton label={t('glance.importAction')} onClick={() => fileRef.current?.click()} testId="import"><Upload className="icon-toolbar" /></IconButton>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void doImport(file)
        }}
      />
      {pendingImport ? (
        <PopoverMenu onClose={() => setPendingImport(null)} className="right-0 w-[280px]" label={t('glance.importAction')} data="import-mode">
          <ImportChoice onClick={() => applyImport('append')} mode="append">{t('glance.import.append')}</ImportChoice>
          {activePage ? (
            <ImportChoice onClick={() => applyImport('page')} mode="page">
              {t('glance.import.replacePage')}
              {pendingImport.length > 1 ? <span className="block text-xs font-normal text-destructive" data-home-import-warning="">{t('glance.import.firstPageOnly', { count: pendingImport.length })}</span> : null}
            </ImportChoice>
          ) : null}
          <ImportChoice onClick={() => applyImport('replace')} mode="replace">{t('glance.import.replaceAll')}</ImportChoice>
          <ImportChoice onClick={() => setPendingImport(null)} mode="cancel">{t('common.cancel')}</ImportChoice>
        </PopoverMenu>
      ) : null}
      {presetsOpen ? (
        <PopoverMenu onClose={() => setPresetsOpen(false)} className="left-0 w-[320px]" label={t('glance.addPage')} data="presets">
          {GLANCE_PRESETS.map((preset) => (
            <button key={preset.id} type="button" role="menuitem" onClick={() => addFromPreset(preset.id)} className="flex flex-col rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-surface-pressed" data-home-preset={preset.id}>
              <span className="text-sm font-bold text-foreground">{t(preset.titleKey)}</span>
            </button>
          ))}
        </PopoverMenu>
      ) : null}
    </div>
  )
}

/**
 * Small menu popover: focuses the first item on open, Arrow/Home/End move
 * between items, Escape closes and returns focus to the opener.
 */
function PopoverMenu({ onClose, className, label, data, children }: { onClose: () => void; className: string; label: string; data: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => { if (opener?.isConnected) opener.focus() }
  }, [])
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    const go = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus() }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    else if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i < 0 ? -1 : i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(-1)
  }
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      {...{ [`data-home-${data}`]: '' }}
      data-glass-slot="popover"
      className={cn('rox-home-widget absolute top-full z-popover mt-1 flex flex-col gap-1 rounded-[var(--radius-card)] p-2 shadow-middle', className)}
    >
      {children}
    </div>
  )
}

function ImportChoice({ onClick, mode, children }: { onClick: () => void; mode: string; children: React.ReactNode }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} data-home-import={mode} className="rounded-[var(--radius-control)] px-2 py-1.5 text-left text-sm font-bold text-foreground hover:bg-surface-pressed">
      {children}
    </button>
  )
}

function TabButton({ active, onClick, children, pageId }: { active: boolean; onClick: () => void; children: React.ReactNode; pageId?: string }) {
  return (
    <button
      type="button"
      // eslint-disable-next-line rox/prefer-primitives -- page strip interleaves reorder buttons between tabs; Tabs primitive cannot host them
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-home-tab={pageId ?? 'overview'}
      className={cn('h-7 max-w-[200px] truncate rounded-[var(--radius-control)] px-2.5 text-sm font-bold', active ? 'bg-surface-selected text-foreground' : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground')}
    >
      {children}
    </button>
  )
}

function IconButton({ label, onClick, children, pressed, testId }: { label: string; onClick: () => void; children: React.ReactNode; pressed?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-glance-action={testId}
      className={cn('flex h-6 min-w-6 items-center justify-center rounded-[var(--radius-control)] px-1 text-muted-foreground hover:bg-surface-pressed hover:text-foreground', pressed && 'bg-surface-pressed text-foreground')}
    >
      {children}
    </button>
  )
}
