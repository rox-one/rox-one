/**
 * Workbench Home Front Page — mode `home`.
 *
 * A composable dashboard: the user assembles it from widgets (Недавние
 * сессии, Центр агентов, Расход и токены, Модели, Задачи, Трекер задач,
 * Встречи, Звонки, Календарь на неделю, Входящие, Трекер входящих, Решения,
 * Лента, Автоматизации, Радар, Фокус, Заметки, Баланс, Быстрые действия…). «Настроить» toggles edit mode: «+ Виджет» picker, drag to
 * reorder (pointer or keyboard), S/M/L size, remove, reset. Otherwise a clean
 * view. Layout persists locally (see platform/home/dashboard-layout.ts).
 * Every widget reads real stores/IPC and clicks through to its screen.
 */
import * as React from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Plus, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { newLocalId, readWorkspaceJsonSnapshot, saveWorkspaceJson, saveWorkspaceJsonIfUnchanged, subscribeWorkspaceJson } from '@/lib/extra-screens/storage'
import { cn } from '@/lib/utils'
import {
  DEFAULT_HOME_LAYOUT,
  HOME_GRID_COLUMNS,
  HOME_GRID_GAP,
  HOME_GRID_ROW_HEIGHT,
  HOME_WIDGET_DEFAULT_SIZE,
  HOME_WIDGET_GROUPS,
  HOME_WIDGET_IDS,
  HOME_LAYOUT_NS,
  addWidget,
  availableWidgets,
  cloneLayout,
  isHomeWidgetId,
  moveWidget,
  isSupportedHomeLayout,
  canReadHomeLayout,
  normalizeHomeLayout,
  persistHomeLayout,
  removeWidget,
  resizeWidget,
  setWidgetAppearance,
  shiftWidget,
  widgetSpan,
  widgetRowSpan,
  widgetWidth,
  type HomeDashboardLayout,
  type HomeWidgetId,
  type HomeWidgetPlacement,
} from './home/dashboard-layout'
import { HOME_WIDGETS } from './home/widgets'
import type { WidgetEditProps } from './home/widget-kit'
import { widgetAppearanceStyle } from './home/widget-appearance'

interface HomeLayoutSnapshot {
  layout: HomeDashboardLayout
  raw: string | null
  writable: boolean
}

function readLayout(workspaceId: string | null): HomeLayoutSnapshot {
  const ownerId = workspaceId ?? 'default'
  const snapshot = readWorkspaceJsonSnapshot(HOME_LAYOUT_NS, workspaceId, normalizeHomeLayout)
  let writable = snapshot.available && snapshot.valid
  let layout = snapshot.value
  if (snapshot.raw !== null && writable) {
    try {
      const raw = JSON.parse(snapshot.raw) as { ownerId?: unknown }
      writable = canReadHomeLayout(raw, ownerId)
      if (!writable) layout = cloneLayout(DEFAULT_HOME_LAYOUT)
    } catch {
      writable = false
      layout = cloneLayout(DEFAULT_HOME_LAYOUT)
    }
  } else if (snapshot.raw === null && workspaceId !== null && writable) {
    const legacy = readWorkspaceJsonSnapshot(HOME_LAYOUT_NS, null, normalizeHomeLayout)
    if (legacy.raw !== null && legacy.valid) {
      try {
        const raw = JSON.parse(legacy.raw) as { ownerId?: unknown }
        if (raw.ownerId === undefined && isSupportedHomeLayout(raw)) layout = legacy.value
      } catch {
        // Keep the scoped default; legacy bytes remain untouched until explicit recovery.
      }
    }
  }
  return { layout, raw: snapshot.raw, writable }
}

function useContainerWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(1200)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width
      if (next) setWidth(next)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

class WidgetBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.warn('[home] widget crashed', error)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function SortableWidget({
  placement,
  span,
  width,
  editing,
  onChange,
  layout,
}: {
  placement: HomeWidgetPlacement
  span: number
  width: number
  editing: boolean
  layout: HomeDashboardLayout
  onChange: (next: HomeDashboardLayout) => void
}) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: placement.id, disabled: !editing })
  const def = HOME_WIDGETS[placement.id]
  const edit: WidgetEditProps | null = editing
    ? {
        size: placement.size,
        appearance: placement.appearance,
        onAppearance: (appearance) => onChange(setWidgetAppearance(layout, placement.id, appearance)),
        onResize: (size) => onChange(resizeWidget(layout, placement.id, size)),
        onRemove: () => onChange(removeWidget(layout, placement.id)),
        onShift: (delta) => onChange(shiftWidget(layout, placement.id, delta)),
        dragHandle: { ...attributes, ...listeners, ref: setActivatorNodeRef },
      }
    : null
  const Widget = def.Component
  const contentSized = placement.id === 'summary' || placement.id === 'quickActions'
  const cellRef = useRef<HTMLDivElement | null>(null)
  const [contentHeight, setContentHeight] = useState(HOME_GRID_ROW_HEIGHT)
  const setCellRef = useCallback((node: HTMLDivElement | null) => {
    cellRef.current = node
    setNodeRef(node)
  }, [setNodeRef])
  // Measure the two fixed-content frames, including their localized header and
  // edit controls. Pixel tracks let them fit without changing saved S/M/L sizes
  // or the exact 232/354/476 px heights of the remaining widgets.
  useLayoutEffect(() => {
    if (!contentSized) return
    const cell = cellRef.current
    if (!cell) return
    let frame: HTMLElement | null = null
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContentHeight(Math.ceil(entry.borderBoxSize[0]?.blockSize ?? entry.target.clientHeight + 1))
    })
    const observeFrame = () => {
      const next = cell.querySelector<HTMLElement>('[data-home-widget]')
      if (next === frame) return
      observer.disconnect()
      frame = next
      if (frame) {
        // offsetHeight rounds to whole pixels; reserve the next pixel until
        // ResizeObserver supplies the unzoomed fractional border-box size.
        setContentHeight(frame.offsetHeight + 1)
        observer.observe(frame)
      }
    }
    observeFrame()
    const replacements = new MutationObserver(observeFrame)
    replacements.observe(cell, { childList: true })
    return () => { observer.disconnect(); replacements.disconnect() }
  }, [contentSized])
  const rowSpan = widgetRowSpan(placement.size)
  const height = contentSized ? contentHeight : rowSpan * HOME_GRID_ROW_HEIGHT + (rowSpan - 1) * HOME_GRID_GAP
  return (
    <div
      ref={setCellRef}
      data-home-cell={placement.id}
      data-home-size={placement.size}
      className={cn('min-h-0 min-w-0', isDragging && 'relative z-10 opacity-80')}
      style={{ ...widgetAppearanceStyle(placement.appearance), gridColumn: `span ${span} / span ${span}`, gridRow: `span ${Math.ceil(height + HOME_GRID_GAP)}`, height: contentSized ? 'fit-content' : height, alignSelf: 'start', transform: CSS.Translate.toString(transform), transition }}
    >
      <WidgetBoundary
        fallback={
          <div data-home-widget={placement.id} className={cn('rox-home-widget flex flex-col justify-center rounded-[var(--radius-card)] px-3 text-[13px]', contentSized ? 'py-3' : 'h-full')}>
            <p className="font-bold">{t(def.titleKey)}</p>
            <p className="text-muted-foreground">{t('workbench.home.widgetFailed')}</p>
          </div>
        }
      >
        <Widget edit={edit} width={width} size={placement.size} />
      </WidgetBoundary>
    </div>
  )
}

function WidgetPreview({ id }: { id: HomeWidgetId }) {
  const { t } = useTranslation()
  const [ref, width] = useContainerWidth<HTMLDivElement>()
  const Preview = HOME_WIDGETS[id].Component
  return (
    <div ref={ref} role="region" className="mt-2 h-[232px] min-w-0 rounded-[var(--radius-card)] border border-foreground/10" data-home-preview={id} aria-label={t('workbench.home.picker.preview')}>
      <WidgetBoundary fallback={<p className="p-3 text-[12px] text-muted-foreground">{t('workbench.home.widgetFailed')}</p>}>
        <Preview edit={null} width={width} size="S" />
      </WidgetBoundary>
    </div>
  )
}

