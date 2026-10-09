/**
 * «Студия» layout engine — story: `screen-layout-engine`.
 *
 * Fixture for `featureLayoutEngineAtom` (default OFF): the isolated jotai store
 * is hydrated with the flag ON and a preset, then the pure `computeLayout()`
 * drives a mock flat panel stack exactly as `PanelStackContainer` consumes it —
 * one/two/three peer columns and the «Стена» grid tiles, with the width readout
 * and the reflow the engine chooses before squeezing a column below its token
 * minimum. No transitions: the geometry lands on the same values every time.
 */
import * as React from 'react'
import { Provider as JotaiProvider, createStore, useAtomValue, useSetAtom } from 'jotai'
import { definePlaygroundStory } from '@/playground/registry/story-loader'
import { featureLayoutEngineAtom } from '@/atoms/unified-shell'
import { createPanelWorkspaceLayoutAtom, withPanelWorkspacePreset } from '@/atoms/panel-workspace'
import { computeLayout } from '@/lib/layout-engine'
import {
  panelGridKey,
  panelGridShape,
  resolvePanelGridTracks,
  type PanelLayoutPreset,
} from '@/lib/panel-workspace-layout'
import { PANEL_GAP, PANEL_GRID_MIN_HEIGHT, PANEL_GRID_MIN_WIDTH } from '@/components/app-shell/panel-constants'
import { KEYS, getKeyString } from '@/lib/local-storage'

const DEMO_WORKSPACE_ID = 'playground-layout-engine'
const DEMO_PANEL_LABELS = ['Сессии', 'Чат', 'Инспектор', 'Заметки', 'Задачи'] as const

/** One shared atom so the hydration and the stage read the same demo record. */
const demoLayoutAtom = createPanelWorkspaceLayoutAtom(DEMO_WORKSPACE_ID)

function useMeasuredWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null)
  const [width, setWidth] = React.useState(0)
  React.useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

interface HydrateEngineProps {
  enabled: boolean
  preset: PanelLayoutPreset
}

