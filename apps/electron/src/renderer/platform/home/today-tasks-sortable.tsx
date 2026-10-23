/**
 * Tasks-widget reorder chrome. Isolated so @dnd-kit stays out of the Home
 * overview graph until the Tasks list actually mounts (PERF Home PR5).
 */
import { useTranslation } from 'react-i18next'
import { Check, GripVertical } from 'lucide-react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { setPersonalTaskDone, setPersonalTaskOrders } from './home-actions'
import { reorderedSlots } from './home-data'

type Task = { id: string; title: string; completedAt?: number; dueAt?: number }

function TodayTaskRow({ task, overdue, due, disabled }: { task: Task; overdue: boolean; due?: string; disabled: boolean }) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: disabled || Boolean(task.completedAt) })
  const done = Boolean(task.completedAt)
  const title = task.title || t('workbench.home.tasks.untitled')
  return (
    <li ref={setNodeRef} data-home-row={task.id} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn('group flex min-w-0 items-center gap-1.5 rounded-[var(--radius-control)] px-1 py-0.5', isDragging && 'relative bg-surface-pressed')}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={t(done ? 'workbench.home.tasks.reopen' : 'workbench.home.tasks.complete', { name: title })}
        onClick={() => setPersonalTaskDone(task.id, !done)}
        data-home-task-check={task.id}
        className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-[var(--radius-control)] transition-colors', done ? 'bg-success text-background' : 'bg-surface-hover hover:bg-surface-pressed')}
      >
        {done ? <Check className="icon-caption" /> : null}
      </button>
      <button type="button" onClick={() => navigate(routes.view.tasks(task.id))} className="min-w-0 flex-1 truncate text-left text-base" title={title}>
        <span className={cn(done ? 'text-muted-foreground line-through' : 'text-foreground')}>{title}</span>
      </button>
      {due ? <span className={cn('shrink-0 text-xs', overdue ? 'text-destructive' : 'text-muted-foreground')}>{due}</span> : null}
      {!done ? (
        <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={t('workbench.home.tasks.drag', { name: title })} className="flex h-5 w-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing">
          <GripVertical className="icon-caption" />
        </button>
      ) : null}
    </li>
  )
}

export default function TodayTasksSortable({
  shown,
  open,
  dayStart,
  edit,
  formatDue,
}: {
  shown: Task[]
  open: Task[]
  dayStart: number
  edit: boolean
  formatDue: (dueAt: number) => string
}) {
  const { t } = useTranslation()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const onDragEnd = (event: DragEndEvent) => {
    const over = event.over ? String(event.over.id) : null
    if (!over) return
    setPersonalTaskOrders(reorderedSlots(open, String(event.active.id), over))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={shown.filter((task) => !task.completedAt).map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <ul className="min-h-0 flex-1 overflow-y-auto" aria-label={t('workbench.home.w.tasks')}>
          {shown.map((task) => (
            <TodayTaskRow key={task.id} task={task} disabled={edit} overdue={task.dueAt != null && task.dueAt < dayStart && !task.completedAt} due={task.dueAt != null ? formatDue(task.dueAt) : undefined} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}
