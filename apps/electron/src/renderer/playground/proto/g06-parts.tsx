/**
 * G6 «Пути и линзы» / Paths & Lenses — prototype parts.
 *
 * Not a story module (no `.playground.tsx` suffix ⇒ not auto-discovered).
 * Stories in this folder compose these parts.
 *
 * Design language is the shipped one: Inter UI face, token classes only,
 * flush panels (`--rox-radius-panel`), 1px seams with an 8/24px hit band,
 * `--chrome-panel-header-height` headers, compact density default.
 *
 * Reused production primitives:
 *  - `ResizeHandle` (accessible `role="separator"` seam: arrows/Home/End/Enter/
 *    Escape, `--panel-sash-hit-width` hit band, shared resize gradient)
 *  - `PANEL_MIN_WIDTH`, `PANEL_SASH_HIT_WIDTH*` from `panel-constants`
 *  - `Tabs` (`@/components/ui/tabs`) for the lens section switcher
 *  - `usePrefersReducedMotion` from the render-profile motion layer
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  ChevronsRight,
  FileText,
  FolderOpen,
  GitBranch,
  Globe,
  Gauge,
  PanelRight,
  Pin,
  PinOff,
  Archive,
  Mail,
  Check,
  AlertTriangle,
  Play,
  CircleSlash,
  Plus,
  Search,
  Maximize2,
  Minimize2,
  X,
  GripVertical,
  ShieldAlert,
  ArrowLeftRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePrefersReducedMotion } from '@/lib/render-profile-motion'
import { ResizeHandle } from '@/components/app-shell/ResizeHandle'
import { PANEL_MIN_WIDTH } from '@/components/app-shell/panel-constants'
import { Tabs, type TabItem } from '@/components/ui/tabs'
import './g06.css'

/* ------------------------------------------------------------------ */
/* Stage sizing                                                        */
/* ------------------------------------------------------------------ */

/**
 * Stage width at which the lens can still dock without squeezing a content
 * panel under its minimum: rail 48 + navigator 340 + panel min 440 + lens 320.
 * Below this the lens morphs into a right-edge sheet (see report §7).
 */
export const LENS_DOCK_MIN = 1148