/** Hydrates flag + preset in the isolated store, mutating localStorage like the shell story. */
function HydrateEngine({ enabled, preset }: HydrateEngineProps) {
  const setFlag = useSetAtom(featureLayoutEngineAtom)
  const setLayout = useSetAtom(demoLayoutAtom)
  // The flag atom persists to the shared origin's localStorage: snapshot the
  // shipped value before this story writes it and restore it on unmount, so a
  // QA run never leaves featureLayoutEngine ON for the real app. Declared first
  // so it captures the value before the effects below write.
  React.useEffect(() => {
    const key = getKeyString(KEYS.featureLayoutEngine)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  React.useEffect(() => {
    setLayout({ update: (current) => withPanelWorkspacePreset(current, preset), commit: true })
  }, [preset, setLayout])
  const previousEnabled = React.useRef(enabled)
  React.useEffect(() => {
    if (previousEnabled.current !== enabled) setFlag(enabled)
    previousEnabled.current = enabled
  }, [enabled, setFlag])
  return null
}

interface StageProps {
  panelCount: number
}

function Stage({ panelCount }: StageProps) {
  const enabled = useAtomValue(featureLayoutEngineAtom)
  const preferences = useAtomValue(demoLayoutAtom)
  const [stageRef, width] = useMeasuredWidth<HTMLDivElement>()
  const count = Math.max(1, Math.min(DEMO_PANEL_LABELS.length, Math.floor(panelCount) || 1))
  const layout = React.useMemo(
    () => (enabled && preferences.preset !== 'auto' ? computeLayout(width, preferences.preset, count) : null),
    [enabled, preferences.preset, width, count],
  )
  const shape = layout && !layout.singlePanel
    ? { columns: layout.columns, rows: layout.rows }
    : panelGridShape(count, layout ? 'focus' : 'auto')
  const tracks = React.useMemo(
    () => resolvePanelGridTracks(preferences, shape, Array.from({ length: count }, () => 1 / count)),
    [preferences, shape, count],
  )
  const shortfall = layout ? Math.max(0, layout.requestedWidth - width) : 0
  const gridColumns = tracks.columns.map((weight) => `minmax(${PANEL_GRID_MIN_WIDTH}px, ${weight}fr)`).join(' ')
  const gridRows = shape.rows === 1
    ? `minmax(${PANEL_GRID_MIN_HEIGHT}px, 1fr)`
    : tracks.rows.map((weight) => `minmax(${PANEL_GRID_MIN_HEIGHT}px, ${weight}fr)`).join(' ')
  const readout = layout
    ? `${layout.preset} → ${layout.effective} · ${layout.columns}×${layout.rows}${layout.tiles ? ' плитки' : ''} · нужно ${layout.requestedWidth} px`
    : `auto · ${shape.columns}×${shape.rows}`

  return (
    <div
      ref={stageRef}
      className="flex h-full w-full flex-col overflow-hidden bg-surface-canvas text-text-primary"
      data-testid="screen-layout-engine-stage"
      data-layout-engine={enabled ? 'studio' : 'legacy'}
      data-layout-preset={preferences.preset}
      data-layout-effective={layout ? layout.effective : 'auto'}
    >
      <div
        className="grid min-h-0 flex-1 overflow-auto bg-surface-canvas p-3"
        data-panel-grid={panelGridKey(shape)}
        style={{ gap: PANEL_GAP, gridTemplateColumns: gridColumns, gridTemplateRows: gridRows }}
      >
        {DEMO_PANEL_LABELS.slice(0, count).map((label, index) => {
          const hidden = (layout?.singlePanel ?? false) && index > 0
          return (
            <section
              key={label}
              data-panel-role="content"
              data-panel-index={index}
              hidden={hidden}
              className={hidden
                ? 'hidden'
                : 'flex min-h-0 min-w-0 flex-col rounded-[var(--radius-card)] border border-border-subtle bg-surface-elevated'}
              style={{ gridColumn: (index % shape.columns) + 1, gridRow: Math.floor(index / shape.columns) + 1 }}
            >
              <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border-subtle px-3 text-small font-medium">
                <span className="grid size-4 place-items-center rounded-full bg-accent/10 text-caption text-accent tabular-nums">{index + 1}</span>
                <span className="truncate">{label}</span>
                {index === 0 && <span className="ml-auto rounded-full bg-surface-canvas px-2 py-0.5 text-caption text-text-secondary">фокус</span>}
              </header>
              <div className="min-h-0 flex-1 bg-surface-canvas p-3 text-caption text-text-secondary">
                Панель остаётся смонтированной; раскладка меняет только геометрию.
              </div>
            </section>
          )
        })}
      </div>
      <div
        className="flex h-7 shrink-0 items-center gap-2 border-t border-border-subtle bg-surface-elevated px-3 text-caption text-text-secondary"
        data-testid="screen-layout-engine-readout"
      >
        <span className="font-medium text-text-primary tabular-nums">{readout}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">доступно {Math.round(width)} px</span>
        {layout && !layout.fits && <span className="text-status-danger tabular-nums">дефицит {shortfall} px</span>}
        <span className="ml-auto tabular-nums">{`flag ${enabled ? 'ON' : 'OFF'}`}</span>
      </div>
    </div>
  )
}

interface LayoutEngineDemoProps {
  enabled: boolean
  preset: PanelLayoutPreset
  panelCount: number
}

function LayoutEngineDemo({ enabled, preset, panelCount }: LayoutEngineDemoProps) {
  const store = React.useMemo(() => createStore(), [])
  return (
    <JotaiProvider store={store}>
      <HydrateEngine enabled={enabled} preset={preset} />
      <Stage panelCount={panelCount} />
    </JotaiProvider>
  )
}

export default definePlaygroundStory({
  id: 'screen-layout-engine',
  name: 'Студия — движок раскладки',
  category: 'Unified Shell',
  level: 'Screens',
  description:
    'G4 «Студия»: чистое ядро computeLayout() над плоским стеком панелей. Флаг featureLayoutEngine (по умолчанию OFF) гидрируется в изолированном store вместе с пресетом; OFF показывает текущую авто-сетку, ON переключает 1/2/3 колонки и плитки «Стены» без пересоздания панелей.',
  component: LayoutEngineDemo,
  layout: 'full',
  previewOverflow: 'hidden',
  props: [
    { name: 'enabled', description: 'featureLayoutEngineAtom (пилотный флаг)', control: { type: 'boolean' }, defaultValue: true },
    {
      name: 'preset',
      description: 'Именованная раскладка',
      control: {
        type: 'select',
        options: [
          { label: 'Авто', value: 'auto' },
          { label: 'Фокус', value: 'focus' },
          { label: 'Диалог', value: 'dialog' },
          { label: 'Триптих', value: 'triptych' },
          { label: 'Стена', value: 'wall' },
        ],
      },
      defaultValue: 'dialog',
    },
    { name: 'panelCount', description: 'Число панелей в стеке', control: { type: 'number', min: 1, max: 5, step: 1 }, defaultValue: 4 },
  ],
  variants: [
    { name: 'Триптих', props: { preset: 'triptych' } },
    { name: 'Стена', props: { preset: 'wall' } },
    { name: 'Фокус', props: { preset: 'focus' } },
  ],
})