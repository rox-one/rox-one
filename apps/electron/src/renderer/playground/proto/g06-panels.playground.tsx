/**
 * G6 «Пути и линзы» — story: `proto-g06-panels`.
 *
 * The panel stack: visible seams with grips, panel headers carrying session
 * identity + status, drag-to-swap with a ghost and a drop target, collapse /
 * expand, focus ring and the keyboard map (⌥⌘←/→ focus, ⌥⌘S swap).
 *
 * `?drag=1` freezes the drag affordance (ghost + drop target) so the state can
 * be captured deterministically instead of relying on a live pointer.
 */

import * as React from 'react'
import { ArrowLeftRight, PanelRight } from 'lucide-react'
import { definePlaygroundStory } from '@/playground/registry/story-loader'
import { INSPECTOR_MIN_WIDTH } from '@/platform/inspector-model'
import { PANEL_MIN_WIDTH } from '@/components/app-shell/panel-constants'
import {
  ChatStandIn,
  LensBody,
  LensSectionSwitcher,
  PanelSeam,
  ProtoPanel,
  ProtoPanelHeader,
  SessionLanes,
  useContainerWidth,
  useProtoQuery,
  type LensCounters,
  type LensSectionId,
} from './g06-parts'

const LIST_MIN = 280
const LIST_MAX = 420
const LENS_MAX = 520
const COLLAPSED_WIDTH = 44

type PanelId = 'list' | 'chat' | 'lens'

const TITLES: Record<PanelId, string> = { list: 'Сессии', chat: 'Рефакторинг панельного стека', lens: 'Линза' }

interface DragState {
  fromId: PanelId
  pointer: { x: number; y: number } | null
  targetId: PanelId | null
}

const LENS_COUNTERS: LensCounters = { files: 12, git: 3, browser: 2, contextPercent: 68 }

