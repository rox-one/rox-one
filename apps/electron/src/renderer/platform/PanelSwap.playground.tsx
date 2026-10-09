/**
 * G6 «Пути» wave 2 — story: `platform-panel-swap`.
 *
 * The panel stack's swap affordance, on the real primitives: the isolated
 * store holds the production `panelStackAtom` and `featurePanelSwapV1Atom`,
 * the seams are the shipped `PanelResizeSash` (so a drag still resizes), and
 * the reorder goes through the exported `swapPanelOrder` / `resolveSwapNeighborId`
 * that `PanelStackContainer` itself uses — never a story-local copy.
 *
 * `enabled` reflects the flag: OFF keeps the seams resize-only and the stage
 * never intercepts ⌥⌘S; ON adds the grip, the drag ghost, the drop target and
 * the keyboard chord. `frozenDrag` pins the ghost + target so the affordance
 * can be captured deterministically.
 */
import * as React from 'react'
import { Provider as JotaiProvider, createStore, useAtomValue, useSetAtom } from 'jotai'
import { ArrowLeftRight } from 'lucide-react'
import { definePlaygroundStory } from '@/playground/registry/story-loader'
import { featurePanelSwapV1Atom } from '@/atoms/unified-shell'
import { focusedPanelIdAtom, panelStackAtom, type PanelStackEntry } from '@/atoms/panel-stack'
import { PanelResizeSash } from '@/components/app-shell/PanelResizeSash'
import { resolveSwapNeighborId, swapPanelOrder } from '@/components/app-shell/PanelStackContainer'
import { PANEL_MIN_WIDTH } from '@/components/app-shell/panel-constants'
import { KEYS, getKeyString } from '@/lib/local-storage'

const DEMO_PANELS: PanelStackEntry[] = [
  { id: 'swap-panel-list', route: 'allSessions/session/demo-1', proportion: 0.28, panelType: 'session', laneId: 'main' },
  { id: 'swap-panel-chat', route: 'allSessions/session/demo-2', proportion: 0.44, panelType: 'session', laneId: 'main' },
  { id: 'swap-panel-lens', route: 'allSessions/session/demo-3', proportion: 0.28, panelType: 'session', laneId: 'main' },
]

const PANEL_TITLES: Record<string, string> = {
  'swap-panel-list': 'Сессии',
  'swap-panel-chat': 'Рефакторинг панельного стека',
  'swap-panel-lens': 'Инспектор',
}

const SWAP_GRIP_LABEL = 'Поменять панели местами'
const SWAP_BLOCKED_LABEL = 'Обмен недоступен: у панели нет соседа'
const SWAP_WITH_LABEL = 'Поменять местами с «{{title}}»'

interface DragState {
  sourceId: string
  targetId: string | null
  pointer: { x: number; y: number }
  targetRect: { left: number; top: number; width: number; height: number } | null
}

function titleOf(id: string | null | undefined): string {
  if (!id) return ''
  return PANEL_TITLES[id] ?? id
}