export function useContainerWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null)
  const [width, setWidth] = React.useState(1440)
  React.useEffect(() => {
    const element = ref.current
    if (!element) return
    if (typeof ResizeObserver === 'undefined') {
      setWidth(element.clientWidth)
      return
    }
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

export function useProtoQuery() {
  return React.useMemo(() => {
    if (typeof window === 'undefined') return new URLSearchParams()
    return new URLSearchParams(window.location.search)
  }, [])
}

/* ------------------------------------------------------------------ */
/* Mock fixtures (ru-first, dense long-running dev workspace)          */
/* ------------------------------------------------------------------ */

export type LaneStatus = 'running' | 'waiting' | 'blocked' | 'done' | 'idle'

export interface ProtoSession {
  id: string
  title: string
  preview: string
  workspace: string
  status: LaneStatus
  unread: number
  pinned?: boolean
  processing?: boolean
  approval?: boolean
  labels?: string[]
  updated: string
  model: string
}

export const LANE_STATUS_LABEL: Record<LaneStatus, string> = {
  running: 'Идёт',
  waiting: 'Ждёт ответа',
  blocked: 'Заблокирована',
  done: 'Готово',
  idle: 'Прочитано',
}

export interface ProtoLane {
  id: string
  label: string
  hint?: string
  empty?: string
  sessions: ProtoSession[]
}

export const PROTO_SESSIONS: ProtoSession[] = [
  {
    id: 's-01',
    title: 'Рефакторинг панельного стека: швы и свопы',
    preview: 'Агент: разложил швы на два шага, нужен выбор варианта свопа',
    workspace: 'rox-app',
    status: 'waiting',
    unread: 3,
    pinned: true,
    approval: true,
    labels: ['архитектура', 'интерфейс'],
    updated: '4 мин',
    model: 'gpt-5.4',
  },
  {
    id: 's-02',
    title: 'Разобрать падения импорта заметок из Obsidian',
    preview: 'Стек: vault-parser.ts:214, нужен доступ к файловой системе',
    workspace: 'rox-app',
    status: 'blocked',
    unread: 2,
    labels: ['заметки'],
    updated: '11 мин',
    model: 'sonnet-4.5',
  },
  {
    id: 's-03',
    title: 'Контраст в тёмных палитрах: nord и tokyo-night',
    preview: 'Проверил 42 пары, три падают ниже 4.5:1',
    workspace: 'design-system',
    status: 'waiting',
    unread: 1,
    labels: ['доступность'],
    updated: '26 мин',
    model: 'gpt-5.4',
  },
  {
    id: 's-04',
    title: 'Миграция токенов плотности на data-density',
    preview: 'Прогоняю визуальные тесты, 6 из 9 зелёные',
    workspace: 'design-system',
    status: 'running',
    unread: 0,
    processing: true,
    labels: ['токены'],
    updated: 'сейчас',
    model: 'gpt-5.4',
  },
  {
    id: 's-05',
    title: 'Поиск по сессиям: кириллица и опечатки',
    preview: 'Проверяю токенизатор на 4000 заголовках',
    workspace: 'rox-app',
    status: 'running',
    unread: 0,
    processing: true,
    updated: '2 мин',
    model: 'sonnet-4.5',
  },
  {
    id: 's-06',
    title: 'Нагрузка на список сессий: 4000 строк',
    preview: 'Виртуализация даёт 16 мс на кадр, цель — 8',
    workspace: 'rox-app',
    status: 'running',
    unread: 0,
    updated: '8 мин',
    model: 'gpt-5.4',
  },
  {
    id: 's-07',
    title: 'Обновить i18n-ключи инспектора',
    preview: 'Добавил 24 строки, ru и en синхронны',
    workspace: 'rox-app',
    status: 'running',
    unread: 0,
    updated: '19 мин',
    model: 'gpt-5.4',
  },
  {
    id: 's-08',
    title: 'Аудит зон попадания: 8px против 24px на тач',
    preview: 'Замеры в evidence/g06-measurements.json',
    workspace: 'design-system',
    status: 'done',
    unread: 0,
    updated: '1 ч',
    model: 'gpt-5.4',
  },
  {
    id: 's-09',
    title: 'Собрать инспектор-линзу: док и оверлей',
    preview: 'Морфинг на 1180px, бэкдроп 120 мс',
    workspace: 'rox-app',
    status: 'done',
    unread: 0,
    updated: '3 ч',
    model: 'sonnet-4.5',
  },
  {
    id: 's-10',
    title: 'Черновик миграции на panel-or-replace',
    preview: 'Сохранил пропорции, ⌘-клик открывает панель',
    workspace: 'rox-app',
    status: 'done',
    unread: 0,
    labels: ['архитектура'],
    updated: 'вчера',
    model: 'gpt-5.4',
  },
  {
    id: 's-11',
    title: 'Отчёт по AS-IS: D-04, D-07, D-11',
    preview: 'Три дефекта подтверждены замерами',
    workspace: 'design-system',
    status: 'idle',
    unread: 0,
    updated: 'вчера',
    model: 'gpt-5.4',
  },
  {
    id: 's-12',
    title: 'Разбор задержек в hot-reload playground',
    preview: 'Холодная компиляция Vite — 31 с',
    workspace: 'rox-app',
    status: 'idle',
    unread: 0,
    updated: '2 дн',
    model: 'sonnet-4.5',
  },
]

export const PROTO_LANES: ProtoLane[] = [
  {
    id: 'pinned',
    label: 'Закреплённые',
    hint: 'Всегда сверху',
    sessions: PROTO_SESSIONS.filter((session) => session.pinned),
  },
  {
    id: 'attention',
    label: 'Требуют ответа',
    hint: '3',
    sessions: PROTO_SESSIONS.filter((session) => !session.pinned && (session.status === 'waiting' || session.status === 'blocked')),
  },
  {
    id: 'running',
    label: 'В работе',
    hint: '4',
    sessions: PROTO_SESSIONS.filter((session) => !session.pinned && session.status === 'running'),
  },
  {
    id: 'read',
    label: 'Прочитано',
    sessions: PROTO_SESSIONS.filter((session) => !session.pinned && (session.status === 'done' || session.status === 'idle')),
  },
  {
    id: 'archive',
    label: 'Архив',
    empty: 'Архив пуст — завершённые сессии старше 30 дней появятся здесь',
    sessions: [],
  },
]

/** Lane-rule colour per status; `null` means "no rule" (quiet lane). */
const LANE_RULE: Record<LaneStatus, string | null> = {
  running: 'var(--status-running)',
  waiting: 'var(--status-warning)',
  blocked: 'var(--status-danger)',
  done: 'var(--status-success)',
  idle: null,
}

/* ------------------------------------------------------------------ */
/* Chrome scaffolding                                                  */
/* ------------------------------------------------------------------ */

/** Thin stand-in for the production ActivityRail (G6 does not restyle it). */
export function ProtoRail({ collapsed = true }: { collapsed?: boolean }) {
  return (
    <nav
      className="chrome-rail rox-shell-pane flex h-full shrink-0 flex-col items-center gap-1 py-2"
      data-shell-role="activity-rail"
      data-rail-state={collapsed ? 'collapsed' : 'expanded'}
      style={{ width: 'var(--chrome-rail-width)' }}
      aria-label="Активность"
    >
      {['Гл', 'Се', 'Вс', 'За', 'Зм', 'Ле', 'Вх'].map((label, index) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          className={cn(
            'grid h-8 w-8 place-items-center rounded-[var(--radius-control)] text-caption font-medium',
            index === 1 ? 'bg-accent/12 text-accent-text' : 'text-muted-foreground hover:bg-surface-hover',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
          )}
        >
          {label}
        </button>
      ))}
    </nav>
  )
}

export function ProtoPanelHeader({
  title,
  subtitle,
  count,
  status,
  focused,
  dragging,
  expanded,
  collapsed,
  onToggleCollapse,
  onToggleExpand,
  onDragStart,
  dragHandle = true,
  actions,
  leading,
  className,
  testId,
}: {
  title: string
  subtitle?: string
  count?: string
  status?: LaneStatus
  focused?: boolean
  dragging?: boolean
  expanded?: boolean
  collapsed?: boolean
  onToggleCollapse?: () => void
  onToggleExpand?: () => void
  onDragStart?: (event: React.PointerEvent<HTMLElement>) => void
  dragHandle?: boolean
  actions?: React.ReactNode
  leading?: React.ReactNode
  className?: string
  testId?: string
}) {
  const reduceMotion = usePrefersReducedMotion()
  const rule = status ? LANE_RULE[status] : null
  return (
    <div
      className={cn(
        'flex h-[var(--chrome-panel-header-height)] shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-elevated pl-2 pr-1.5',
        'relative z-chrome',
        focused && 'panel-header-focused',
        dragging && 'opacity-60',
        className,
      )}
      data-layout="panel-header"
      data-panel-header-state={dragging ? 'dragging' : focused ? 'focused' : 'idle'}
      data-testid={testId}
    >
      <span
        className="flex w-[3px] shrink-0 items-center self-stretch py-1.5"
        aria-hidden="true"
        data-lane-rule={status ?? 'none'}
      >
        <span
          className="w-[3px] flex-1 rounded-full transition-[background-color] duration-[var(--motion-fast)]"
          style={{ background: rule ?? 'transparent' }}
        />
      </span>
      {leading}
      {dragHandle ? (
        <button
          type="button"
          aria-label={`Переставить панель «${title}»`}
          onPointerDown={onDragStart}
          className="grid h-6 w-4 shrink-0 cursor-grab place-items-center rounded-[var(--radius-xs)] text-muted-foreground/70 opacity-0 transition-opacity duration-[var(--motion-fast)] hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus group-hover/panel:opacity-100 active:cursor-grabbing"
          data-testid={testId ? `${testId}-grip` : undefined}
        >
          <GripVertical className="icon-caption" />
        </button>
      ) : null}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate text-body font-semibold text-text-primary" title={title}>
          {title}
        </span>
        {count ? (
          <span className="shrink-0 rounded-[var(--radius-control)] bg-surface-hover px-1 text-caption font-medium numeric text-text-secondary">
            {count}
          </span>
        ) : null}
        {subtitle ? (
          <span className="hidden shrink-0 truncate text-caption text-text-secondary @[360px]/panel:inline">{subtitle}</span>
        ) : null}
      </span>
      {status ? (
        <span
          className="flex shrink-0 items-center gap-1 text-caption text-text-secondary"
          data-testid={testId ? `${testId}-status` : undefined}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: rule ?? 'var(--status-neutral)' }} aria-hidden="true" />
          {LANE_STATUS_LABEL[status]}
        </span>
      ) : null}
      <span className="flex shrink-0 items-center gap-0.5">
        {actions}
        {onToggleExpand ? (
          <button
            type="button"
            aria-label={expanded ? 'Развернуть на всё окно' : 'Вернуть в стек'}
            aria-pressed={!!expanded}
            onClick={onToggleExpand}
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {expanded ? <Minimize2 className="icon-caption" /> : <Maximize2 className="icon-caption" />}
          </button>
        ) : null}
        {onToggleCollapse ? (
          <button
            type="button"
            aria-label={collapsed ? 'Развернуть панель' : 'Свернуть панель'}
            aria-pressed={!!collapsed}
            onClick={onToggleCollapse}
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <ChevronsRight className={cn('icon-caption', !collapsed && 'rotate-180', !reduceMotion && 'transition-transform duration-[var(--motion-fast)]')} />
          </button>
        ) : null}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Seam (real ResizeHandle + prototype drag + drop target)             */
/* ------------------------------------------------------------------ */

export interface SeamProps {
  leftId: string
  rightId: string
  leftWidth: number
  rightWidth: number
  minLeft?: number
  minRight?: number
  dragging: boolean
  dropActive?: 'swap' | 'insert' | null
  dropLabel?: string
  onPreview: (leftWidth: number, rightWidth: number) => void
  onCommit: (leftWidth: number, rightWidth: number) => void
  onDragStateChange: (dragging: boolean) => void
  onSeamDragOver?: (side: 'left' | 'right') => void
  onSeamDrop?: (side: 'left' | 'right') => void
  onResetSeam?: () => void
  zone?: 'left' | 'right'
}

/**
 * Seam between two panels. Owns:
 *  - the real `ResizeHandle` (a11y + 8/24px hit band + gradient),
 *  - a visible grip that appears on hover/focus/drag,
 *  - a drop target used by the header-swap gesture.
 */
export function PanelSeam({
  leftId,
  rightId,
  leftWidth,
  rightWidth,
  minLeft = PANEL_MIN_WIDTH,
  minRight = PANEL_MIN_WIDTH,
  dragging,
  dropActive,
  dropLabel,
  onPreview,
  onCommit,
  onDragStateChange,
  onSeamDragOver,
  onSeamDrop,
  onResetSeam,
  zone = 'left',
}: SeamProps) {
  const reduceMotion = usePrefersReducedMotion()
  const startRef = React.useRef<{ x: number; left: number; right: number } | null>(null)
  const [hover, setHover] = React.useState(false)
  const total = leftWidth + rightWidth
  const maxLeft = Math.max(minLeft, total - minRight)

  const begin = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    startRef.current = { x: event.clientX, left: leftWidth, right: rightWidth }
    onDragStateChange(true)
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current
    if (!start) return
    const nextLeft = Math.min(maxLeft, Math.max(minLeft, start.left + (event.clientX - start.x)))
    onPreview(nextLeft, total - nextLeft)
  }

  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current
    if (!start) return
    startRef.current = null
    const nextLeft = Math.min(maxLeft, Math.max(minLeft, start.left + (event.clientX - start.x)))
    onCommit(nextLeft, total - nextLeft)
    onDragStateChange(false)
  }

  const cancel = () => {
    const start = startRef.current
    if (!start) return
    startRef.current = null
    onCommit(start.left, start.right)
    onDragStateChange(false)
  }

  return (
    <div
      className="relative z-sash flex shrink-0 justify-center"
      style={{ width: 'var(--panel-sash-hit-width)', marginLeft: 'calc(var(--panel-sash-hit-width) / -2)', marginRight: 'calc(var(--panel-sash-hit-width) / -2)' }}
      onPointerEnter={() => { setHover(true); onSeamDragOver?.(zone) }}
      onPointerLeave={() => setHover(false)}
      onPointerUp={(event) => { if (dropActive) onSeamDrop?.(zone) }}
      data-seam={leftId + '::' + rightId}
      data-seam-hover={hover ? 'true' : undefined}
      data-seam-drop={dropActive ?? undefined}
    >
      <ResizeHandle
        labelKey="shell.resize.panels"
        controlsId={`${leftId} ${rightId}`}
        valueNow={leftWidth}
        valueMin={minLeft}
        valueMax={maxLeft}
        dragging={dragging}
        data-seam-handle={leftId + '::' + rightId}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyAdjust={(delta) => {
          const nextLeft = Math.min(maxLeft, Math.max(minLeft, leftWidth + delta))
          if (nextLeft === leftWidth) return
          onPreview(nextLeft, total - nextLeft)
          onCommit(nextLeft, total - nextLeft)
        }}
        onKeyCommit={() => onCommit(leftWidth, rightWidth)}
        onKeyCancel={() => onCommit(leftWidth, rightWidth)}
        onReset={onResetSeam}
        className={cn(dropActive && 'ring-2 ring-inset ring-accent')}
        style={{ touchAction: 'none' }}
      />
      {/* Visible grip: hairline at rest, 3px + caps on hover/drag/focus. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-2 flex w-[3px] items-center justify-center rounded-full',
          !reduceMotion && 'transition-opacity duration-[var(--motion-fast)]',
          dragging || hover || dropActive ? 'opacity-100' : 'opacity-0',
        )}
        data-seam-grip={dragging || hover ? 'visible' : 'hidden'}
      >
        <span
          className={cn(
            'h-full w-full rounded-full',
            dropActive ? 'bg-accent' : dragging ? 'bg-[var(--shell-sash,color-mix(in_oklch,var(--foreground)_36%,transparent))]' : 'bg-border-strong',
          )}
        />
        <span
          className={cn(
            'absolute top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full',
            dropActive ? 'bg-accent' : 'bg-border-strong opacity-90',
          )}
        />
      </span>
      {dropActive && dropLabel ? (
        <span className="pointer-events-none absolute top-1/2 left-1/2 z-popover -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-card)] border border-border bg-popover-solid px-2 py-1 text-caption font-medium text-foreground shadow-[var(--shadow-popover)]">
          {dropLabel}
        </span>
      ) : null}
    </div>
  )
}

/** Panel shell: header + body, flush geometry, focus ring on the container. */
export function ProtoPanel({
  id,
  header,
  children,
  focused,
  collapsed,
  dragging,
  dropActive,
  expanded,
  onActivate,
  className,
  width,
  transparent,
}: {
  id: string
  header: React.ReactNode
  children: React.ReactNode
  focused?: boolean
  collapsed?: boolean
  dragging?: boolean
  dropActive?: boolean
  expanded?: boolean
  onActivate?: () => void
  className?: string
  width?: number
  transparent?: boolean
}) {
  return (
    <section
      id={id}
      data-panel-id={id}
      data-panel-role="content"
      data-panel-state={dragging ? 'dragging' : collapsed ? 'collapsed' : focused ? 'focused' : 'idle'}
      data-panel-collapsed={collapsed ? 'true' : undefined}
      data-panel-drop={dropActive ? 'swap' : undefined}
      aria-label={typeof header === 'string' ? header : undefined}
      tabIndex={-1}
      onFocusCapture={onActivate}
      onPointerDown={onActivate}
      className={cn(
        'group/panel @container/panel relative flex min-h-0 min-w-0 flex-col overflow-hidden',
        'rox-shell-pane rox-shell-divider-r outline-none',
        !transparent && 'bg-surface-canvas',
        focused && 'ring-2 ring-inset ring-focus',
        dropActive && 'ring-2 ring-inset ring-accent',
        className,
      )}
      style={{ flex: width === undefined ? '1 1 0' : undefined, width }}
    >
      {header}
      {collapsed ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 flex-col items-center justify-start gap-2 py-3 text-muted-foreground/70">
            <ChevronsRight className="icon-caption rotate-180" />
            <span className="text-caption [writing-mode:vertical-rl]">Показать</span>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      )}
      {expanded ? null : null}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Session lanes                                                       */
/* ------------------------------------------------------------------ */

export interface LaneListProps {
  lanes?: ProtoLane[]
  selectedId?: string
  focusedId?: string
  className?: string
  onSelect?: (id: string) => void
  onFocus?: (id: string) => void
  showGroupToggle?: boolean
  collapsedLanes?: string[]
  onToggleLane?: (id: string) => void
  hoverActionIndex?: number | null
  density?: 'compact' | 'comfortable'
}

export function SessionLanes({
  lanes = PROTO_LANES,
  selectedId = 's-01',
  focusedId,
  className,
  onSelect,
  onFocus,
  showGroupToggle = true,
  collapsedLanes = [],
  onToggleLane,
  density = 'compact',
}: LaneListProps) {
  const rows = React.useMemo(() => lanes.flatMap((lane) => lane.sessions.map((session) => ({ lane, session }))), [lanes])
  const currentFocus = focusedId ?? selectedId
  const rowRefs = React.useRef(new Map<string, HTMLDivElement | null>())

  const move = (from: string, delta: number) => {
    const index = rows.findIndex((row) => row.session.id === from)
    if (index < 0) return
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + delta))]
    if (!next) return
    onFocus?.(next.session.id)
    rowRefs.current.get(next.session.id)?.focus()
  }

  React.useEffect(() => {
    if (!focusedId) return
    rowRefs.current.get(focusedId)?.focus()
  }, [focusedId])

  return (
    <div
      className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-2', className)}
      role="list"
      aria-label="Сессии"
      data-testid="g06-lanes"
      data-density={density}
    >
      {lanes.map((lane) => {
        const collapsed = collapsedLanes.includes(lane.id)
        return (
          <div key={lane.id} role="group" aria-label={lane.label} data-lane={lane.id} data-lane-count={lane.sessions.length}>
            <div className="sticky top-0 z-sticky flex h-7 items-center gap-1 bg-surface-canvas px-2">
              <button
                type="button"
                onClick={() => onToggleLane?.(lane.id)}
                aria-expanded={!collapsed}
                disabled={!showGroupToggle}
                className="grid h-7 w-7 place-items-center rounded-[var(--radius-xs)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none"
              >
                {collapsed ? <ChevronRight className="icon-status" /> : <ChevronDown className="icon-status" />}
              </button>
              <span className="text-caption font-medium uppercase caps-label text-text-secondary">{lane.label}</span>
              <span className="text-caption numeric text-text-secondary">{lane.sessions.length || ''}</span>
              <span className="ml-auto flex items-center gap-1">
                {lane.sessions.some((session) => session.processing) ? (
                  <span className="text-caption text-text-secondary">идёт работа</span>
                ) : null}
              </span>
            </div>
            {collapsed ? null : lane.sessions.length === 0 ? (
              <p className="px-4 py-3 text-small text-text-secondary" data-lane-empty={lane.id}>
                {lane.empty}
              </p>
            ) : (
              lane.sessions.map((session, index) => (
                <LaneRow
                  key={session.id}
                  session={session}
                  selected={session.id === selectedId}
                  focused={session.id === currentFocus}
                  tabIndex={session.id === currentFocus ? 0 : -1}
                  onSelect={() => onSelect?.(session.id)}
                  onFocus={() => onFocus?.(session.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'j' || event.key === 'ArrowDown') { event.preventDefault(); move(session.id, 1); return }
                    if (event.key === 'k' || event.key === 'ArrowUp') { event.preventDefault(); move(session.id, -1); return }
                    if (event.key === 'Home') { event.preventDefault(); move(session.id, -rows.length); return }
                    if (event.key === 'End') { event.preventDefault(); move(session.id, rows.length); return }
                    if (event.key === 'Enter') { event.preventDefault(); onSelect?.(session.id) }
                  }}
                  registerRef={(node) => { rowRefs.current.set(session.id, node) }}
                  isFirst={index === 0}
                />
              ))
            )}
          </div>
        )
      })}
    </div>
  )
}

