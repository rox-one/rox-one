/**
 * Edit-mode Glance page: @dnd-kit lives ONLY in this chunk (PERF Home PR5).
 * View mode renders from GlanceHome without pulling dnd-kit into the page graph.
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, ChevronLeft, ChevronRight, Columns3, GripVertical, Plus, Settings2, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  addColumn,
  addGroupChild,
  addWidgetInstance,
  findWidget,
  moveColumn,
  moveWidgetInstance,
  removeColumn,
  removePage,
  removeWidgetInstance,
  resizeColumnByDrag,
  setColumnSize,
  shiftGroupChild,
  shiftWidgetInstance,
  updatePage,
  updateWidgetInstance,
  type GlanceColumn,
  type GlanceLayout,
  type GlancePage,
  type GlanceWidgetInstance,
} from './model'
import { getGlanceWidget, glanceWidgetTitle } from './registry'
import { useNearViewport } from './idle-mount'
import {
  ColumnResizeHandle,
  GlanceSelect,
  GlanceSettingsDialog,
  GlanceWidgetPicker,
  GroupBody,
  HeightResizeHandle,
  IconButton,
  WidgetBody,
  PAGE_MAX_WIDTH,
  SMALL_COLUMN_PX,
  useNarrow,
  useWidth,
} from './GlanceHome'

export function GlancePageEdit({
  layout,
  page,
  onChange,
  onDeleted,
}: {
  layout: GlanceLayout
  page: GlancePage
  onChange: (next: GlanceLayout) => void
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const containerRef = useRef<HTMLDivElement>(null)
  const narrow = useNarrow(containerRef, 900)

  const onDragEnd = (event: DragEndEvent) => {
    const active = String(event.active.id)
    const overId = event.over ? String(event.over.id) : null
    if (!overId || active === overId) return
    const targetColumn = page.columns.find((c) => c.id === overId || `drop:${c.id}` === overId)
    if (targetColumn) {
      onChange(moveWidgetInstance(layout, active, { pageId: page.id, columnId: targetColumn.id, index: targetColumn.widgets.length }))
      return
    }
    const over = findWidget(layout, overId)
    if (!over || over.at.groupId || over.at.pageId !== page.id) return
    onChange(moveWidgetInstance(layout, active, { pageId: page.id, columnId: over.at.columnId, index: over.at.index }))
  }

  const settingsTarget = settingsFor ? findWidget(layout, settingsFor) : null

  return (
    <div ref={containerRef} className="mx-auto flex w-full min-w-0 flex-col gap-2" style={{ maxWidth: PAGE_MAX_WIDTH[page.width] }} data-glance-page={page.id} data-glance-editing="">
      <div className="flex flex-wrap items-center gap-2 text-sm" data-glance-page-toolbar="">
        <input
          value={page.title}
          onChange={(e) => onChange(updatePage(layout, page.id, { title: e.target.value }))}
          aria-label={t('glance.pageTitle')}
          placeholder={t('notes.untitled')}
          className="h-7 w-48 rounded-[var(--radius-control)] bg-surface-hover px-2 text-sm font-bold outline-none focus:bg-surface-pressed"
        />
        <GlanceSelect
          label={t('glance.pageWidth')}
          value={page.width}
          onChange={(v) => onChange(updatePage(layout, page.id, { width: v as GlancePage['width'] }))}
          options={(['slim', 'default', 'wide'] as const).map((w) => ({ value: w, label: t(w === 'default' ? 'common.default' : w === 'slim' ? 'glance.column.small' : 'glance.column.full') }))}
          className="w-32"
        />
        <IconButton label={t('kanban.column.add')} onClick={() => onChange(addColumn(layout, page.id))} testId="add-column"><Columns3 className="icon-toolbar" /></IconButton>
        <span className="flex-1" />
        <IconButton
          label={t('common.delete')}
          danger
          testId="delete-page"
          onClick={() => {
            onChange(removePage(layout, page.id))
            onDeleted()
          }}
        >
          <Trash2 className="icon-toolbar" />
        </IconButton>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <div
          className={cn('grid min-w-0', narrow ? 'grid-cols-1' : '')}
          style={narrow ? undefined : { gridTemplateColumns: page.columns.map((c) => (c.size === 'small' ? `${SMALL_COLUMN_PX}px` : 'minmax(0, 1fr)')).join(' ') }}
          data-glance-columns={page.columns.length}
        >
          {page.columns.map((column, ci) => (
            <EditColumn
              key={column.id}
              layout={layout}
              page={page}
              column={column}
              index={ci}
              onChange={onChange}
              onSettings={setSettingsFor}
              onAdd={() => setPickerFor(column.id)}
              last={ci === page.columns.length - 1}
            />
          ))}
        </div>
      </DndContext>
      {pickerFor ? (
        <GlanceWidgetPicker
          onClose={() => setPickerFor(null)}
          onPick={(def) => {
            onChange(addWidgetInstance(layout, page.id, pickerFor, { type: def.type, config: { ...def.defaultConfig } }))
            setPickerFor(null)
          }}
          onPickGroup={() => {
            onChange(addWidgetInstance(layout, page.id, pickerFor, { type: 'group', config: {}, children: [] }))
            setPickerFor(null)
          }}
        />
      ) : null}
      {settingsTarget ? (
        <GlanceSettingsDialog
          key={settingsTarget.widget.id}
          widget={settingsTarget.widget}
          onClose={() => setSettingsFor(null)}
          onSave={(patch) => {
            onChange(updateWidgetInstance(layout, settingsTarget.widget.id, patch))
            setSettingsFor(null)
          }}
          onAddChild={settingsTarget.widget.type === 'group' ? (def) => onChange(addGroupChild(layout, settingsTarget.widget.id, { type: def.type, config: { ...def.defaultConfig } })) : undefined}
          onShiftChild={settingsTarget.widget.type === 'group' ? (childId, delta) => onChange(shiftGroupChild(layout, settingsTarget.widget.id, childId, delta)) : undefined}
          onChildSettings={settingsTarget.widget.type === 'group' ? (childId) => setSettingsFor(childId) : undefined}
          onRemoveChild={settingsTarget.widget.type === 'group' ? (childId) => onChange(removeWidgetInstance(layout, childId)) : undefined}
        />
      ) : null}
    </div>
  )
}

function EditColumn({
  layout,
  page,
  column,
  index,
  onChange,
  onSettings,
  onAdd,
  last,
}: {
  layout: GlanceLayout
  page: GlancePage
  column: GlanceColumn
  index: number
  onChange: (next: GlanceLayout) => void
  onSettings: (id: string) => void
  onAdd: () => void
  last: boolean
}) {
  const { t } = useTranslation()
  const { setNodeRef, isOver } = useDroppable({ id: `drop:${column.id}` })
  const fulls = page.columns.filter((c) => c.size === 'full').length
  return (
    <section
      ref={setNodeRef}
      className={cn('rox-grid-tile relative flex min-w-0 flex-col', !last && 'pr-px', isOver && 'bg-surface-hover')}
      aria-label={t('glance.columnN', { n: index + 1 })}
      data-glance-column={column.size}
    >
      <div className="flex h-7 items-center gap-1 px-2 text-xs text-muted-foreground" data-glance-column-toolbar="">
        <GlanceSelect
          label={t('glance.columnSize')}
          value={column.size}
          onChange={(v) => onChange(setColumnSize(layout, page.id, column.id, v as GlanceColumn['size']))}
          options={[
            { value: 'small', label: t('glance.column.small'), disabled: column.size === 'full' && fulls <= 1 },
            { value: 'full', label: t('glance.column.full'), disabled: column.size === 'small' && fulls >= 2 },
          ]}
          className="w-28"
        />
        <IconButton label={t('glance.moveLeft')} onClick={() => onChange(moveColumn(layout, page.id, column.id, -1))}><ChevronLeft className="icon-caption" /></IconButton>
        <IconButton label={t('glance.moveRight')} onClick={() => onChange(moveColumn(layout, page.id, column.id, 1))}><ChevronRight className="icon-caption" /></IconButton>
        <span className="flex-1" />
        {page.columns.length > 1 ? (
          <IconButton label={t('kanban.column.remove')} danger onClick={() => onChange(removeColumn(layout, page.id, column.id))}><X className="icon-caption" /></IconButton>
        ) : null}
      </div>
      <SortableContext items={column.widgets.map((w) => w.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-w-0 flex-col">
          {column.widgets.map((widget) => (
            <EditCard key={widget.id} layout={layout} widget={widget} column={column.size} onChange={onChange} onSettings={onSettings} />
          ))}
        </div>
      </SortableContext>
      <button type="button" onClick={onAdd} className="rox-home-add-cell m-2 flex h-12 items-center justify-center gap-1 rounded-[var(--radius-control)] text-sm font-bold text-muted-foreground hover:text-foreground" data-glance-add-widget={column.id}>
        <Plus className="icon-toolbar" />
        {t('workbench.home.edit.addWidget')}
      </button>
      {!last ? <ColumnResizeHandle size={column.size} onResize={(dx) => onChange(resizeColumnByDrag(layout, page.id, column.id, dx))} /> : null}
    </section>
  )
}

function EditCard({
  layout,
  widget,
  column,
  onChange,
  onSettings,
}: {
  layout: GlanceLayout
  widget: GlanceWidgetInstance
  column: 'small' | 'full'
  onChange: (next: GlanceLayout) => void
  onSettings: (id: string) => void
}) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id })
  const [viewRef, near] = useNearViewport<HTMLDivElement>()
  const [previewHeight, setPreviewHeight] = useState<number | undefined>(undefined)
  const width = useWidth(viewRef)
  const def = widget.type === 'group' ? null : getGlanceWidget(widget.type)
  const title = widget.title ?? (widget.type === 'group' ? t('sidebar.group') : def ? glanceWidgetTitle(def, t) : widget.type)
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('rox-grid-tile relative min-w-0', isDragging && 'z-raised opacity-80')}
      data-glance-widget={widget.type}
      data-glance-id={widget.id}
      data-glass-slot={def?.frameless ? undefined : 'card'}
      aria-label={title}
    >
      <header className="flex h-7 shrink-0 items-center gap-1 px-3">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="-ml-1 flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-pressed hover:text-foreground active:cursor-grabbing"
          aria-label={t('workbench.home.edit.drag', { name: title })}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') { event.preventDefault(); onChange(shiftWidgetInstance(layout, widget.id, -1)) }
            else if (event.key === 'ArrowDown') { event.preventDefault(); onChange(shiftWidgetInstance(layout, widget.id, 1)) }
          }}
        >
          <GripVertical className="icon-toolbar" />
        </button>
        <button
          type="button"
          onClick={() => onChange(updateWidgetInstance(layout, widget.id, { collapsed: !widget.collapsed }))}
          className="group flex min-w-0 items-center gap-0.5 text-sm font-bold uppercase caps-label text-muted-foreground hover:text-foreground"
          aria-expanded={!widget.collapsed}
        >
          <span className="truncate" title={title}>{title}</span>
          <ChevronDown className={cn('icon-caption shrink-0 opacity-0 transition group-hover:opacity-100', widget.collapsed && '-rotate-90 opacity-100')} />
        </button>
        <span className="flex-1" />
        <IconButton label={t('glance.settings', { name: title })} onClick={() => onSettings(widget.id)} testId="settings"><Settings2 className="icon-toolbar" /></IconButton>
        <IconButton label={t('workbench.home.edit.remove', { name: title })} danger onClick={() => onChange(removeWidgetInstance(layout, widget.id))} testId="remove"><X className="icon-toolbar" /></IconButton>
      </header>
      <div
        ref={viewRef}
        className={cn('min-w-0 px-3 pb-3', widget.collapsed && 'hidden', (previewHeight ?? widget.height) !== undefined && 'overflow-y-auto')}
        style={(previewHeight ?? widget.height) !== undefined ? { height: previewHeight ?? widget.height } : undefined}
      >
        {widget.collapsed ? null : near ? (
          widget.type === 'group' ? (
            <GroupBody group={widget} column={column} width={width} layout={layout} onChange={onChange} />
          ) : def ? (
            <WidgetBody def={def} widget={widget} column={column} width={width} layout={layout} onChange={onChange} />
          ) : (
            <p className="text-sm text-muted-foreground">{t('glance.unknownWidget')}</p>
          )
        ) : (
          <div className="h-24 animate-pulse rounded-[var(--radius-control)] bg-surface-hover" aria-hidden data-glance-skeleton="" />
        )}
      </div>
      {!widget.collapsed ? (
        <HeightResizeHandle
          bodyRef={viewRef}
          onPreview={setPreviewHeight}
          onCommit={(h) => { setPreviewHeight(undefined); onChange(updateWidgetInstance(layout, widget.id, { height: h })) }}
        />
      ) : null}
    </article>
  )
}