function PanelsStory({ frozen, section }: { frozen: boolean; section: LensSectionId }) {
  const query = useProtoQuery()
  const [stageRef, stageWidth] = useContainerWidth<HTMLDivElement>()
  const [order, setOrder] = React.useState<PanelId[]>(['list', 'chat', 'lens'])
  const [listWidth, setListWidth] = React.useState(340)
  const [lensWidth, setLensWidth] = React.useState(320)
  const [focused, setFocused] = React.useState<PanelId>('chat')
  const [collapsed, setCollapsed] = React.useState<PanelId[]>([])
  const [expanded, setExpanded] = React.useState<PanelId | null>(null)
  const [seamDragging, setSeamDragging] = React.useState(false)
  const [drag, setDrag] = React.useState<DragState | null>(null)
  const [lastAction, setLastAction] = React.useState('Стек из трёх панелей; швы активны')
  const [activeSection, setActiveSection] = React.useState<LensSectionId>(section)

  // Deterministic affordance state for screenshots.
  React.useEffect(() => {
    if (!frozen && query.get('drag') !== '1') return
    setDrag({ fromId: 'chat', pointer: null, targetId: 'list' })
    setLastAction('Перетаскивание «' + TITLES.chat + '» → «' + TITLES.list + '»')
  }, [frozen, query])

  const swap = React.useCallback((fromId: PanelId, toId: PanelId) => {
    setOrder((current) => {
      const from = current.indexOf(fromId)
      const to = current.indexOf(toId)
      if (from < 0 || to < 0 || from === to) return current
      const next = [...current]
      next[from] = toId
      next[to] = fromId
      return next
    })
    setLastAction('Панели «' + TITLES[fromId] + '» и «' + TITLES[toId] + '» поменялись местами')
  }, [])

  const listShown = collapsed.includes('list') ? COLLAPSED_WIDTH : listWidth
  const lensShown = collapsed.includes('lens') ? COLLAPSED_WIDTH : lensWidth
  const chatWidth = Math.max(PANEL_MIN_WIDTH, stageWidth - listShown - lensShown)

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey) || !event.altKey) return
    const index = order.indexOf(focused)
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const delta = event.key === 'ArrowLeft' ? -1 : 1
      const next = order[(index + delta + order.length) % order.length]
      event.preventDefault()
      setFocused(next)
      document.getElementById('g06-panel-' + next)?.focus({ preventScroll: true })
      setLastAction('Фокус: «' + TITLES[next] + '»')
      return
    }
    if (event.key.toLowerCase() === 's') {
      event.preventDefault()
      const next = order[(index + 1) % order.length]
      if (collapsed.includes(next)) {
        setLastAction('«' + TITLES[next] + '» свёрнута — сначала разверните панель')
        return
      }
      swap(focused, next)
    }
  }

  const beginDrag = (fromId: PanelId) => (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    setDrag({ fromId, pointer: { x: event.clientX, y: event.clientY }, targetId: null })
    setLastAction('Тянем «' + TITLES[fromId] + '» — отпустите над другой панелью')
  }

  const stagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const panel = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-panel-id]')
    const id = panel?.dataset.panelId as PanelId | undefined
    const targetId = id && id !== drag.fromId && !collapsed.includes(id) ? id : null
    setDrag({ ...drag, pointer: { x: event.clientX, y: event.clientY }, targetId })
  }

  const endDrag = () => {
    if (!drag) return
    if (drag.targetId) swap(drag.fromId, drag.targetId)
    else setLastAction('Отменено: панель вернулась на место')
    setDrag(null)
  }

  const toggleCollapse = (id: PanelId) => {
    setCollapsed((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]))
  }

  const renderPanel = (id: PanelId) => {
    const isCollapsed = collapsed.includes(id)
    const width = expanded === id ? undefined : isCollapsed ? COLLAPSED_WIDTH : id === 'chat' ? chatWidth : id === 'list' ? listWidth : lensWidth
    return (
      <ProtoPanel
        key={id}
        id={'g06-panel-' + id}
        focused={focused === id}
        collapsed={isCollapsed}
        dragging={drag?.fromId === id}
        dropActive={drag?.targetId === id}
        expanded={expanded === id}
        onActivate={() => setFocused(id)}
        width={width}
        className={width === undefined ? 'min-w-0 flex-1' : undefined}
        header={
          <ProtoPanelHeader
            testId={'g06-panel-header-' + id}
            title={TITLES[id]}
            count={id === 'list' ? '12' : undefined}
            status={id === 'chat' ? 'running' : undefined}
            focused={focused === id}
            dragging={drag?.fromId === id}
            expanded={expanded === id}
            collapsed={isCollapsed}
            onToggleCollapse={() => toggleCollapse(id)}
            onToggleExpand={id === 'list' ? undefined : () => setExpanded((current) => (current === id ? null : id))}
            onDragStart={beginDrag(id)}
            actions={
              id === 'lens' ? null : (
                <button
                  type="button"
                  aria-label="Открыть рядом"
                  className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <PanelRight className="icon-caption" />
                </button>
              )
            }
          />
        }
      >
        {id === 'list' ? (
          <SessionLanes selectedId="s-01" onSelect={() => setFocused('chat')} />
        ) : id === 'chat' ? (
          <ChatStandIn title={TITLES.chat} compact={chatWidth < 620} />
        ) : (
          <>
            <LensSectionSwitcher section={activeSection} onSection={setActiveSection} counters={LENS_COUNTERS} />
            <LensBody section={activeSection} />
          </>
        )}
        {drag?.targetId === id ? (
          <div className="pointer-events-none absolute inset-0 z-popover grid place-items-center bg-surface-hover" data-testid="g06-drop-indicator">
            <span className="flex items-center gap-1.5 rounded-[var(--radius-card)] border border-accent bg-popover-solid px-2.5 py-1.5 text-small font-medium text-text-primary shadow-[var(--shadow-popover)]">
              <ArrowLeftRight className="icon-caption text-accent" />
              Поменять местами с «{TITLES[drag.fromId]}»
            </span>
          </div>
        ) : null}
      </ProtoPanel>
    )
  }

  return (
    <div
      ref={stageRef}
      onKeyDown={handleKeyDown}
      onPointerMove={stagePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="relative flex h-full w-full flex-col overflow-hidden bg-surface-canvas"
      data-testid="g06-panels-stage"
      data-panel-count={order.length}
      data-panel-order={order.join('>')}
      data-chat-width={Math.round(chatWidth)}
    >
      <div className="flex min-h-0 flex-1 items-stretch">
        {order.map((id, index) => {
          const nextId = order[index + 1]
          return (
            <React.Fragment key={id}>
              {renderPanel(id)}
              {nextId ? (
                <PanelSeam
                  leftId={id}
                  rightId={nextId}
                  zone={nextId === 'list' ? 'right' : 'left'}
                  leftWidth={id === 'list' ? listShown : chatWidth}
                  rightWidth={nextId === 'chat' ? chatWidth : lensShown}
                  minLeft={id === 'chat' ? PANEL_MIN_WIDTH : LIST_MIN}
                  minRight={nextId === 'lens' ? INSPECTOR_MIN_WIDTH : PANEL_MIN_WIDTH}
                  dragging={seamDragging}
                  dropActive={drag?.targetId === nextId || drag?.targetId === id ? 'swap' : null}
                  dropLabel="Поменять местами"
                  onPreview={(left, right) => {
                    if (id === 'list') {
                      const max = Math.min(LIST_MAX, Math.max(LIST_MIN, stageWidth - lensShown - PANEL_MIN_WIDTH))
                      setListWidth(Math.min(max, Math.max(LIST_MIN, left)))
                    } else if (nextId === 'lens') {
                      const max = Math.min(LENS_MAX, Math.max(INSPECTOR_MIN_WIDTH, stageWidth - listShown - PANEL_MIN_WIDTH))
                      setLensWidth(Math.min(max, Math.max(INSPECTOR_MIN_WIDTH, right)))
                    }
                  }}
                  onCommit={(left) => setLastAction('Шов отпущен на ' + Math.round(left) + 'px — минимумы панелей соблюдены')}
                  onDragStateChange={setSeamDragging}
                  onResetSeam={() => setLastAction('Двойной клик по шву: пропорции сброшены')}
                />
              ) : null}
            </React.Fragment>
          )
        })}
        {drag ? (
          <span
            className="pointer-events-none absolute z-island rounded-[var(--radius-card)] border border-border-strong bg-popover-solid px-2 py-1 text-small font-medium text-text-primary shadow-[var(--shadow-overlay)]"
            style={
              drag.pointer
                ? { left: drag.pointer.x - stageRef.current!.getBoundingClientRect().left + 12, top: drag.pointer.y - stageRef.current!.getBoundingClientRect().top + 12 }
                : { left: '16%', top: 96 }
            }
            data-testid="g06-drag-ghost"
            data-ghost-target={drag.targetId ?? 'none'}
          >
            {TITLES[drag.fromId]} · тянем
          </span>
        ) : null}
      </div>
      <div
        className="flex h-6 shrink-0 items-center gap-2 border-t border-border-subtle bg-surface-elevated px-2 text-caption text-text-secondary"
        data-testid="g06-panel-status"
      >
        <span className="tabular-nums">Стек {Math.round(stageWidth)}px · чат {Math.round(chatWidth)}px</span>
        <span aria-hidden="true">·</span>
        <span className="min-w-0 truncate">{lastAction}</span>
        <span className="ml-auto hidden shrink-0 items-center gap-2 tabular-nums sm:flex">
          <span>⌥⌘←/→ — фокус</span>
          <span>⌥⌘S — своп</span>
        </span>
      </div>
    </div>
  )
}