export function LaneRow({
  session,
  selected,
  focused,
  tabIndex,
  onSelect,
  onFocus,
  onKeyDown,
  registerRef,
  isFirst,
  forceExpanded,
}: {
  session: ProtoSession
  selected: boolean
  focused: boolean
  tabIndex: number
  onSelect: () => void
  onFocus?: () => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void
  registerRef?: (node: HTMLDivElement | null) => void
  isFirst?: boolean
  forceExpanded?: boolean
}) {
  const { t } = useTranslation()
  const reduceMotion = usePrefersReducedMotion()
  const [hover, setHover] = React.useState(false)
  const rule = LANE_RULE[session.status]
  const expanded = forceExpanded ?? (selected && session.unread > 0)
  const tall = expanded || session.unread > 1

  return (
    <div
      ref={registerRef}
      role="listitem"
      data-session-id={session.id}
      data-session-status={session.status}
      data-session-unread={session.unread || undefined}
      data-session-selected={selected ? 'true' : undefined}
      data-session-expanded={expanded ? 'true' : undefined}
      className={cn(
        'group relative flex min-h-[var(--control-lg)] items-stretch',
        !isFirst && 'border-t border-border-subtle/60',
        selected ? 'bg-[var(--state-selected)]' : hover && 'bg-[var(--state-hover)]',
      )}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      {/* lane gutter: the rule is a status mark, not decoration */}
      <span className="flex w-[14px] shrink-0 items-center justify-center" aria-hidden="true">
        <span
          className={cn(
            'w-[2px] rounded-full',
            !reduceMotion && 'transition-all duration-[var(--motion-fast)]',
            tall ? 'h-[18px]' : 'h-[8px]',
            selected && 'w-[3px]',
          )}
          style={{ background: rule ?? 'var(--border-strong)' }}
          data-lane-rule={session.status}
        />
      </span>
      <button
        type="button"
        tabIndex={tabIndex}
        onFocus={onFocus}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        aria-current={selected ? 'true' : undefined}
        data-testid={'lane-row-' + session.id}
        className={cn(
          'flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-1 pr-1.5 text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus rounded-[var(--radius-xs)]',
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {session.processing ? (
            <span className="relative grid h-3.5 w-3.5 shrink-0 place-items-center" aria-label="Идёт обработка">
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-accent/30 border-t-accent motion-reduce:animate-none" data-testid="lane-spinner" />
            </span>
          ) : session.approval ? (
            <ShieldAlert className="icon-caption text-info" aria-label="Нужно подтверждение" />
          ) : session.status === 'blocked' ? (
            <AlertTriangle className="icon-caption text-[var(--status-danger)]" aria-label="Заблокирована" />
          ) : session.status === 'waiting' ? (
            <AlertTriangle className="icon-caption text-[var(--status-warning)]" aria-label="Ждёт ответа" />
          ) : session.status === 'running' ? (
            <Play className="icon-caption text-[var(--status-running)]" aria-label="Идёт" />
          ) : session.status === 'done' ? (
            <Check className="icon-caption text-[var(--status-success)]" aria-label="Готово" />
          ) : (
            <CircleSlash className="icon-caption text-muted-foreground" aria-label="Прочитано" />
          )}
          <span className={cn('min-w-0 flex-1 truncate text-body', session.unread > 0 ? 'font-medium text-text-primary' : 'text-text-primary')} title={session.title}>
            {session.title}
          </span>
          {session.pinned ? <Pin className="icon-status text-text-secondary" aria-label="Закреплена" /> : null}
          {session.unread > 0 ? (
            <span
              className="shrink-0 rounded-full bg-accent/15 px-1.5 text-caption font-semibold numeric text-accent-text"
              data-testid={'lane-unread-' + session.id}
            >
              {session.unread}
            </span>
          ) : null}
          <span className="shrink-0 text-caption numeric text-text-secondary group-hover:invisible" data-testid={'lane-time-' + session.id}>
            {session.updated}
          </span>
        </span>
        {tall || hover || focused ? (
          <span
            className="flex min-w-0 items-center gap-1.5 truncate text-caption text-text-secondary"
            data-testid={'lane-preview-' + session.id}
          >
            <span className="truncate">{session.preview}</span>
          </span>
        ) : null}
      </button>
      {/* quick actions are siblings of the row button — never nested controls */}
      <span className="pointer-events-none absolute right-[56px] top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-[var(--radius-xs)] bg-surface-canvas px-0.5 group-hover:flex group-focus-within:flex">
        <span className="pointer-events-auto flex items-center gap-0.5">
          <button
            type="button"
            aria-label={session.pinned ? 'Открепить' : 'Закрепить'}
            aria-pressed={!!session.pinned}
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-xs)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {session.pinned ? <PinOff className="icon-caption" /> : <Pin className="icon-caption" />}
          </button>
          <button
            type="button"
            aria-label={t('sessionMenu.markAsUnread')}
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-xs)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Mail className="icon-caption" />
          </button>
          <button
            type="button"
            aria-label={t('sessionMenu.archive')}
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-xs)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Archive className="icon-caption" />
          </button>
        </span>
      </span>
      <span className="flex w-[52px] shrink-0 flex-col items-end justify-center pr-2 text-caption numeric">
        <span className="truncate text-text-secondary" title={session.workspace + ' · ' + session.model}>{session.workspace}</span>
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Lens inspector                                                      */
/* ------------------------------------------------------------------ */

export type LensSectionId = 'files' | 'git' | 'browser' | 'context'

export const LENS_SECTIONS: Array<{ id: LensSectionId; label: string; icon: React.ReactNode; count: string }> = [
  { id: 'files', label: 'Файлы', icon: <FolderOpen className="icon-caption" />, count: '12' },
  { id: 'git', label: 'Git', icon: <GitBranch className="icon-caption" />, count: '3' },
  { id: 'browser', label: 'Браузер', icon: <Globe className="icon-caption" />, count: '2' },
  { id: 'context', label: 'Контекст', icon: <Gauge className="icon-caption" />, count: '68%' },
]

export interface LensCounters {
  files: number
  git: number
  browser: number
  contextPercent: number
}

export const DEFAULT_LENS_COUNTERS: LensCounters = { files: 12, git: 3, browser: 2, contextPercent: 68 }

/* ------------------------------------------------------------------ */
/* File / git / browser / context bodies (mock, design-language parity) */
/* ------------------------------------------------------------------ */

function SectionScaffold({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2" data-testid={testId}>
      <p className="px-1 pb-1.5 text-caption text-text-secondary">{title}</p>
      {children}
    </div>
  )
}

const FILES_FIXTURE: Array<{ name: string; size: string; added?: boolean; changed?: boolean }> = [
  { name: 'apps/electron/src/renderer/components/app-shell/SessionLanes.tsx', size: '9,4 КБ', added: true },
  { name: 'apps/electron/src/renderer/components/app-shell/PanelSeam.tsx', size: '4,1 КБ', added: true },
  { name: 'apps/electron/src/renderer/platform/InspectorHost.tsx', size: '21,7 КБ', changed: true },
  { name: 'packages/ui/src/styles/tokens/chrome.css', size: '3,2 КБ', changed: true },
  { name: 'packages/shared/src/i18n/locales/ru.json', size: '64,8 КБ', changed: true },
  { name: 'docs/design/rox-screen-map-ru.md', size: '12,3 КБ' },
]

function FilesBody() {
  return (
    <SectionScaffold title="Файлы сессии · rox-app" testId="lens-files">
      <ul className="flex flex-col">
        {FILES_FIXTURE.map((file, index) => (
          <li key={file.name}>
            <button
              type="button"
              className={cn(
                'flex w-full min-w-0 items-center gap-1.5 rounded-[var(--radius-xs)] px-1 py-1 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                index === 2 && 'bg-[var(--state-selected)]',
              )}
            >
              <FileText className="icon-caption text-muted-foreground" />
              <span className="truncate text-small" title={file.name}>{file.name}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {file.added ? <span className="text-caption numeric text-[var(--status-success)]">A</span> : null}
                {file.changed ? <span className="text-caption numeric text-[var(--status-warning)]">M</span> : null}
                <span className="text-caption numeric text-text-secondary">{file.size}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </SectionScaffold>
  )
}

function GitBody() {
  const rows = [
    { path: 'SessionLanes.tsx', add: 182, del: 12 },
    { path: 'PanelSeam.tsx', add: 96, del: 0 },
    { path: 'chrome.css', add: 4, del: 2 },
  ]
  return (
    <SectionScaffold title="Ветка proto/g06-paths · 3 файла" testId="lens-git">
      <ul className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <li key={row.path} className="flex min-w-0 items-center gap-1.5 rounded-[var(--radius-xs)] px-1 py-1 hover:bg-surface-hover">
            <span className="truncate text-small" title={row.path}>{row.path}</span>
            <span className="ml-auto shrink-0 text-caption numeric">
              <span className="text-[var(--status-success)]">+{row.add}</span>{' '}
              <span className="text-[var(--status-danger)]">−{row.del}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="px-1 pt-2 text-caption text-text-secondary">Последний коммит 4 мин назад · «швы и свопы»</p>
    </SectionScaffold>
  )
}

function BrowserBody() {
  return (
    <SectionScaffold title="2 вкладки · localhost:5300" testId="lens-browser">
      <ul className="flex flex-col gap-0.5">
        {['127.0.0.1:5300/playground.html', 'docs/design/rox-screen-map-ru.md'].map((tab, index) => (
          <li key={tab} className={cn('flex min-w-0 items-center gap-1.5 rounded-[var(--radius-xs)] px-1 py-1', index === 0 && 'bg-[var(--state-selected)]')}>
            <Globe className="icon-caption text-muted-foreground" />
            <span className="truncate text-small" title={tab}>{tab}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex h-32 items-center justify-center rounded-[var(--radius-control)] border border-border-subtle bg-surface-hover text-caption text-text-secondary">
        Нативный вид браузера композитится только когда панель видима целиком
      </div>
    </SectionScaffold>
  )
}

const CONTEXT_SHARES = [
  { key: 'inspector.context.system', label: 'Системная инструкция', percent: 12 },
  { key: 'inspector.context.skills', label: 'Навыки', percent: 21 },
  { key: 'inspector.context.mcp', label: 'MCP-инструменты', percent: 14 },
  { key: 'inspector.context.transcript', label: 'Транскрипт', percent: 47 },
  { key: 'inspector.context.attachments', label: 'Вложения', percent: 6 },
]

function ContextBody() {
  return (
    <SectionScaffold title="Бюджет контекста · только чтение" testId="lens-context">
      <ul className="flex flex-col gap-2 px-1">
        {CONTEXT_SHARES.map((share) => (
          <li key={share.key} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-small">
              <span>{share.label}</span>
              <span className="numeric text-text-secondary">{share.percent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
              <div className="h-full rounded-full bg-accent/70" style={{ width: share.percent + '%' }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="px-1 pt-2 text-caption text-text-secondary">Скрыто 6 MCP-инструментов</p>
    </SectionScaffold>
  )
}

export function LensBody({ section }: { section: LensSectionId }) {
  if (section === 'files') return <FilesBody />
  if (section === 'git') return <GitBody />
  if (section === 'browser') return <BrowserBody />
  return <ContextBody />
}

export function LensSectionSwitcher({
  section,
  onSection,
  counters = DEFAULT_LENS_COUNTERS,
  orientation = 'horizontal',
}: {
  section: LensSectionId
  onSection: (id: LensSectionId) => void
  counters?: LensCounters
  orientation?: 'horizontal' | 'vertical'
}) {
  const counterValue: Record<LensSectionId, string> = {
    files: String(counters.files),
    git: String(counters.git),
    browser: String(counters.browser),
    context: counters.contextPercent + '%',
  }
  const items: TabItem[] = LENS_SECTIONS.map((entry) => ({
    id: entry.id,
    label: entry.label,
    title: entry.label,
    icon: entry.icon,
    badge: <span className="shrink-0 numeric text-caption text-text-secondary">{counterValue[entry.id]}</span>,
  }))
  return (
    <div
      className={cn('shrink-0', orientation === 'vertical' ? 'px-1 py-1.5' : 'border-b border-border-subtle px-1.5 py-1')}
      data-testid="lens-switcher"
    >
      <Tabs
        items={items}
        activeId={section}
        variant="segmented"
        density="compact"
        orientation={orientation}
        keyboard
        ariaLabel="Разделы инспектора"
        className={cn('gap-0.5', orientation === 'vertical' && 'flex-col')}
        onSelect={(id) => onSection(id as LensSectionId)}
      />
    </div>
  )
}

/** Collapsed vertical strip: contextual counters, expand on click. */
export function LensStrip({ counters = DEFAULT_LENS_COUNTERS, onExpand }: { counters?: LensCounters; onExpand?: () => void }) {
  const values: Array<{ id: LensSectionId; label: string; value: string }> = [
    { id: 'files', label: 'Файлы', value: String(counters.files) },
    { id: 'git', label: 'Git', value: String(counters.git) },
    { id: 'browser', label: 'Браузер', value: String(counters.browser) },
    { id: 'context', label: 'Контекст', value: counters.contextPercent + '%' },
  ]
  return (
    <div
      className="chrome-strip rox-shell-pane rox-shell-divider-l flex w-[32px] shrink-0 flex-col items-center gap-1.5 py-2"
      data-inspector="collapsed"
      data-testid="lens-strip"
    >
      <button
        type="button"
        aria-label="Показать инспектор"
        onClick={onExpand}
        className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <PanelRight className="icon-caption" />
      </button>
      <span className="h-px w-5 bg-border-subtle" aria-hidden="true" />
      {values.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={onExpand}
          aria-label={entry.label + ': ' + entry.value}
          className="flex min-h-[var(--control-hit-min)] w-full flex-col items-center justify-center gap-0.5 rounded-[var(--radius-xs)] py-1 text-caption numeric text-text-secondary hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          data-testid={'lens-strip-' + entry.id}
        >
          {LENS_SECTIONS.find((section) => section.id === entry.id)?.icon}
          <span>{entry.value}</span>
        </button>
      ))}
    </div>
  )
}

export interface LensInspectorProps {
  mode: 'docked' | 'overlay'
  section: LensSectionId
  onSection: (id: LensSectionId) => void
  counters?: LensCounters
  width?: number
  open?: boolean
  onClose?: () => void
  onCollapse?: () => void
  sessionTitle?: string
}

/**
 * The lens: one inspector that reads as a docked column when the centre column
 * keeps its minimum width, and morphs into a right-edge sheet when it cannot.
 */
export function LensInspector({
  mode,
  section,
  onSection,
  counters = DEFAULT_LENS_COUNTERS,
  width = 320,
  open = true,
  onClose,
  onCollapse,
  sessionTitle = 'Рефакторинг панельного стека',
}: LensInspectorProps) {
  const reduceMotion = usePrefersReducedMotion()
  const { t } = useTranslation()
  if (!open) return null
  const overlay = mode === 'overlay'
  return (
    <div
      className={cn('relative flex items-stretch', overlay ? 'absolute inset-y-0 right-0 z-sticky' : 'relative shrink-0')}
      data-inspector-panel={overlay ? 'overlay' : 'docked'}
      data-testid="g06-lens"
      data-lens-mode={mode}
    >
      {overlay ? (
        <div
          className={cn('absolute inset-0 -right-[100vw] bg-[var(--dialog-backdrop)]', !reduceMotion && 'animate-[g06FadeIn_var(--motion-fast)_var(--ease-standard)]')}
          style={{ backdropFilter: 'none' }}
          data-testid="lens-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}
      <div
        className={cn(
          'rox-shell-pane flex h-full min-h-0 flex-col overflow-hidden',
          overlay ? 'shadow-[var(--shadow-overlay)] rox-shell-divider-l' : 'rox-shell-divider-l',
          !reduceMotion && 'transition-[width] duration-[var(--motion-base)] ease-[var(--ease-standard)]',
        )}
        style={{ width }}
        role="complementary"
        aria-label={t('inspector.tab.' + section)}
      >
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border-subtle pl-2.5 pr-1.5">
          <span className="min-w-0 flex-1 truncate text-small font-medium tracking-tight text-text-primary" title={sessionTitle}>
            {sessionTitle}
          </span>
          {onCollapse ? (
            <button
              type="button"
              aria-label="Свернуть инспектор"
              onClick={onCollapse}
              className="grid h-6 w-6 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <ChevronsRight className="icon-caption" />
            </button>
          ) : null}
          {overlay && onClose ? (
            <button
              type="button"
              aria-label="Закрыть линзу"
              onClick={onClose}
              className="grid h-6 w-6 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <X className="icon-caption" />
            </button>
          ) : null}
        </div>
        <LensSectionSwitcher section={section} onSection={onSection} counters={counters} />
        <LensBody section={section} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Chat / composer stand-in (G6 leaves chat alone; shown for context)  */
/* ------------------------------------------------------------------ */

export function ChatStandIn({ title, compact }: { title: string; compact?: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="g06-chat">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="text-caption text-text-secondary">Пользователь · 14:02</span>
          <p className="text-body">
            Разложи швы панельного стека: нужен видимый захват, цели сброса и своп панелей мышью и с клавиатуры.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-caption text-text-secondary">Агент · 14:03</span>
          <p className="text-body">
            Готово. Шов получил полосу попадания 8px (24px на тач), захват появляется на наведении и фокусе. Своп — ⌥⌘S.
          </p>
          <div className="mt-1 overflow-hidden rounded-[var(--radius-control)] border border-border-subtle">
            <div className="flex items-center gap-1.5 border-b border-border-subtle bg-surface-hover px-2 py-1 text-caption text-text-secondary">
              <GitBranch className="icon-status" /> PanelSeam.tsx
            </div>
            <pre className="overflow-x-auto px-2 py-1.5 font-mono text-small text-text-primary">
{`- <div className="seam" />
+ <PanelSeam onDrop={swapPanels} />`}
            </pre>
          </div>
        </div>
        {compact ? null : (
          <div className="flex flex-col gap-1">
            <span className="text-caption text-text-secondary">Пользователь · 14:06</span>
            <p className="text-body">Проверь, что при 1000px линза уходит в оверлей, а третья панель — вкладкой.</p>
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-border-subtle p-2">
        <div className="flex items-center gap-2 rounded-[var(--radius-composer)] border border-border-subtle bg-input-surface px-2 py-1.5">
          <Plus className="icon-caption text-muted-foreground" />
          <span className="flex-1 truncate text-small text-text-secondary">Написать сообщение агенту…</span>
          <span className="shrink-0 rounded-[var(--radius-xs)] border border-border-subtle px-1 text-caption numeric text-text-secondary">⌘⏎</span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Swap gesture (panel header drag → drop target)                      */
/* ------------------------------------------------------------------ */

export interface PanelStackState {
  order: string[]
  widths: Record<string, number>
}

export function usePanelStack(initial: PanelStackState) {
  const [order, setOrder] = React.useState(initial.order)
  const [widths, setWidths] = React.useState(initial.widths)
  const swap = React.useCallback((fromId: string, toId: string) => {
    setOrder((current) => {
      const next = [...current]
      const from = next.indexOf(fromId)
      const to = next.indexOf(toId)
      if (from < 0 || to < 0 || from === to) return current
      next[from] = toId
      next[to] = fromId
      return next
    })
  }, [])
  const resize = React.useCallback((leftId: string, rightId: string, leftWidth: number, rightWidth: number) => {
    setWidths((current) => ({ ...current, [leftId]: leftWidth, [rightId]: rightWidth }))
  }, [])
  return { order, widths, swap, resize }
}

export { Search, ArrowLeftRight, GripVertical, ShieldAlert }