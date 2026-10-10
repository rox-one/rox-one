/**
 * «Студия» — LayoutDeck + LayoutDeckHost (G4 deferred slice).
 *
 * A thin deck that rises from the bottom edge of the shell (⌘\, action
 * `layout.deck`) and lists the four named arrangements — Фокус / Диалог /
 * Триптих / Стена — as live schematic previews of the CURRENT workspace: the
 * preview is `computeLayout(columnsArea, preset, panelCount)`, never a
 * screenshot, so it reflows with the width and the panel count like the real
 * grid does. `1…4` applies a preset, arrow keys / `Tab` move a roving focus,
 * `Enter` confirms and closes, `Esc` leaves the geometry alone.
 *
 * A preset the current width cannot honour is disabled and says by how much
 * (`computeLayout().requestedWidth - availableWidth` px).
 *
 * Everything is gated by `featureLayoutEngineAtom`: with the flag OFF the Host
 * registers no action handler (⌘\ is not intercepted at all) and renders
 * nothing, and the rail trigger is not mounted. Reuses the Rox token roles and
 * the existing `usePanelWorkspaceLayout` preset write, so applying a preset is
 * a preference commit like any other — no route, never a panel reparent.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { atom, useAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Check, Columns2, Columns3, Focus, Grid2X2, Plus, RotateCcw, Trash2, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAction } from '@/actions'
import { panelCountAtom } from '@/atoms/panel-stack'
import { featureLayoutEngineAtom } from '@/atoms/unified-shell'
import { useOptionalPanelWorkspaceLayout } from '@/hooks/usePanelWorkspaceLayout'
import { useOptionalDismissibleLayerRegistry } from '@/context/DismissibleLayerContext'
import { usePrefersReducedMotion } from '@/lib/render-profile-motion'
import { defaultPanelLayoutPreset, type PanelLayoutPreset } from '@/lib/panel-workspace-layout'
import { computeLayout, type PanelLayout, type PanelLayoutNamedPreset } from '@/lib/layout-engine'

/** Deck visibility — shared by the rail trigger and the Host. */
export const layoutDeckOpenAtom = atom(false)

interface DeckPreset {
  preset: PanelLayoutNamedPreset
  /** `layout.deck.preset.<key>` label key. */
  key: string
  /** `layout.deck.preset.<key>Aria` accessible-name key. */
  ariaKey: string
  icon: LucideIcon
}

/** The four named arrangements, in deck order (1…4). */
const DECK_PRESETS: readonly DeckPreset[] = [
  { preset: 'focus', key: 'focus', ariaKey: 'focusAria', icon: Focus },
  { preset: 'dialog', key: 'dialog', ariaKey: 'dialogAria', icon: Columns2 },
  { preset: 'triptych', key: 'triptych', ariaKey: 'triptychAria', icon: Columns3 },
  { preset: 'wall', key: 'wall', ariaKey: 'wallAria', icon: Grid2X2 },
] as const

/** `layout.deck.preset.<key>` for a saved profile's preset; `auto` has no label. */
const PROFILE_PRESET_LABEL_KEY: Partial<Record<PanelLayoutPreset, string>> = {
  focus: 'focus',
  dialog: 'dialog',
  triptych: 'triptych',
  wall: 'wall',
}

/**
 * Width of the columns area the engine reflows — the panel-stack grid viewport
 * when the shell renders one (the same element `computeLayout` is fed in
 * `PanelStackContainer`), else the stack, else the window. DOM-measured so the
 * Host can live outside the panel tree.
 */
function measureColumnsArea(): number {
  if (typeof document !== 'undefined') {
    const viewport = document.querySelector('[data-panel-grid-viewport="true"]')
    if (viewport instanceof HTMLElement && viewport.clientWidth > 0) return viewport.clientWidth
    const stack = document.querySelector('[data-panel-layout]')
    if (stack instanceof HTMLElement && stack.clientWidth > 0) return stack.clientWidth
  }
  return typeof window === 'undefined' ? 0 : window.innerWidth
}

