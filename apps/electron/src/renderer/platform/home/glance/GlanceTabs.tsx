/**
 * Home page tabs: built-in «Обзор» + Glance pages, presets, import/export.
 * Kept separate from GlanceHome so the Home entry only pulls this small strip.
 */
import * as React from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Download, Plus, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { addPage, exportGlance, mergeImportedPages, movePage, parseGlanceImport, type GlanceLayout } from './model'
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
  const addFromPreset = (presetId: string) => {
    const preset = GLANCE_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    const next = addPage(layout, preset.build(t(preset.titleKey)))
    onChange(next)
    const created = next.pages[next.pages.length - 1]
    if (created && next.pages.length > layout.pages.length) onSelect(created.id)
    setPresetsOpen(false)
  }
  const doExport = () => {
    const data = JSON.stringify(exportGlance(layout), null, 2)
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'rox-home-pages.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const doImport = async (file: File) => {
    const parsed = parseGlanceImport(await file.text())
    if (!parsed.ok) {
      toast.error(t('glance.import.invalid'))
      return
    }
    const next = mergeImportedPages(layout, parsed.pages, 'append')
    onChange(next)
    toast.success(t('glance.import.done'))
  }
  return (
    <div className="relative flex min-w-0 flex-wrap items-center gap-1" role="tablist" aria-label={t('glance.pages')} data-home-tabs="">
      <TabButton active={activeId === null} onClick={() => onSelect(null)}>{t('glance.overview')}</TabButton>
      {layout.pages.map((page, i) => (
        <span key={page.id} className="flex items-center">
          {editing && activeId === page.id && i > 0 ? (
            <IconButton label={t('glance.moveLeft')} onClick={() => onChange(movePage(layout, page.id, -1))}><ChevronLeft className="icon-caption" /></IconButton>
          ) : null}
          <TabButton active={activeId === page.id} onClick={() => onSelect(page.id)} pageId={page.id}>{page.title || t('glance.untitled')}</TabButton>
          {editing && activeId === page.id && i < layout.pages.length - 1 ? (
            <IconButton label={t('glance.moveRight')} onClick={() => onChange(movePage(layout, page.id, 1))}><ChevronRight className="icon-caption" /></IconButton>
          ) : null}
        </span>
      ))}
      <IconButton label={t('glance.addPage')} onClick={() => setPresetsOpen((v) => !v)} pressed={presetsOpen} testId="add-page"><Plus className="icon-toolbar" /></IconButton>
      <span className="flex-1" />
      {layout.pages.length > 0 ? (
        <IconButton label={t('glance.export')} onClick={doExport} testId="export"><Download className="icon-toolbar" /></IconButton>
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
      {presetsOpen ? (
        <div className="rox-home-widget absolute left-0 top-full z-popover mt-1 flex w-[320px] flex-col gap-1 rounded-[var(--radius-card)] p-2 shadow-middle" role="menu" data-home-presets="">
          {GLANCE_PRESETS.map((preset) => (
            <button key={preset.id} type="button" role="menuitem" onClick={() => addFromPreset(preset.id)} className="flex flex-col rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-surface-pressed" data-home-preset={preset.id}>
              <span className="text-sm font-bold text-foreground">{t(preset.titleKey)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