function Stage({ enabled, frozenDrag }: { enabled: boolean; frozenDrag: boolean }) {
  const panels = useAtomValue(panelStackAtom)
  const setPanels = useSetAtom(panelStackAtom)
  const focusedId = useAtomValue(focusedPanelIdAtom)
  const setFocusedId = useSetAtom(focusedPanelIdAtom)
  const stageRef = React.useRef<HTMLDivElement>(null)
  const sourceRef = React.useRef<string | null>(null)
  const startRef = React.useRef<{ x: number; y: number } | null>(null)
  const [drag, setDrag] = React.useState<DragState | null>(null)
  const [lastAction, setLastAction] = React.useState('Фокус на «' + titleOf('swap-panel-chat') + '»')

  const dragging = drag !== null

  const order = panels.map((panel) => panel.id)

  const swap = React.useCallback((firstId: string, secondId: string) => {
    setPanels((current) => swapPanelOrder(current, firstId, secondId))
    setLastAction('Панели «' + titleOf(firstId) + '» и «' + titleOf(secondId) + '» поменялись местами')
  }, [setPanels])

  // Deterministic affordance for screenshots: a frozen drag from "chat" to "list".
  React.useEffect(() => {
    if (!enabled || !frozenDrag) return
    const stage = stageRef.current
    setDrag({
      sourceId: 'swap-panel-chat',
      targetId: 'swap-panel-list',
      pointer: { x: (stage?.clientWidth ?? 400) * 0.5, y: 120 },
      targetRect: null,
    })
    setLastAction('Перетаскивание «' + titleOf('swap-panel-chat') + '» → «' + titleOf('swap-panel-list') + '»')
  }, [enabled, frozenDrag])

  const resolveTarget = React.useCallback((x: number, y: number) => {
    const element = document.elementFromPoint(x, y)
    const cell = element?.closest<HTMLElement>('[data-panel-role="content"][data-panel-id]')
    const id = cell?.dataset.panelId ?? null
    if (!id || id === sourceRef.current) return null
    const rect = cell!.getBoundingClientRect()
    const base = stageRef.current?.getBoundingClientRect() ?? null
    return {
      id,
      rect: base
        ? { left: rect.left - base.left, top: rect.top - base.top, width: rect.width, height: rect.height }
        : null,
    }
  }, [])

  const beginDrag = React.useCallback((sourceId: string, event: React.PointerEvent<HTMLButtonElement>) => {
    sourceRef.current = sourceId
    startRef.current = { x: event.clientX, y: event.clientY }
    setDrag({ sourceId, targetId: null, pointer: { x: event.clientX, y: event.clientY }, targetRect: null })
    setLastAction('Тянем «' + titleOf(sourceId) + '» — отпустите над другой панелью')
  }, [])

  React.useEffect(() => {
    if (!dragging || frozenDrag) return
    const move = (event: PointerEvent) => {
      const resolved = resolveTarget(event.clientX, event.clientY)
      setDrag((current) => (current
        ? { ...current, targetId: resolved?.id ?? null, targetRect: resolved?.rect ?? null, pointer: { x: event.clientX, y: event.clientY } }
        : current))
    }
    const up = (event: PointerEvent) => {
      const sourceId = sourceRef.current
      const start = startRef.current
      const resolved = resolveTarget(event.clientX, event.clientY)
      const moved = !!start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 4
      sourceRef.current = null
      startRef.current = null
      setDrag(null)
      if (sourceId && resolved && moved) swap(sourceId, resolved.id)
      else if (sourceId && moved) setLastAction('Отменено: панель вернулась на место')
    }
    const cancel = () => { sourceRef.current = null; startRef.current = null; setDrag(null) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [dragging, frozenDrag, resolveTarget, swap])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!enabled) return
    if (!(event.metaKey || event.ctrlKey) || !event.altKey) return
    if (event.key.toLowerCase() !== 's') return
    event.preventDefault()
    const neighborId = resolveSwapNeighborId(panels, focusedId)
    if (!focusedId || !neighborId) {
      setLastAction('Обмен невозможен: у панели нет соседа')
      return
    }
    swap(focusedId, neighborId)
  }

  const ghostBase = stageRef.current?.getBoundingClientRect() ?? null
  const dragPointer = drag && ghostBase
    ? { left: drag.pointer.x - ghostBase.left + 14, top: drag.pointer.y - ghostBase.top + 14 }
    : null

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface-canvas text-text-primary">
      <div
        ref={stageRef}
        onKeyDown={handleKeyDown}
        className="relative flex min-h-0 flex-1 items-stretch overflow-hidden"
        data-testid="panel-swap-stage"
        data-panel-swap-flag={enabled ? 'on' : 'off'}
        data-panel-swap-order={order.join('>')}
        data-panel-swap-focused={focusedId ?? 'none'}
        data-panel-swap-dragging={drag ? drag.sourceId : undefined}
      >
        {panels.map((entry, index) => (
          <React.Fragment key={entry.id}>
            {index > 0 ? (
              <PanelResizeSash
                leftIndex={index - 1}
                rightIndex={index}
                swap={enabled ? {
                  enabled: true,
                  focusedPanelId: focusedId,
                  gripLabel: SWAP_GRIP_LABEL,
                  blockedLabel: SWAP_BLOCKED_LABEL,
                  onDragStart: (panelId, event) => beginDrag(panelId, event),
                  onActivate: (panelId) => {
                    const neighborId = resolveSwapNeighborId(panels, panelId)
                    if (neighborId) swap(panelId, neighborId)
                  },
                } : undefined}
              />
            ) : null}
            <section
              data-panel-role="content"
              data-panel-id={entry.id}
              tabIndex={-1}
              onPointerDown={() => { setFocusedId(entry.id) }}
              onFocusCapture={() => { setFocusedId(entry.id) }}
              className={[
                'relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-card)] border bg-surface-elevated',
                entry.id === focusedId ? 'border-accent shadow-[var(--shadow-popover)]' : 'border-border-subtle',
                drag?.sourceId === entry.id ? 'opacity-60' : '',
                drag?.targetId === entry.id ? 'border-2 border-accent bg-accent/5' : '',
              ].join(' ')}
              style={{ flexGrow: entry.tool ? 0 : entry.proportion, flexShrink: 1, flexBasis: 0, minWidth: PANEL_MIN_WIDTH }}
            >
              <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border-subtle px-3 text-small font-medium">
                <span className="truncate">{titleOf(entry.id)}</span>
                <span className="ml-auto tabular-nums text-caption text-text-secondary">
                  {Math.round(entry.proportion * 100)}%
                </span>
              </header>
              <div className="min-h-0 flex-1 bg-surface-canvas p-3 text-caption text-text-secondary">
                Панель «{titleOf(entry.id)}» — позиция {index + 1} из {panels.length}.
              </div>
              {drag && drag.targetId === entry.id && drag.targetRect === null ? (
                <span className="pointer-events-none absolute inset-x-2 top-2 flex items-center justify-center rounded-[var(--radius-card)] border border-accent bg-surface-elevated px-2.5 py-1 text-small font-medium text-text-primary shadow-[var(--shadow-popover)]">
                  <ArrowLeftRight className="icon-caption mr-1.5 text-accent" />
                  {SWAP_WITH_LABEL.replace('{{title}}', titleOf(drag.sourceId))}
                </span>
              ) : null}
            </section>
          </React.Fragment>
        ))}

        {drag?.targetRect ? (
          <div
            data-testid="panel-swap-target"
            data-panel-swap-target={drag.targetId ?? 'none'}
            className="pointer-events-none absolute z-popover rounded-[var(--radius-card)] border-2 border-accent bg-accent/5"
            style={{ left: drag.targetRect.left, top: drag.targetRect.top, width: drag.targetRect.width, height: drag.targetRect.height }}
          >
            <span className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-card)] border border-accent bg-surface-elevated px-2.5 py-1 text-small font-medium text-text-primary shadow-[var(--shadow-popover)]">
              <ArrowLeftRight className="icon-caption text-accent" />
              {SWAP_WITH_LABEL.replace('{{title}}', titleOf(drag.sourceId))}
            </span>
          </div>
        ) : null}

        {drag && dragPointer ? (
          <div
            data-testid="panel-swap-ghost"
            data-panel-swap-ghost-target={drag.targetId ?? 'none'}
            className="pointer-events-none absolute z-island flex items-center gap-1.5 rounded-[var(--radius-card)] border border-border-subtle bg-surface-elevated px-2 py-1 text-small font-medium text-text-primary shadow-[var(--shadow-overlay)]"
            style={dragPointer}
          >
            <ArrowLeftRight className="icon-caption text-accent" />
            {titleOf(drag.sourceId)} · тянем
          </div>
        ) : null}
      </div>

      <div className="flex h-6 shrink-0 items-center gap-2 border-t border-border-subtle bg-surface-elevated px-2 text-caption text-text-secondary">
        <span className="tabular-nums" data-testid="panel-swap-order">Стек: {order.join(' · ')}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">фокус: {titleOf(focusedId)}</span>
        <span aria-hidden="true">·</span>
        <span className="min-w-0 truncate" data-testid="panel-swap-status">{lastAction}</span>
        <span className="ml-auto shrink-0 tabular-nums">{`flag ${enabled ? 'ON' : 'OFF'}`}</span>
        <span className="hidden shrink-0 tabular-nums sm:inline">⌥⌘S — своп</span>
      </div>
    </div>
  )
}

