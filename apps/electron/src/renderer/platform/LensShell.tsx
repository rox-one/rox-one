/**
 * LensShell (G6 «Линзы») — the docked column / right-edge sheet around the
 * unchanged inspector bodies.
 *
 * The lens is one inspector that reads as a docked column while the centre
 * column keeps its minimum width and as a right-edge sheet when it cannot. The
 * dock/overlay decision is a pure function of the effective width and an
 * explicit user open (report §7); the sheet enters with one authored moment
 * (180ms `--motion-base`, instant under reduced motion) and its backdrop fades
 * in over 120ms `--motion-fast`.
 *
 * The section switcher and the (unchanged) body are the same in both modes —
 * only the container swaps.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { CHROME_TOKENS } from './chrome-tokens'
import { LensSectionSwitcher, type LensSectionEntry } from './LensSectionSwitcher'
import type { InspectorSectionId } from '@/atoms/unified-shell'

export type LensMode = 'docked' | 'overlay'

/**
 * Docked only when the user opened the lens *and* the effective width still
 * clears the derived threshold (rail 48 + navigator 340 + panel-min 440 +
 * lens 320 = 1148). Otherwise the lens floats as a right-edge sheet.
 */
export function resolveLensMode(input: {
  effectiveWidth: number
  userOpened: boolean
  dockMinWidth?: number
}): LensMode {
  const dockMinWidth = input.dockMinWidth ?? CHROME_TOKENS.lensDockMinWidth
  return input.userOpened && input.effectiveWidth >= dockMinWidth ? 'docked' : 'overlay'
}

interface LensBackdropProps {
  onClose: () => void
  className?: string
}

/** Overlay scrim; fades in over `--motion-fast`, instant under reduced motion. */
export function LensBackdrop({ onClose, className }: LensBackdropProps) {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <div
      aria-hidden="true"
      onClick={onClose}
      data-lens-backdrop="true"
      className={cn(
        'absolute inset-y-0 left-[-100vw] right-[var(--chrome-rail-width)] bg-[var(--dialog-backdrop)]',
        'transition-opacity duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
        'motion-reduce:transition-none motion-reduce:opacity-100',
        entered ? 'opacity-100' : 'opacity-0',
        className,
      )}
    />
  )
}

interface LensShellProps {
  mode: LensMode
  section: InspectorSectionId
  sections: readonly LensSectionEntry[]
  onSection: (id: InspectorSectionId) => void
  switcherLabel: string
  children: ReactNode
}

export function LensShell({ mode, section, sections, onSection, switcherLabel, children }: LensShellProps) {
  const [entered, setEntered] = useState(mode !== 'overlay')
  useEffect(() => {
    setEntered(true)
  }, [])
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col',
        'transition-[opacity,transform] duration-[var(--motion-base)] ease-[var(--ease-standard)]',
        'motion-reduce:transition-none',
        mode === 'overlay' && !entered && 'translate-x-2 opacity-60',
      )}
      data-lens-mode={mode}
    >
      <LensSectionSwitcher
        label={switcherLabel}
        sections={sections}
        section={section}
        onSection={onSection}
      />
      <div className="flex min-h-0 flex-1 flex-col" data-lens-section={section}>
        {children}
      </div>
    </div>
  )
}