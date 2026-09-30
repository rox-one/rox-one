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
import { loadWorkspaceJson, saveWorkspaceJson, subscribeWorkspaceJson } from '@/lib/extra-screens/storage'
import { cn } from '@/lib/utils'
import {
  DEFAULT_HOME_LAYOUT,
  HOME_GRID_COLUMNS,
  HOME_WIDGET_DEFAULT_SIZE,
  HOME_WIDGET_GROUPS,
  HOME_WIDGET_IDS,
  HOME_LAYOUT_NS,
  addWidget,
  availableWidgets,
  cloneLayout,
  isHomeWidgetId,
  moveWidget,
  normalizeHomeLayout,
  removeWidget,
  resizeWidget,
  shiftWidget,
  widgetSpan,
  type HomeDashboardLayout,
  type HomeWidgetId,
  type HomeWidgetPlacement,
} from './home/dashboard-layout'
import { HOME_WIDGETS } from './home/widgets'
import type { WidgetEditProps } from './home/widget-kit'

/** Global (not per workspace): one dashboard the user arranged once. */
const LAYOUT_SCOPE = null

function loadLayout(): HomeDashboardLayout {
  return loadWorkspaceJson(HOME_LAYOUT_NS, LAYOUT_SCOPE, normalizeHomeLayout)
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
  editing,
  onChange,
  layout,
}: {
  placement: HomeWidgetPlacement
  span: number
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
        onResize: (size) => onChange(resizeWidget(layout, placement.id, size)),
        onRemove: () => onChange(removeWidget(layout, placement.id)),
        onShift: (delta) => onChange(shiftWidget(layout, placement.id, delta)),
        dragHandle: { ...attributes, ...listeners, ref: setActivatorNodeRef },
      }
    : null
  const Widget = def.Component
  return (
    <div
      ref={setNodeRef}
      data-home-cell={placement.id}
      data-home-size={placement.size}
      className={cn('min-w-0', isDragging && 'relative z-10 opacity-80')}
      style={{ gridColumn: `span ${span} / span ${span}`, transform: CSS.Translate.toString(transform), transition }}
    >
      <WidgetBoundary
        fallback={
          <div className="rox-home-widget flex h-full flex-col justify-center rounded-[10px] px-3 text-[13px]">
            <p className="font-bold">{t(def.titleKey)}</p>
            <p className="text-muted-foreground">{t('workbench.home.widgetFailed')}</p>
          </div>
        }
      >
        <Widget edit={edit} span={span} />
      </WidgetBoundary>
    </div>
  )
}