interface HydrateSwapProps {
  enabled: boolean
  children: React.ReactNode
}

/** Hydrates flag + a three-panel stack in the isolated store, like the shell story. */
function HydrateSwap({ enabled, children }: HydrateSwapProps) {
  const setFlag = useSetAtom(featurePanelSwapV1Atom)
  const setPanels = useSetAtom(panelStackAtom)
  const setFocused = useSetAtom(focusedPanelIdAtom)

  // The flag atom persists to the shared origin's localStorage: snapshot the
  // shipped value before this story writes it and restore it on unmount, so a
  // QA run never leaves featurePanelSwapV1 ON for the real app. Declared first
  // so it captures the value before the effect below writes.
  React.useEffect(() => {
    const key = getKeyString(KEYS.featurePanelSwapV1)
    const previous = localStorage.getItem(key)
    return () => {
      if (previous === null) localStorage.removeItem(key)
      else localStorage.setItem(key, previous)
    }
  }, [])

  React.useEffect(() => {
    // Honour the `enabled` prop at any persisted value — the story owns the
    // flag for its lifetime and restores the snapshot on unmount.
    setFlag(enabled)
    setPanels(DEMO_PANELS)
    setFocused('swap-panel-chat')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const previous = React.useRef(enabled)
  React.useEffect(() => {
    if (previous.current !== enabled) setFlag(enabled)
    previous.current = enabled
  }, [enabled, setFlag])

  return <>{children}</>
}

export interface PanelSwapDemoProps {
  enabled: boolean
  frozenDrag: boolean
}

function PanelSwapDemo({ enabled, frozenDrag }: PanelSwapDemoProps) {
  // A fresh store per mount keeps the demo deterministic; the flag and the
  // panel order both live in the same atoms the real shell persists.
  const store = React.useMemo(() => createStore(), [])
  return (
    <JotaiProvider store={store}>
      <HydrateSwap enabled={enabled}>
        <Stage enabled={enabled} frozenDrag={frozenDrag} />
      </HydrateSwap>
    </JotaiProvider>
  )
}

export default definePlaygroundStory({
  id: 'platform-panel-swap',
  name: 'G6 Панели — обмен местами',
  category: 'Unified Shell',
  level: 'Patterns',
  description:
    'G6 wave 2 (featurePanelSwapV1, по умолчанию OFF): обмен панелей местами на реальных сёмах PanelResizeSash и реальном panelStackAtom. ON добавляет ручку-гайку, призрак перетаскивания, цель сброса с подписью «Поменять местами с …» и клавишу ⌥⌘S; OFF оставляет только resize и не перехватывает клавишу.',
  component: PanelSwapDemo,
  layout: 'full',
  previewOverflow: 'hidden',
  props: [
    { name: 'enabled', description: 'featurePanelSwapV1Atom (пилотный флаг)', control: { type: 'boolean' }, defaultValue: true },
    { name: 'frozenDrag', description: 'Зафиксировать состояние перетаскивания (призрак + цель)', control: { type: 'boolean' }, defaultValue: false },
  ],
  variants: [
    { name: 'Флаг ON', props: { enabled: true } },
    { name: 'Флаг OFF (легаси-сёмы)', props: { enabled: false } },
    { name: 'Перетаскивание (заморожено)', props: { enabled: true, frozenDrag: true } },
  ],
})