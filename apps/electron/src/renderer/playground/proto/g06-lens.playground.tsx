/**
 * G6 «Пути и линзы» — story: `proto-g06-lens`.
 *
 * The inspector as a contextual lens: one component that docks as a column
 * when the centre column keeps its minimum width and morphs into a right-edge
 * sheet when it cannot. Both states are prop-driven; the collapsed strip keeps
 * contextual counters.
 */

import * as React from 'react'
import { definePlaygroundStory } from '@/playground/registry/story-loader'
import {
  ChatStandIn,
  LENS_DOCK_MIN,
  LensInspector,
  LensStrip,
  PanelSeam,
  ProtoPanel,
  ProtoPanelHeader,
  SessionLanes,
  useContainerWidth,
  type LensCounters,
  type LensSectionId,
} from './g06-parts'

const LENS_COUNTERS: LensCounters = { files: 12, git: 3, browser: 2, contextPercent: 68 }

type LensModeProp = 'auto' | 'docked' | 'overlay' | 'collapsed'

const MODE_LABEL: Record<LensModeProp, string> = {
  auto: 'Авто по ширине',
  docked: 'Док — колонка',
  overlay: 'Оверлей — лист справа',
  collapsed: 'Свёрнута — полоса счётчиков',
}

function LensStory({ mode, section, stageWidth }: { mode: LensModeProp; section: LensSectionId; stageWidth: number }) {
  const [stageRef, measured] = useContainerWidth<HTMLDivElement>()
  const width = stageWidth > 0 ? stageWidth : measured
  const resolved: 'docked' | 'overlay' = mode === 'docked' ? 'docked' : mode === 'overlay' ? 'overlay' : width < LENS_DOCK_MIN ? 'overlay' : 'docked'
  const [activeSection, setActiveSection] = React.useState<LensSectionId>(section)
  const [open, setOpen] = React.useState(mode !== 'collapsed')
  const [listWidth, setListWidth] = React.useState(300)
  const [seamDragging, setSeamDragging] = React.useState(false)

  React.useEffect(() => { setActiveSection(section) }, [section])
  React.useEffect(() => { setOpen(mode !== 'collapsed') }, [mode])

  const lensWidth = 320
  const chatWidth = Math.max(320, width - listWidth - (resolved === 'docked' && open ? lensWidth : 0))

  return (
    <div
      ref={stageRef}
      className="relative mx-auto flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface-canvas"
      style={{ width: stageWidth > 0 ? stageWidth : '100%' }}
      data-testid="g06-lens-stage"
      data-lens-mode={resolved}
      data-lens-open={open ? 'true' : 'false'}
      data-stage-width={Math.round(width)}
    >
      <div className="flex min-h-0 flex-1 items-stretch">
        <ProtoPanel
          id="g06-lens-list"
          width={listWidth}
          header={<ProtoPanelHeader title="Сессии" count="12" testId="g06-lens-list-header" />}
        >
          <SessionLanes selectedId="s-01" />
        </ProtoPanel>
        <PanelSeam
          leftId="g06-lens-list"
          rightId="g06-lens-chat"
          leftWidth={listWidth}
          rightWidth={chatWidth}
          minLeft={280}
          minRight={320}
          dragging={seamDragging}
          onPreview={(left) => setListWidth(Math.min(320, Math.max(280, left)))}
          onCommit={() => undefined}
          onDragStateChange={setSeamDragging}
        />
        <ProtoPanel
          id="g06-lens-chat"
          width={chatWidth}
          header={<ProtoPanelHeader title="Рефакторинг панельного стека" status="running" testId="g06-lens-chat-header" />}
        >
          <ChatStandIn title="Чат" compact={chatWidth < 620} />
        </ProtoPanel>
        {open ? (
          <LensInspector
            mode={resolved}
            section={activeSection}
            onSection={setActiveSection}
            counters={LENS_COUNTERS}
            width={lensWidth}
            onClose={() => setOpen(false)}
            onCollapse={() => setOpen(false)}
          />
        ) : (
          <LensStrip counters={LENS_COUNTERS} onExpand={() => setOpen(true)} />
        )}
      </div>
      <div className="flex h-6 shrink-0 items-center gap-2 border-t border-border-subtle bg-surface-elevated px-2 text-caption text-text-secondary" data-testid="g06-lens-status">
        <span className="tabular-nums">Контейнер {Math.round(width)}px</span>
        <span aria-hidden="true">·</span>
        <span>порог дока {LENS_DOCK_MIN}px</span>
        <span aria-hidden="true">·</span>
        <span data-testid="g06-lens-decision">Решение: {resolved === 'docked' ? 'колонка' : 'оверлей'}</span>
        <span className="ml-auto tabular-nums">морфинг {resolved === 'docked' ? '180 мс' : '180 мс + бэкдроп 120 мс'}</span>
      </div>
    </div>
  )
}

export default definePlaygroundStory({
  id: 'proto-g06-lens',
  name: 'G6 Пути — линза инспектора',
  category: 'Unified Shell',
  level: 'Patterns',
  description:
    'G6 «Линза»: инспектор живёт в одной колонке 320px (мин 280) и морфит в лист справа, когда центральная панель уже не держит минимум. Оба состояния задаются свойством; свёрнутая полоса показывает контекстные счётчики.',
  component: LensStory,
  layout: 'full',
  previewOverflow: 'hidden',
  props: [
    {
      name: 'mode',
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
      description: 'Раздел',
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
    { name: 'stageWidth', description: 'Ограничить ширину сцены (0 — по контейнеру)', control: { type: 'number', min: 0, max: 1600, step: 20 }, defaultValue: 0 },
  ],
  variants: [
    { name: 'Док (колонка)', props: { mode: 'docked' } },
    { name: 'Оверлей (лист справа)', props: { mode: 'overlay' } },
    { name: 'Свёрнутая полоса', props: { mode: 'collapsed' } },
    { name: 'Раздел Git', props: { mode: 'docked', section: 'git' } },
    { name: 'Раздел Контекст', props: { mode: 'docked', section: 'context' } },
  ],
})