/**
 * G6 «Пути и линзы» — story: `proto-g06-workbench` (primary evidence).
 *
 * Full composition: activity rail | session lanes | chat | lens.
 * The lens docks while the centre column keeps `--panel-min-width`; below that
 * it morphs into a right-edge sheet, and the stack never squeezes a panel
 * under its minimum.
 *
 * Query params (staging, see report §8):
 *   ?lens=docked|overlay|collapsed   force the lens mode
 *   ?section=files|git|browser|context
 *   ?width=1000                      force the stage width (split evidence)
 *   ?swap=1                          freeze the drag/swap affordance
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
  LensStrip,
  LENS_DOCK_MIN,
  PanelSeam,
  ProtoPanel,
  ProtoPanelHeader,
  ProtoRail,
  SessionLanes,
  useContainerWidth,
  useProtoQuery,
  type LensCounters,
  type LensSectionId,
} from './g06-parts'

const LENS_COUNTERS: LensCounters = { files: 12, git: 3, browser: 2, contextPercent: 68 }
const LIST_MIN = 300
const LIST_MAX = 420
const RAIL_WIDTH = 48
const LENS_WIDTH = 320

type PanelId = 'list' | 'chat'

const TITLES: Record<PanelId, string> = { list: 'Сессии', chat: 'Рефакторинг панельного стека' }

function parseLensMode(value: string | null): 'auto' | 'docked' | 'overlay' | 'collapsed' {
  if (value === 'docked' || value === 'overlay' || value === 'collapsed') return value
  return 'auto'
}

function parseSection(value: string | null): LensSectionId {
  if (value === 'git' || value === 'browser' || value === 'context') return value
  return 'files'
}

function WorkbenchStory({ lens, section, width: widthProp, swap }: {
  lens: 'auto' | 'docked' | 'overlay' | 'collapsed'
  section: LensSectionId
  width: number
  swap: boolean
}) {
  const query = useProtoQuery()
  const [stageRef, measured] = useContainerWidth<HTMLDivElement>()
  const forcedWidth = Number.parseInt(query.get('width') ?? '', 10)
  const stageWidth = widthProp > 0 ? widthProp : Number.isFinite(forcedWidth) && forcedWidth > 0 ? forcedWidth : measured
  const lensProp = parseLensMode(query.get('lens') ?? lens)
  const sectionProp = parseSection(query.get('section') ?? section)
  const swapFrozen = swap || query.get('swap') === '1'

  const [listWidth, setListWidth] = React.useState(340)
  const [focused, setFocused] = React.useState<PanelId>('chat')
  const [activeSection, setActiveSection] = React.useState<LensSectionId>(sectionProp)
  const [lensOpen, setLensOpen] = React.useState(lensProp !== 'collapsed')
  const [seamDragging, setSeamDragging] = React.useState(false)
  const [dragging, setDragging] = React.useState(swapFrozen)
  const [lastAction, setLastAction] = React.useState('Стек: сессии · чат · линза')

  React.useEffect(() => { setActiveSection(sectionProp) }, [sectionProp])
  React.useEffect(() => { setLensOpen(lensProp !== 'collapsed') }, [lensProp])
  React.useEffect(() => { if (swapFrozen) setLastAction('Своп: «Рефакторинг панельного стека» → «Сессии»') }, [swapFrozen])

  const available = Math.max(320, stageWidth - RAIL_WIDTH)
  const listShown = listWidth
  const dockFeasible = available - listShown - LENS_WIDTH >= PANEL_MIN_WIDTH
  const resolvedMode: 'docked' | 'overlay' =
    lensProp === 'docked' ? 'docked'
      : lensProp === 'overlay' ? 'overlay'
        : dockFeasible ? 'docked' : 'overlay'
  const docked = lensOpen && resolvedMode === 'docked'
  const chatWidth = Math.max(320, available - listShown - (docked ? LENS_WIDTH : 0))

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey) || !event.altKey) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const next: PanelId = focused === 'list' ? 'chat' : 'list'
      setFocused(next)
      document.getElementById('g06-wb-' + next)?.focus({ preventScroll: true })
      setLastAction('Фокус: «' + TITLES[next] + '»')
      return
    }
    if (event.key.toLowerCase() === 's') {
      event.preventDefault()
      setLastAction('⌥⌘S: панели «' + TITLES[focused] + '» и «' + TITLES[focused === 'list' ? 'chat' : 'list'] + '» поменялись местами')
    }
  }

  return (
    <div
      className="flex h-full w-full items-stretch overflow-hidden bg-surface-canvas"
      data-testid="g06-workbench"
      data-lens-mode={resolvedMode}
      data-lens-open={lensOpen ? 'true' : 'false'}
      data-stage-width={Math.round(stageWidth)}
      data-dock-feasible={dockFeasible ? 'true' : 'false'}
      data-chat-width={Math.round(chatWidth)}
    >
      <ProtoRail />
      <div
        ref={stageRef}
        onKeyDown={handleKeyDown}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        style={{ width: available }}
      >
        <div className="relative flex min-h-0 flex-1 items-stretch">
          <ProtoPanel
            id="g06-wb-list"
            width={listShown}
            focused={focused === 'list'}
            onActivate={() => setFocused('list')}
            header={
              <ProtoPanelHeader
                testId="g06-wb-list-header"
                title="Сессии"
                count="12"
                focused={focused === 'list'}
                actions={
                  <button
                    type="button"
                    aria-label="Открыть рядом"
                    className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <PanelRight className="icon-caption" />
                  </button>
                }
              />
            }
          >
            <SessionLanes selectedId="s-01" onSelect={() => setFocused('chat')} />
          </ProtoPanel>

          <PanelSeam
            leftId="g06-wb-list"
            rightId="g06-wb-chat"
            leftWidth={listShown}
            rightWidth={chatWidth}
            minLeft={LIST_MIN}
            minRight={PANEL_MIN_WIDTH}
            dragging={seamDragging}
            onPreview={(left) => setListWidth(Math.min(LIST_MAX, Math.max(LIST_MIN, left)))}
            onCommit={(left, right) => setLastAction('Шов: список ' + Math.round(left) + 'px, чат ' + Math.round(right) + 'px — минимум 440px соблюдён')}
            onDragStateChange={setSeamDragging}
          />

          <ProtoPanel
            id="g06-wb-chat"
            width={chatWidth}
            focused={focused === 'chat'}
            onActivate={() => setFocused('chat')}
            header={
              <ProtoPanelHeader
                testId="g06-wb-chat-header"
                title={TITLES.chat}
                subtitle="rox-app"
                status="running"
                focused={focused === 'chat'}
                actions={
                  <button
                    type="button"
                    aria-label="Открыть рядом"
                    className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <ArrowLeftRight className="icon-caption" />
                  </button>
                }
              />
            }
          >
            <ChatStandIn title={TITLES.chat} compact={chatWidth < 620} />
          </ProtoPanel>

          {docked ? (
            <div className="rox-shell-divider-l relative flex shrink-0 flex-col" style={{ width: LENS_WIDTH }} data-inspector-panel="docked" data-testid="g06-wb-lens">
              <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border-subtle pl-2.5 pr-1.5">
                <span className="min-w-0 flex-1 truncate text-small font-medium tracking-tight">Линза · {TITLES.chat}</span>
                <button
                  type="button"
                  aria-label="Свернуть инспектор"
                  onClick={() => { setLensOpen(false); setLastAction('Линза свёрнута в полосу счётчиков') }}
                  className="grid h-6 w-6 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <PanelRight className="icon-caption" />
                </button>
              </div>
              <LensSectionSwitcher section={activeSection} onSection={setActiveSection} counters={LENS_COUNTERS} />
              <LensBody section={activeSection} />
            </div>
          ) : null}

          {lensOpen && resolvedMode === 'overlay' ? (
            <>
              <div
                // eslint-disable-next-line rox/no-foreground-opacity -- 25% neutral veil has no token (state-hover is 4-7%, surface-selected is accent-tinted)
                className="absolute inset-y-0 left-0 right-0 z-sticky bg-foreground/25 motion-safe:animate-[g06FadeIn_var(--motion-fast)_var(--ease-standard)]"
                data-testid="g06-wb-backdrop"
                onClick={() => { setLensOpen(false); setLastAction('Оверлей закрыт: линза вернулась в полосу счётчиков') }}
                aria-hidden="true"
              />
              <div
                className="rox-shell-divider-l absolute inset-y-0 right-0 z-island flex flex-col border-l border-border-strong bg-surface-elevated shadow-[var(--shadow-overlay)] motion-safe:animate-[g06SheetIn_var(--motion-base)_var(--ease-standard)]"
                style={{ width: LENS_WIDTH }}
                data-inspector-panel="overlay"
                data-testid="g06-wb-lens"
                role="complementary"
                aria-label="Линза"
              >
                <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border-subtle pl-2.5 pr-1.5">
                  <span className="min-w-0 flex-1 truncate text-small font-medium tracking-tight">Линза · оверлей</span>
                  <button
                    type="button"
                    aria-label="Закрыть линзу"
                    onClick={() => { setLensOpen(false); setLastAction('Оверлей закрыт: линза вернулась в полосу счётчиков') }}
                    className="grid h-6 w-6 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <PanelRight className="icon-caption" />
                  </button>
                </div>
                <LensSectionSwitcher section={activeSection} onSection={setActiveSection} counters={LENS_COUNTERS} />
                <LensBody section={activeSection} />
              </div>
            </>
          ) : null}

          {!lensOpen ? <LensStrip counters={LENS_COUNTERS} onExpand={() => { setLensOpen(true); setLastAction('Линза раскрыта') }} /> : null}

          {dragging ? (
            <>
              <div className="pointer-events-none absolute inset-0 z-popover grid place-items-center bg-surface-hover" data-testid="g06-wb-drop-indicator">
                <span className="flex items-center gap-1.5 rounded-[var(--radius-card)] border border-accent bg-popover-solid px-2.5 py-1.5 text-small font-medium text-foreground shadow-[var(--shadow-popover)]">
                  <ArrowLeftRight className="icon-caption text-accent" />
                  Поменять местами с «{TITLES.chat}»
                </span>
              </div>
              <span
                className="pointer-events-none absolute top-24 left-[26%] z-island rounded-[var(--radius-card)] border border-border-strong bg-popover-solid px-2 py-1 text-small font-medium text-foreground shadow-[var(--shadow-overlay)]"
                data-testid="g06-wb-drag-ghost"
              >
                {TITLES.chat} · тянем
              </span>
            </>
          ) : null}
        </div>

        <div
          className="flex h-6 shrink-0 items-center gap-2 border-t border-border-subtle bg-surface-elevated px-2 text-caption text-text-secondary"
          data-testid="g06-wb-status"
        >
          <span className="numeric">Сцена {Math.round(stageWidth)}px · чат {Math.round(chatWidth)}px</span>
          <span aria-hidden="true">·</span>
          <span>порог дока {LENS_DOCK_MIN}px → {resolvedMode === 'docked' ? 'колонка' : 'лист'}</span>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate">{lastAction}</span>
          <span className="ml-auto hidden shrink-0 items-center gap-3 numeric lg:flex">
            <span>panel-or-replace: центр заменяется, пропорции сохраняются</span>
            <span>⌘-клик → панель</span>
            <span>⌥⌘S — своп</span>
          </span>
        </div>
      </div>
    </div>
  )
}

export default definePlaygroundStory({
  id: 'proto-g06-workbench',
  name: 'G6 Пути — рабочий стол',
  category: 'Unified Shell',
  level: 'Screens',
  description:
    'G6 целиком: полоса активности · полосы сессий · чат · линза. 1440×960 — линза в доке; 1000×960 — линза уходит в лист справа, панели не сжимаются ниже минимума. Параметры ?lens= ?section= ?width= ?swap=1 задают состояние для съёмки.',
  component: WorkbenchStory,
  layout: 'full',
  previewOverflow: 'hidden',
  props: [
    {
      name: 'lens',
      description: 'Режим линзы',
      control: {
        type: 'select',
        options: [
          { label: 'Авто', value: 'auto' },
          { label: 'Док', value: 'docked' },
          { label: 'Оверлей', value: 'overlay' },
          { label: 'Свёрнута', value: 'collapsed' },
        ],
      },
      defaultValue: 'auto',
    },
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
    { name: 'width', description: 'Ширина сцены (0 — по контейнеру)', control: { type: 'number', min: 0, max: 1600, step: 20 }, defaultValue: 0 },
    { name: 'swap', description: 'Заморозить состояние свопа', control: { type: 'boolean' }, defaultValue: false },
  ],
  variants: [
    { name: '1440 · линза в доке', props: {} },
    { name: '1000 · линза оверлеем', props: { width: 1000 } },
    { name: 'Линза свёрнута', props: { lens: 'collapsed' } },
    { name: 'Своп (заморожен)', props: { swap: true } },
    { name: 'Раздел Git', props: { section: 'git' } },
  ],
})