function WidgetPicker({ layout, onToggle, onClose }: { layout: HomeDashboardLayout; onToggle: (id: HomeWidgetId, add: boolean) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const used = new Set(layout.widgets.map((w) => w.id))
  return (
    <section className="rox-home-widget rounded-[12px] px-4 pb-4 pt-3" aria-label={t('workbench.home.picker.title')} data-home-picker="">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-bold text-foreground">{t('workbench.home.picker.title')}</h2>
        <span className="text-[12px] text-muted-foreground">{t('workbench.home.picker.count', { used: used.size, total: HOME_WIDGET_IDS.length })}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
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
                  <li key={id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onToggle(id, !added)}
                      aria-pressed={added}
                      data-home-add={id}
                      title={added ? t('workbench.home.picker.removeHint') : t('workbench.home.picker.addHint')}
                      className={cn(
                        'rox-home-tile group flex h-full w-full min-w-0 items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-left',
                        added && 'rox-home-tile-added',
                      )}
                    >
                      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]', added ? 'bg-accent/20 text-accent' : 'bg-foreground/[0.08] text-foreground')}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[13px] font-bold text-foreground">{t(def.titleKey)}</span>
                          <span className="shrink-0 rounded-[4px] bg-foreground/[0.06] px-1 text-[10px] font-bold leading-4 text-muted-foreground">{HOME_WIDGET_DEFAULT_SIZE[id]}</span>
                        </span>
                        <span className="line-clamp-2 text-[12px] leading-4 text-muted-foreground">{t(def.descriptionKey)}</span>
                      </span>
                      <span className={cn('mt-0.5 flex h-5 shrink-0 items-center gap-0.5 rounded-[4px] px-1 text-[11px] font-bold', added ? 'text-accent' : 'text-muted-foreground group-hover:text-foreground')}>
                        {added ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                        {added ? t('workbench.home.picker.added') : t('workbench.home.picker.add')}
                      </span>
                    </button>
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
        'flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[13px] font-bold',
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
  const [layout, setLayout] = useState<HomeDashboardLayout>(loadLayout)
  const [editing, setEditing] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [gridRef, width] = useContainerWidth<HTMLDivElement>()

  useEffect(() => subscribeWorkspaceJson(HOME_LAYOUT_NS, LAYOUT_SCOPE, () => setLayout(loadLayout())), [])

  const save = useCallback((next: HomeDashboardLayout) => {
    setLayout(next)
    saveWorkspaceJson(HOME_LAYOUT_NS, LAYOUT_SCOPE, next)
  }, [])

  useEffect(() => {
    if (!editing) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        setEditing(false)
        setPickerOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  // Pointer drag; keyboard reorder is arrow keys on the focused handle (WidgetFrame).
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const onDragEnd = (event: DragEndEvent) => {
    const active = String(event.active.id)
    const over = event.over ? String(event.over.id) : null
    if (!over || active === over || !isHomeWidgetId(active) || !isHomeWidgetId(over)) return
    save(moveWidget(layout, active, over))
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
                <HeaderButton testId="reset" onClick={() => save(cloneLayout(DEFAULT_HOME_LAYOUT))}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('workbench.home.edit.reset')}
                </HeaderButton>
                <HeaderButton testId="done" primary onClick={() => { setEditing(false); setPickerOpen(false) }}>
                  <Check className="h-3.5 w-3.5" />
                  {t('workbench.home.edit.done')}
                </HeaderButton>
              </>
            ) : (
              <HeaderButton testId="customize" onClick={() => setEditing(true)}>
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t('workbench.home.edit.customize')}
              </HeaderButton>
            )}
          </div>
        </header>

        {editing ? (
          <p className="text-[12px] text-muted-foreground">{t('workbench.home.edit.hint')}</p>
        ) : null}

        {editing && pickerOpen ? (
          <WidgetPicker
            layout={layout}
            onToggle={(id, add) => save(add ? addWidget(layout, id) : removeWidget(layout, id))}
            onClose={() => setPickerOpen(false)}
          />
        ) : null}

        <div ref={gridRef} className="min-w-0">
          {layout.widgets.length === 0 ? (
            <div className="rox-home-widget flex flex-col items-start gap-2 rounded-[10px] px-4 py-6 text-[13px]" data-home-empty-layout="">
              <p className="font-bold text-foreground">{t('workbench.home.emptyLayout')}</p>
              <p className="text-muted-foreground">{t('workbench.home.emptyLayoutHint')}</p>
              <div className="flex gap-1">
                <HeaderButton onClick={() => { setEditing(true); setPickerOpen(true) }}>
                  <Plus className="h-3.5 w-3.5" />
                  {t('workbench.home.edit.addWidget')}
                </HeaderButton>
                <HeaderButton onClick={() => save(cloneLayout(DEFAULT_HOME_LAYOUT))}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('workbench.home.edit.reset')}
                </HeaderButton>
              </div>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={ids} strategy={rectSortingStrategy}>
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: `repeat(${HOME_GRID_COLUMNS}, minmax(0, 1fr))`, gridAutoRows: '232px' }}
                  data-home-grid=""
                >
                  {layout.widgets.map((placement) => (
                    <SortableWidget
                      key={placement.id}
                      placement={placement}
                      span={widgetSpan(placement.size, width)}
                      editing={editing}
                      layout={layout}
                      onChange={save}
                    />
                  ))}
                  {editing && hasMore && !pickerOpen ? (
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      className="rox-home-add-cell flex min-w-0 flex-col items-center justify-center gap-1 rounded-[10px] text-[13px] font-bold text-muted-foreground hover:text-foreground"
                      style={{ gridColumn: `span ${widgetSpan('S', width)} / span ${widgetSpan('S', width)}` }}
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