/** Live columns-area width while the deck is open. */
function useColumnsAreaWidth(active: boolean): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth))
  useEffect(() => {
    if (!active) return
    const measure = () => setWidth(measureColumnsArea())
    measure()
    const target =
      document.querySelector('[data-panel-grid-viewport="true"]') ??
      document.querySelector('[data-panel-layout]')
    if (typeof ResizeObserver === 'undefined' || !target) {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(target)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [active])
  return width
}

/** Schematic miniature of a resolved layout: peer columns or wall tiles. */
function DeckPreview({ layout, disabled, current }: { layout: PanelLayout; disabled: boolean; current: boolean }) {
  const columns = Math.max(1, layout.columns)
  const rows = Math.max(1, layout.rows)
  const cells = Array.from({ length: columns * rows }, (_, index) => index)
  return (
    <div
      aria-hidden
      data-layout-deck-preview
      className={cn(
        'grid h-10 w-full gap-[2px] rounded-[var(--radius-xs)] border bg-canvas p-[2px]',
        current ? 'border-focus' : 'border-border-subtle',
        disabled && 'opacity-40',
      )}
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {cells.map((index) => (
        <span
          key={index}
          className={cn(
            'rounded-[var(--radius-xs)]',
            !layout.singlePanel && !layout.tiles && index === 0 ? 'bg-accent/25' : 'bg-surface-elevated',
          )}
        />
      ))}
    </div>
  )
}

export interface LayoutDeckProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The deck itself; the Host owns the open state and the ⌘\ action. */
export function LayoutDeck({ open, onOpenChange }: LayoutDeckProps) {
  const { t } = useTranslation()
  const { preset, setPreset, resetLayout, profiles, saveProfile, applyProfile, deleteProfile } = useOptionalPanelWorkspaceLayout()
  const panelCount = useAtomValue(panelCountAtom)
  const columnsArea = useColumnsAreaWidth(open)
  const reduceMotion = usePrefersReducedMotion()
  const dismissible = useOptionalDismissibleLayerRegistry()
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const [focusedPreset, setFocusedPreset] = useState<PanelLayoutNamedPreset>('dialog')
  const [profileName, setProfileName] = useState('')

  const close = useCallback(() => onOpenChange(false), [onOpenChange])

  const saveCurrentProfile = useCallback(() => {
    const name = profileName.trim()
      || t('shell.layout.profiles.defaultName', { n: profiles.length + 1, defaultValue: 'Профиль {{n}}' })
    saveProfile(name)
    setProfileName('')
  }, [profileName, profiles.length, saveProfile, t])

  const resetToDefault = useCallback(() => {
    setPreset(defaultPanelLayoutPreset())
    resetLayout()
  }, [setPreset, resetLayout])

  // The profiles section keeps its own keys: not one digit, `Enter` or arrow may
  // leak to the deck's preset roving. `Esc` still closes the deck and `Tab`
  // still reaches the deck's focus trap, so tab order inside the dialog holds.
  const handleProfilesKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') return
    event.stopPropagation()
  }, [])

  const handleProfileNameKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    event.stopPropagation()
    saveCurrentProfile()
  }, [saveCurrentProfile])

  // Esc closes through the shell's dismissible-layer stack (the Host path); the
  // local keydown handler covers isolated mounts that have no registry.
  useEffect(() => {
    if (!open || !dismissible) return
    return dismissible.registerLayer({
      id: 'layout-deck',
      type: 'custom',
      priority: 1,
      isOpen: true,
      close,
    })
  }, [open, dismissible, close])

  const count = Math.max(1, panelCount)
  const layouts = useMemo(() => {
    const resolved = {} as Record<PanelLayoutNamedPreset, PanelLayout>
    for (const entry of DECK_PRESETS) resolved[entry.preset] = computeLayout(columnsArea, entry.preset, count)
    return resolved
  }, [columnsArea, count])

  const isFeasible = useCallback(
    (value: PanelLayoutNamedPreset) => columnsArea >= layouts[value].requestedWidth,
    [columnsArea, layouts],
  )
  const shortfallFor = useCallback(
    (value: PanelLayoutNamedPreset) => Math.max(0, layouts[value].requestedWidth - columnsArea),
    [columnsArea, layouts],
  )

  // Roving order skips disabled presets so arrows never land on a dead one.
  const rovingOrder = useMemo(() => {
    const feasible = DECK_PRESETS.filter((entry) => isFeasible(entry.preset)).map((entry) => entry.preset)
    return feasible.length > 0 ? feasible : DECK_PRESETS.map((entry) => entry.preset)
  }, [isFeasible])

  // On open, land focus on the current preset (or the first reachable one).
  useEffect(() => {
    if (!open) return
    const landing = preset !== 'auto' && rovingOrder.includes(preset) ? preset : rovingOrder[0]
    if (!landing) return
    setFocusedPreset(landing)
    const node = buttonRefs.current.get(landing)
    if (node) node.focus()
    else containerRef.current?.focus()
  }, [open, preset, rovingOrder])

  const moveFocus = useCallback((direction: 1 | -1) => {
    setFocusedPreset((current) => {
      const index = rovingOrder.indexOf(current)
      const next = rovingOrder[(index + direction + rovingOrder.length) % rovingOrder.length]
      if (!next) return current
      buttonRefs.current.get(next)?.focus()
      return next
    })
  }, [rovingOrder])

  const apply = useCallback(
    (value: PanelLayoutNamedPreset) => {
      if (!isFeasible(value)) return
      setPreset(value)
      setFocusedPreset(value)
    },
    [isFeasible, setPreset],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const digit = event.code?.startsWith('Digit') ? Number(event.code.slice(5)) : Number(event.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= DECK_PRESETS.length) {
        event.preventDefault()
        const presetAt = DECK_PRESETS[digit - 1]
        if (presetAt) apply(presetAt.preset)
        return
      }
      switch (event.key) {
        case 'Escape':
          event.preventDefault()
          close()
          return
        case 'Enter':
          event.preventDefault()
          apply(focusedPreset)
          close()
          return
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault()
          moveFocus(1)
          return
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault()
          moveFocus(-1)
          return
        case 'Home': {
          event.preventDefault()
          const first = rovingOrder[0]
          if (!first) return
          setFocusedPreset(first)
          buttonRefs.current.get(first)?.focus()
          return
        }
        case 'End': {
          event.preventDefault()
          const last = rovingOrder[rovingOrder.length - 1]
          if (!last) return
          setFocusedPreset(last)
          buttonRefs.current.get(last)?.focus()
          return
        }
        case 'Tab': {
          const nodes = Array.from(containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
          const first = nodes[0]
          const last = nodes[nodes.length - 1]
          if (!first || !last) return
          const active = document.activeElement
          if (event.shiftKey && (active === first || !containerRef.current?.contains(active))) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && active === last) {
            event.preventDefault()
            first.focus()
          }
          return
        }
        default:
          return
      }
    },
    [apply, close, focusedPreset, moveFocus, rovingOrder],
  )

  if (!open) return null

  const currentLayout = preset === 'auto' ? undefined : layouts[preset]
  const title = t('layout.deck.title', { defaultValue: 'Раскладка' })
  const profilesTitle = t('shell.layout.profiles.title', { defaultValue: 'Профили раскладки' })
  const profilesHint = t('shell.layout.profiles.hint', { defaultValue: 'Сохраните текущую раскладку и вернитесь к ней одним нажатием' })
  const profilesEmpty = t('shell.layout.profiles.empty', { defaultValue: 'Профилей пока нет' })
  const profilesSave = t('shell.layout.profiles.save', { defaultValue: 'Сохранить' })
  const profilesApply = t('shell.layout.profiles.apply', { defaultValue: 'Применить' })
  const profilesDelete = t('shell.layout.profiles.delete', { defaultValue: 'Удалить' })
  const profilesReset = t('shell.layout.profiles.reset', { defaultValue: 'Сбросить раскладку' })
  const profilesName = t('shell.layout.profiles.name', { defaultValue: 'Название профиля' })

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[var(--z-modal)] flex justify-center px-3 pb-3"
      data-layout-deck-layer
    >
      <motion.div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        initial={reduceMotion ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.12, ease: [0.2, 0.8, 0.2, 1] }}
        data-layout-deck
        data-layout-deck-preset={preset}
        data-layout-deck-effective={currentLayout?.effective ?? 'auto'}
        className="pointer-events-auto flex w-full max-w-[640px] flex-col gap-2 rounded-[var(--radius-overlay)] border border-border-subtle bg-surface-elevated p-3 shadow-[var(--shadow-overlay)] outline-none"
      >
        <div className="flex items-center gap-2">
          <h2 className="text-small font-medium text-text-primary">{title}</h2>
          <span className="min-w-0 flex-1 truncate text-caption text-text-secondary">
            {t('layout.deck.hint', { defaultValue: '1–4 применить · Enter подтвердить · Esc закрыть' })}
          </span>
          <button
            type="button"
            aria-label={t('layout.deck.close', { defaultValue: 'Закрыть' })}
            onClick={close}
            className="grid h-[var(--control-hit-min)] w-[var(--control-hit-min)] place-items-center rounded-[var(--radius-control)] text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus"
          >
            <X className="icon-caption" aria-hidden />
          </button>
        </div>

        <div role="group" aria-label={title} className="grid grid-cols-4 gap-2" data-layout-deck-grid>
          {DECK_PRESETS.map(({ preset: value, key, ariaKey, icon: Icon }, index) => {
            const layout = layouts[value]
            const feasible = isFeasible(value)
            const current = preset === value
            const label = t(`layout.deck.preset.${key}`, { defaultValue: key })
            const ariaLabel = t(`layout.deck.preset.${ariaKey}`, { defaultValue: label })
            return (
              <button
                key={value}
                ref={(node) => {
                  if (node) buttonRefs.current.set(value, node)
                  else buttonRefs.current.delete(value)
                }}
                type="button"
                disabled={!feasible}
                aria-disabled={!feasible || undefined}
                aria-label={ariaLabel}
                aria-pressed={current}
                tabIndex={rovingOrder.includes(value) ? (focusedPreset === value ? 0 : -1) : -1}
                onClick={() => apply(value)}
                onFocus={() => setFocusedPreset(value)}
                data-layout-deck-preset-item={value}
                data-layout-deck-feasible={feasible}
                data-layout-deck-current={current || undefined}
                title={
                  feasible
                    ? `${index + 1} · ${label}`
                    : t('layout.deck.infeasible', { defaultValue: '{{preset}} — нужно {{needed}} px', preset: label, needed: shortfallFor(value) })
                }
                className={cn(
                  'flex min-h-[var(--control-hit-min)] flex-col gap-1 rounded-[var(--radius-card)] border p-2 text-left transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
                  'focus-visible:ring-2 focus-visible:ring-focus',
                  feasible
                    ? current
                      ? 'border-focus bg-surface-selected'
                      : 'border-border-subtle bg-canvas hover:border-border-strong hover:bg-surface-hover'
                    : 'cursor-not-allowed border-border-subtle bg-canvas text-text-disabled',
                )}
              >
                <span className="flex items-center gap-1.5">
                  <Icon className="icon-caption shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-caption font-medium">{label}</span>
                  {current && <Check className="icon-caption shrink-0" aria-label={t('layout.deck.selected', { defaultValue: 'Текущая раскладка' })} />}
                </span>
                <DeckPreview layout={layout} disabled={!feasible} current={current} />
                {!feasible && (
                  <span className="text-caption numeric">
                    {t('layout.deck.infeasible', { defaultValue: '{{preset}} — нужно {{needed}} px', preset: label, needed: shortfallFor(value) })}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2 text-caption text-text-secondary" data-layout-deck-readout>
          <span className="numeric">
            {t('layout.deck.available', { defaultValue: 'Доступно {{width}} px', width: Math.round(columnsArea) })}
          </span>
        </div>

        <section
          aria-label={profilesTitle}
          data-layout-deck-profiles
          onKeyDown={handleProfilesKeyDown}
          className="flex flex-col gap-2 border-t border-border-subtle pt-2"
        >
          <div className="flex items-baseline gap-2">
            <h3 className="shrink-0 text-caption font-medium text-text-primary">{profilesTitle}</h3>
            <span className="min-w-0 flex-1 truncate text-caption text-text-secondary" title={profilesHint}>{profilesHint}</span>
          </div>

          {profiles.length > 0 ? (
            <ul className="flex flex-col gap-1" data-layout-deck-profiles-list>
              {profiles.map((profile) => {
                const presetKey = PROFILE_PRESET_LABEL_KEY[profile.preset]
                return (
                  <li
                    key={profile.id}
                    data-layout-deck-profile-item={profile.id}
                    className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-border-subtle bg-canvas px-2 py-1"
                  >
                    <span className="min-w-0 flex-1 truncate text-caption font-medium text-text-primary" title={profile.name}>{profile.name}</span>
                    {presetKey && (
                      <span className="shrink-0 text-caption text-text-secondary">
                        {t(`layout.deck.preset.${presetKey}`, { defaultValue: presetKey })}
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={`${profilesApply}: ${profile.name}`}
                      title={profilesApply}
                      onClick={() => applyProfile(profile.id)}
                      className="grid h-[var(--control-hit-min)] w-[var(--control-hit-min)] shrink-0 place-items-center rounded-[var(--radius-control)] text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      <Check className="icon-caption" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`${profilesDelete}: ${profile.name}`}
                      title={profilesDelete}
                      onClick={() => deleteProfile(profile.id)}
                      className="grid h-[var(--control-hit-min)] w-[var(--control-hit-min)] shrink-0 place-items-center rounded-[var(--radius-control)] text-text-secondary hover:bg-surface-hover hover:text-destructive focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      <Trash2 className="icon-caption" aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-caption text-text-secondary" data-layout-deck-profiles-empty>{profilesEmpty}</p>
          )}

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              onKeyDown={handleProfileNameKeyDown}
              aria-label={profilesName}
              placeholder={profilesName}
              data-layout-deck-profile-name
              className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-border-subtle bg-canvas px-2 py-1 text-caption text-text-primary outline-none placeholder:text-text-secondary focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus"
            />
            <button
              type="button"
              onClick={saveCurrentProfile}
              className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-control)] border border-border-subtle bg-canvas px-2 py-1 text-caption text-text-primary hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus"
            >
              <Plus className="icon-caption" aria-hidden />
              <span>{profilesSave}</span>
            </button>
          </div>

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={resetToDefault}
              className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-control)] px-2 py-1 text-caption text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus"
            >
              <RotateCcw className="icon-caption" aria-hidden />
              <span>{profilesReset}</span>
            </button>
          </div>
        </section>
      </motion.div>
    </div>
  )
}

/**
 * App-level host: owns the open atom, wires ⌘\ (`layout.deck`) and mounts the
 * deck. The action is enabled only while the flag is ON, so with the flag OFF
 * the hotkey is never intercepted and the deck never renders.
 */
export function LayoutDeckHost() {
  const [open, setOpen] = useAtom(layoutDeckOpenAtom)
  const layoutEngineOn = useAtomValue(featureLayoutEngineAtom)

  useAction('layout.deck', () => setOpen((value) => !value), { enabled: () => layoutEngineOn })

  // Flag turned off while the deck is open: drop it rather than leave the
  // overlay mounted over a legacy shell.
  useEffect(() => {
    if (!layoutEngineOn && open) setOpen(false)
  }, [layoutEngineOn, open, setOpen])

  return <LayoutDeck open={open} onOpenChange={setOpen} />
}