export default definePlaygroundStory({
  id: 'proto-g06-panels',
  name: 'G6 Пути — стек панелей',
  category: 'Unified Shell',
  level: 'Patterns',
  description:
    'G6: стек из трёх панелей (сессии | чат | линза) с видимыми швами и захватом, своп панелей перетаскиванием (призрак + цель сброса), свёртывание и разворот, фокусное кольцо и клавиатурная карта ⌥⌘←/→ + ⌥⌘S. Параметр ?drag=1 фиксирует состояние перетаскивания.',
  component: PanelsStory,
  layout: 'full',
  previewOverflow: 'hidden',
  props: [
    { name: 'frozen', description: 'Заморозить состояние перетаскивания', control: { type: 'boolean' }, defaultValue: false },
    {
      name: 'section',
      description: 'Раздел линзы',
      control: {
        type: 'select',
        options: [
          { label: 'Файлы', value: 'files' },
          { label: 'Git', value: 'git' },
          { label: 'Браузер', value: 'browser' },
          { label: 'Контекст', value: 'context' },
        ],
      },
      defaultValue: 'files',
    },
  ],
  variants: [
    { name: 'Стек (по умолчанию)', props: {} },
    { name: 'Перетаскивание', props: { frozen: true } },
    { name: 'Раздел Git', props: { section: 'git' } },
  ],
})