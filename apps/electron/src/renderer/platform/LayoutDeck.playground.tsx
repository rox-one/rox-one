/**
 * «Студия» — layout deck — story: `screen-layout-deck`.
 *
 * Fixture for the ⌘\ deck (featureLayoutEngineAtom, default OFF). The isolated
 * jotai store hydrates the flag, a flat panel stack and the open atom, then
 * mounts the real `LayoutDeck` over a mock columns area carrying the same
 * `[data-panel-grid-viewport]` attribute the shell uses — so the deck measures
 * a live width and the presets dim with their real shortfall when the area is
 * too narrow. Clicking a preset applies it (the current marker moves); 1…4
 * apply, arrows rove, Enter confirms, Esc closes.
 */
import * as React from 'react'
import { Provider as JotaiProvider, createStore, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { definePlaygroundStory } from '@/playground/registry/story-loader'
import { featureLayoutEngineAtom } from '@/atoms/unified-shell'
import { KEYS, getKeyString } from '@/lib/local-storage'
import { panelStackAtom, type PanelStackEntry } from '@/atoms/panel-stack'
import { LayoutDeck, layoutDeckOpenAtom } from './LayoutDeck'

interface HydrateDeckProps {
  enabled: boolean
  panelCount: number
}

/** Hydrates flag + panel count + open state in the isolated store. */
function HydrateDeck({ enabled, panelCount }: HydrateDeckProps) {
  const setFlag = useSetAtom(featureLayoutEngineAtom)
  const setPanels = useSetAtom(panelStackAtom)
  const setOpen = useSetAtom(layoutDeckOpenAtom)
  // The flag atom persists to the shared origin's localStorage: snapshot the
  // shipped value before this story writes it and restore it on unmount, so a
  // QA run never leaves featureLayoutEngine ON for the real app. Declared first
  // so it captures the value before the effect below writes.
  React.useEffect(() => {
    const key = getKeyString(KEYS.featureLayoutEngine)
    const previous = localStorage.getItem(key)
    return () => {
      if (previous === null) localStorage.removeItem(key)
      else localStorage.setItem(key, previous)
    }
  }, [])
  React.useEffect(() => {
    setFlag(enabled)
  }, [enabled, setFlag])
  React.useEffect(() => {
    const count = Math.max(1, Math.min(5, Math.floor(panelCount) || 1))
    setPanels(
      Array.from({ length: count }, (_, index): PanelStackEntry => ({
        id: `deck-${index}`,
        route: 'sessions' as PanelStackEntry['route'],
        proportion: 1,
        panelType: 'other',
        laneId: 'main',
      })),
    )
  }, [panelCount, setPanels])
  React.useEffect(() => {
    setOpen(enabled)
  }, [enabled, setOpen])
  return null
}

function Stage({ width }: { width: number }) {
  const enabled = useAtomValue(featureLayoutEngineAtom)
  const [open, setOpen] = useAtom(layoutDeckOpenAtom)
  const columns = Math.max(240, Math.round(width))
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-canvas text-text-primary" data-testid="screen-layout-deck-stage">
      <div className="flex min-h-0 flex-1 items-stretch p-3">
        <div
          data-panel-grid-viewport="true"
          style={{ width: columns }}
          className="relative h-full min-w-0 rounded-[var(--radius-card)] border border-border-subtle bg-surface-elevated p-3 text-caption text-text-secondary"
        >
          Макет области колонок · {columns} px
        </div>
      </div>
      <div className="flex h-8 shrink-0 items-center gap-2 border-t border-border-subtle px-3 text-caption text-text-secondary">
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={!enabled}
          className="rounded-[var(--radius-control)] px-2 py-1 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus"
        >
          Открыть деку (⌘\)
        </button>
        <span className="numeric">{`flag ${enabled ? 'ON' : 'OFF'}`}</span>
        {!enabled && <span>дека не смонтирована — клавиша не перехватывается</span>}
      </div>
      {enabled && <LayoutDeck open={open} onOpenChange={setOpen} />}
    </div>
  )
}

interface LayoutDeckDemoProps {
  enabled: boolean
  width: number
  panelCount: number
}

function LayoutDeckDemo({ enabled, width, panelCount }: LayoutDeckDemoProps) {
  const store = React.useMemo(() => createStore(), [])
  return (
    <JotaiProvider store={store}>
      <HydrateDeck enabled={enabled} panelCount={panelCount} />
      <Stage width={width} />
    </JotaiProvider>
  )
}

export default definePlaygroundStory({
  id: 'screen-layout-deck',
  name: 'Студия — дека раскладок',
  category: 'Unified Shell',
  level: 'Screens',
  description:
    'G4 «Студия»: тонкая дека у нижней кромки с четырьмя живыми превью раскладки (Фокус/Диалог/Триптих/Стена) по computeLayout(). 1…4 применяют, стрелки ведут roving-фокус, Enter подтверждает, Esc закрывает. Невыполнимый пресет disabled с недостачей px. При OFF дека не монтируется.',
  component: LayoutDeckDemo,
  layout: 'full',
  previewOverflow: 'hidden',
  props: [
    { name: 'enabled', description: 'featureLayoutEngineAtom (пилотный флаг)', control: { type: 'boolean' }, defaultValue: true },
    { name: 'width', description: 'Ширина области колонок, px', control: { type: 'number', min: 240, max: 1600, step: 20 }, defaultValue: 1000 },
    { name: 'panelCount', description: 'Число панелей в стеке', control: { type: 'number', min: 1, max: 5, step: 1 }, defaultValue: 3 },
  ],
  variants: [
    { name: 'Триптих влезает', props: { width: 1400, panelCount: 3 } },
    { name: 'Триптих не влезает', props: { width: 1000, panelCount: 3 } },
    { name: 'Флаг OFF', props: { enabled: false } },
  ],
})