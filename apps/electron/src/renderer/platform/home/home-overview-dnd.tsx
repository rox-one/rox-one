/**
 * Overview dashboard edit chrome (@dnd-kit). Loaded only while Home is in
 * customize mode so the view-mode route chunk stays free of dnd-kit (PERF Home PR5).
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  HOME_GRID_COLUMNS,
  HOME_GRID_GAP,
  HOME_GRID_ROW_HEIGHT,
  HOME_WIDGET_ALLOWED_SIZES,
  availableWidgets,
  isHomeWidgetId,
  moveWidgetVisual,
  removeWidget,
  resizeWidget,
  setWidgetAppearance,
  shiftWidgetVisual,
  widgetRowSpan,
  widgetSpan,
  widgetWidth,
  type HomeDashboardLayout,
  type HomeWidgetPlacement,
  type PackedCell,
} from './dashboard-layout'
import { HOME_WIDGETS } from './widgets'
import type { WidgetEditProps } from './widget-kit'
import { widgetAppearanceStyle } from './widget-appearance'

class WidgetBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown) { console.warn('[home] widget crashed', error) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function SortableWidget({
  placement,
  containerWidth,
  cell,
  span,
  trackPitch,
  width,
  layout,
  onChange,
}: {
  placement: HomeWidgetPlacement
  containerWidth: number
  cell: PackedCell
  span: number
  trackPitch: number
  width: number
  layout: HomeDashboardLayout
  onChange: (next: HomeDashboardLayout) => void
}) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: placement.id })
  const def = HOME_WIDGETS[placement.id]
  const edit: WidgetEditProps = {
    size: placement.size,
    sizes: HOME_WIDGET_ALLOWED_SIZES[placement.id],
    appearance: placement.appearance,
    onAppearance: (appearance) => onChange(setWidgetAppearance(layout, placement.id, appearance)),
    onResize: (size) => onChange(resizeWidget(layout, placement.id, size)),
    onRemove: () => onChange(removeWidget(layout, placement.id)),
    onShift: (delta) => onChange(shiftWidgetVisual(layout, placement.id, delta, containerWidth)),
    dragHandle: { ...attributes, ...listeners, ref: setActivatorNodeRef },
  }
  const Widget = def.Component
  const rowSpan = widgetRowSpan(placement.size)
  const height = rowSpan * HOME_GRID_ROW_HEIGHT + (rowSpan - 1) * HOME_GRID_GAP
  return (
    <div
      ref={setNodeRef}
      data-home-cell={placement.id}
      data-home-size={placement.size}
      className={cn('min-h-0 min-w-0', isDragging && 'relative z-raised opacity-80')}
      style={{ ...widgetAppearanceStyle(placement.appearance), gridColumn: `${cell.col + 1} / span ${span}`, gridRow: `${Math.round((cell.row * (HOME_GRID_ROW_HEIGHT + HOME_GRID_GAP)) / trackPitch) + 1} / span ${Math.ceil((height + HOME_GRID_GAP) / trackPitch)}`, height, alignSelf: 'start', transform: CSS.Translate.toString(transform), transition }}
    >
      <WidgetBoundary
        fallback={
          <div data-home-widget={placement.id} className={cn('rox-home-widget flex flex-col justify-center rounded-[var(--radius-card)] px-3 text-base', 'h-full')}>
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

export default function HomeOverviewEditGrid({
  layout,
  visual,
  packed,
  width,
  trackPitch,
  packedGridRef,
  pickerOpen,
  onChange,
  onOpenPicker,
}: {
  layout: HomeDashboardLayout
  visual: { widgets: HomeWidgetPlacement[] }
  packed: { cells: Map<string, PackedCell> }
  width: number
  trackPitch: number
  packedGridRef: React.RefObject<HTMLDivElement>
  pickerOpen: boolean
  onChange: (next: HomeDashboardLayout) => void
  onOpenPicker: () => void
}) {
  const { t } = useTranslation()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const ids = React.useMemo(() => visual.widgets.map((w) => w.id), [visual])
  const hasMore = availableWidgets(layout).length > 0
  const onDragEnd = (event: DragEndEvent) => {
    const active = String(event.active.id)
    const over = event.over ? String(event.over.id) : null
    if (!over || active === over || !isHomeWidgetId(active) || !isHomeWidgetId(over)) return
    onChange(moveWidgetVisual(layout, active, over, width))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div
          ref={packedGridRef}
          className="grid"
          style={{ gridTemplateColumns: `repeat(${HOME_GRID_COLUMNS}, minmax(0, 1fr))`, gridAutoRows: '1px', columnGap: HOME_GRID_GAP }}
          data-home-grid=""
          data-home-editing=""
        >
          {visual.widgets.map((placement) => (
            <SortableWidget
              key={placement.id}
              placement={placement}
              containerWidth={width}
              cell={packed.cells.get(placement.id)!}
              span={widgetSpan(placement.size, width)}
              trackPitch={trackPitch}
              width={widgetWidth(widgetSpan(placement.size, width), width)}
              layout={layout}
              onChange={onChange}
            />
          ))}
          {hasMore && !pickerOpen ? (
            <button
              type="button"
              onClick={onOpenPicker}
              className="rox-home-add-cell flex min-w-0 flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] text-base font-bold text-muted-foreground hover:text-foreground"
              style={{ gridColumn: `span ${widgetSpan('S', width)} / span ${widgetSpan('S', width)}`, gridRow: `span ${Math.ceil(widgetRowSpan('S') * (HOME_GRID_ROW_HEIGHT + HOME_GRID_GAP) / trackPitch)}`, height: widgetRowSpan('S') * (HOME_GRID_ROW_HEIGHT + HOME_GRID_GAP) - HOME_GRID_GAP, alignSelf: 'start' }}
            >
              <Plus className="icon-rail" />
              {t('workbench.home.edit.addWidget')}
            </button>
          ) : null}
        </div>
      </SortableContext>
    </DndContext>
  )
}