function WidgetPicker({ layout, onToggle, onClose }: { layout: HomeDashboardLayout; onToggle: (id: HomeWidgetId, add: boolean) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const used = new Set(layout.widgets.map((w) => w.id))
  const [previewId, setPreviewId] = useState<HomeWidgetId | null>(null)
  return (
    <section className="rox-home-widget rounded-[var(--radius-card)] px-4 pb-4 pt-3" aria-label={t('workbench.home.picker.title')} data-home-picker="">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-bold text-foreground">{t('workbench.home.picker.title')}</h2>
        <span className="text-[12px] text-muted-foreground">{t('workbench.home.picker.count', { used: used.size, total: HOME_WIDGET_IDS.length })}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          aria-label={t('workbench.home.picker.close')}
          title={t('workbench.home.picker.close')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{t('workbench.home.picker.hint')}</p>
      <div className="mt-2 flex flex-col gap-3">
        {HOME_WIDGET_GROUPS.map((group) => (
          <div key={group.id} data-home-picker-group={group.id}>
            <h3 className="pb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{t(`workbench.home.picker.group.${group.id}`)}</h3>
            <ul className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))' }}>
              {group.widgets.map((id) => {
                const def = HOME_WIDGETS[id]
                const Icon = def.icon
                const added = used.has(id)
                return (
                  <li key={id} className="min-w-0" onMouseEnter={() => setPreviewId(id)} onMouseLeave={() => setPreviewId((current) => current === id ? null : current)}>
                    <button
                      type="button"
                      onClick={() => onToggle(id, !added)}
                      onFocus={() => setPreviewId(id)}
                      onBlur={(event) => {
                        if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) {
                          setPreviewId((current) => current === id ? null : current)
                        }
                      }}
                      aria-pressed={added}
                      data-home-add={id}
                      title={added ? t('workbench.home.picker.removeHint') : t('workbench.home.picker.addHint')}
                      className={cn(
                        'rox-home-tile group flex h-full w-full min-w-0 items-start gap-2.5 rounded-[var(--radius-card)] px-3 py-2.5 text-left',
                        added && 'rox-home-tile-added',
                      )}
                    >
                      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)]', added ? 'bg-accent/20 text-accent' : 'bg-foreground/[0.08] text-foreground')}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[13px] font-bold text-foreground">{t(def.titleKey)}</span>
                          <span className="shrink-0 rounded-[var(--radius-control)] bg-foreground/[0.06] px-1 text-[10px] font-bold leading-4 text-muted-foreground">{HOME_WIDGET_DEFAULT_SIZE[id]}</span>
                        </span>
                        <span className="line-clamp-2 text-[12px] leading-4 text-muted-foreground">{t(def.descriptionKey)}</span>
                      </span>
                      <span className={cn('mt-0.5 flex h-5 shrink-0 items-center gap-0.5 rounded-[var(--radius-control)] px-1 text-[11px] font-bold', added ? 'text-accent' : 'text-muted-foreground group-hover:text-foreground')}>
                        {added ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                        {added ? t('workbench.home.picker.added') : t('workbench.home.picker.add')}
                      </span>
                    </button>
                    {previewId === id ? <WidgetPreview id={id} /> : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

function HeaderButton({ children, onClick, primary, pressed, testId }: { children: React.ReactNode; onClick: () => void; primary?: boolean; pressed?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      data-home-button={testId}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-[13px] font-bold',
        primary ? 'bg-foreground text-background hover:bg-foreground/85' : pressed ? 'bg-foreground/[0.14] text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

export function HomeFrontPage() {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const [stored, setStored] = useState(() => ({ workspaceId, snapshot: readLayout(workspaceId) }))
  const [draft, setDraft] = useState<HomeDashboardLayout | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [persistenceProblem, setPersistenceProblem] = useState<'save' | 'conflict' | 'unavailable' | 'unsupported' | 'backup' | null>(null)
  const [gridRef, width] = useContainerWidth<HTMLDivElement>()
  const baselineRef = useRef(stored.snapshot)
  const editingRef = useRef(false)
  const editing = draft !== null
  editingRef.current = editing
  const layout = stored.workspaceId === workspaceId ? (draft ?? stored.snapshot.layout) : readLayout(workspaceId).layout

  useEffect(() => {
    const initial = readLayout(workspaceId)
    baselineRef.current = initial
    setStored({ workspaceId, snapshot: initial })
    setDraft(null)
    setPersistenceProblem(initial.writable ? null : initial.raw === null ? 'unavailable' : 'unsupported')
    return subscribeWorkspaceJson(HOME_LAYOUT_NS, workspaceId, () => {
      const latest = readLayout(workspaceId)
      if (editingRef.current) setPersistenceProblem('conflict')
      else baselineRef.current = latest
      setStored((current) => current.workspaceId === workspaceId ? { workspaceId, snapshot: latest } : current)
    })
  }, [workspaceId])

  const beginEditing = useCallback(() => {
    const initial = readLayout(workspaceId)
    baselineRef.current = initial
    setStored({ workspaceId, snapshot: initial })
    setDraft(cloneLayout(initial.layout))
    setPersistenceProblem(initial.writable ? null : initial.raw === null ? 'unavailable' : 'unsupported')
  }, [workspaceId])

  const updateDraft = useCallback((next: HomeDashboardLayout) => {
    setDraft(next)
    if (persistenceProblem === 'save') setPersistenceProblem(null)
  }, [persistenceProblem])

  const cancelEditing = useCallback(() => {
    setDraft(null)
    setPickerOpen(false)
    setPersistenceProblem(null)
  }, [])

  const saveDraft = useCallback(() => {
    if (!draft || persistenceProblem === 'conflict') return
    const baseline = baselineRef.current
    if (!baseline.writable) {
      setPersistenceProblem(baseline.raw === null ? 'unavailable' : 'unsupported')
      return
    }
    const latest = readLayout(workspaceId)
    if (!latest.writable || latest.raw !== baseline.raw) {
      setStored({ workspaceId, snapshot: latest })
      setPersistenceProblem(latest.writable ? 'conflict' : latest.raw === null ? 'unavailable' : 'unsupported')
      return
    }
    try {
      const record = persistHomeLayout(draft, workspaceId ?? 'default', newLocalId('home-layout'))
      const written = saveWorkspaceJsonIfUnchanged(HOME_LAYOUT_NS, workspaceId, baseline.raw, record)
      const saved = readLayout(workspaceId)
      if (!written || !saved.writable || JSON.stringify(saved.layout) !== JSON.stringify(draft)) {
        setStored({ workspaceId, snapshot: saved })
        setPersistenceProblem(saved.writable ? 'conflict' : saved.raw === null ? 'unavailable' : 'save')
        return
      }
      baselineRef.current = saved
      setStored({ workspaceId, snapshot: saved })
      setDraft(null)
      setPickerOpen(false)
      setPersistenceProblem(null)
    } catch {
      setPersistenceProblem('save')
    }
  }, [draft, persistenceProblem, workspaceId])
  const recoverLayout = useCallback(() => {
    const baseline = baselineRef.current
    if (baseline.writable || baseline.raw === null) return
    const ownerId = workspaceId ?? 'default'
    try {
      const backupNamespace = `${HOME_LAYOUT_NS}.recovery.${newLocalId('backup')}`
      const backedUp = saveWorkspaceJson(backupNamespace, workspaceId, {
        ownerId,
        revision: newLocalId('home-layout-recovery'),
        savedAt: Date.now(),
        raw: baseline.raw,
      })
      if (!backedUp) {
        setPersistenceProblem('backup')
        return
      }
      const reset = persistHomeLayout(cloneLayout(DEFAULT_HOME_LAYOUT), ownerId, newLocalId('home-layout'))
      const written = saveWorkspaceJsonIfUnchanged(HOME_LAYOUT_NS, workspaceId, baseline.raw, reset)
      const recovered = readLayout(workspaceId)
      if (!written || !recovered.writable) {
        setStored({ workspaceId, snapshot: recovered })
        setPersistenceProblem(recovered.writable ? 'conflict' : 'backup')
        return
      }
      baselineRef.current = recovered
      setStored({ workspaceId, snapshot: recovered })
      setDraft(null)
      setPickerOpen(false)
      setPersistenceProblem(null)
    } catch {
      setPersistenceProblem('backup')
    }
  }, [workspaceId])

  useEffect(() => {
    if (!editing) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) cancelEditing()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancelEditing, editing])

  // Pointer drag; keyboard reorder is arrow keys on the focused handle (WidgetFrame).
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const onDragEnd = (event: DragEndEvent) => {
    const active = String(event.active.id)
    const over = event.over ? String(event.over.id) : null
    if (!over || active === over || !isHomeWidgetId(active) || !isHomeWidgetId(over)) return
    updateDraft(moveWidget(layout, active, over))
  }

  const ids = useMemo(() => layout.widgets.map((w) => w.id), [layout])
  const hasMore = availableWidgets(layout).length > 0

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden" data-home-dashboard={editing ? 'edit' : 'view'}>
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-3 px-6 pb-8 pt-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="text-[20px] font-bold leading-7 text-foreground">{t('workbench.home.title')}</h1>
            {workspace?.name ? <p className="truncate text-[13px] text-muted-foreground">{workspace.name}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-1" data-home-actions="">
            {editing ? (
              <>
                <HeaderButton testId="add" pressed={pickerOpen} onClick={() => setPickerOpen((v) => !v)}>
                  <Plus className="h-3.5 w-3.5" />
                  {t('workbench.home.edit.addWidget')}
                </HeaderButton>
                <HeaderButton testId="reset" onClick={() => updateDraft(cloneLayout(DEFAULT_HOME_LAYOUT))}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('workbench.home.edit.reset')}
                </HeaderButton>
                {persistenceProblem === 'unsupported' ? (
                  <HeaderButton testId="recover" onClick={recoverLayout}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t('workbench.home.edit.recoverFromBackup')}
                  </HeaderButton>
                ) : null}
                <HeaderButton testId="cancel" onClick={cancelEditing}>
                  <X className="h-3.5 w-3.5" />
                  {t('common.cancel')}
                </HeaderButton>
                <HeaderButton testId="done" primary onClick={saveDraft}>
                  <Check className="h-3.5 w-3.5" />
                  {t('common.save')}
                </HeaderButton>
              </>
            ) : (
              <HeaderButton testId="customize" onClick={beginEditing}>
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t('workbench.home.edit.customize')}
              </HeaderButton>
            )}
          </div>
        </header>

        {editing ? (
          <p className="text-[12px] text-muted-foreground">
            {t('workbench.home.edit.hint')}
            {persistenceProblem === 'conflict' ? <span role="alert" className="ml-2 text-destructive">{t('workbench.home.edit.conflict')}</span> : null}
            {persistenceProblem === 'unavailable' ? <span role="alert" className="ml-2 text-destructive">{t('workbench.home.edit.storageUnavailable')}</span> : null}
            {persistenceProblem === 'unsupported' ? <span role="alert" className="ml-2 text-destructive">{t('workbench.home.edit.unsupportedLayout')}</span> : null}
            {persistenceProblem === 'backup' ? <span role="alert" className="ml-2 text-destructive">{t('workbench.home.edit.backupFailed')}</span> : null}
            {persistenceProblem === 'save' ? <span role="alert" className="ml-2 text-destructive">{t('workbench.home.edit.saveFailed')}</span> : null}
          </p>
        ) : null}

        {editing && pickerOpen ? (
          <WidgetPicker
            layout={layout}
            onToggle={(id, add) => updateDraft(add ? addWidget(layout, id) : removeWidget(layout, id))}
            onClose={() => setPickerOpen(false)}
          />
        ) : null}

        <div ref={gridRef} className="min-w-0">
          {layout.widgets.length === 0 ? (
            <div className="rox-home-widget flex flex-col items-start gap-2 rounded-[var(--radius-card)] px-4 py-6 text-[13px]" data-home-empty-layout="">
              <p className="font-bold text-foreground">{t('workbench.home.emptyLayout')}</p>
              <p className="text-muted-foreground">{t('workbench.home.emptyLayoutHint')}</p>
              <div className="flex gap-1">
                <HeaderButton onClick={() => { beginEditing(); setPickerOpen(true) }}>
                  <Plus className="h-3.5 w-3.5" />
                  {t('workbench.home.edit.addWidget')}
                </HeaderButton>
                <HeaderButton onClick={() => { beginEditing(); updateDraft(cloneLayout(DEFAULT_HOME_LAYOUT)) }}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('workbench.home.edit.reset')}
                </HeaderButton>
              </div>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={ids} strategy={rectSortingStrategy}>
                <div
                  className="grid"
                  style={{ gridTemplateColumns: `repeat(${HOME_GRID_COLUMNS}, minmax(0, 1fr))`, gridAutoRows: '1px', columnGap: HOME_GRID_GAP }}
                  data-home-grid=""
                >
                  {layout.widgets.map((placement) => (
                    <SortableWidget
                      key={placement.id}
                      placement={placement}
                      span={widgetSpan(placement.size, width)}
                      width={widgetWidth(widgetSpan(placement.size, width), width)}
                      editing={editing}
                      layout={layout}
                      onChange={updateDraft}
                    />
                  ))}
                  {editing && hasMore && !pickerOpen ? (
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      className="rox-home-add-cell flex min-w-0 flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] text-[13px] font-bold text-muted-foreground hover:text-foreground"
                      style={{ gridColumn: `span ${widgetSpan('S', width)} / span ${widgetSpan('S', width)}`, gridRow: `span ${widgetRowSpan('S') * (HOME_GRID_ROW_HEIGHT + HOME_GRID_GAP)}`, height: widgetRowSpan('S') * (HOME_GRID_ROW_HEIGHT + HOME_GRID_GAP) - HOME_GRID_GAP, alignSelf: 'start' }}
                    >
                      <Plus className="h-5 w-5" />
                      {t('workbench.home.edit.addWidget')}
                    </button>
                  ) : null}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>
    </div>
  )
}
