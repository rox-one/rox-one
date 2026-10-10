/**
 * G5 «Континуум диалога» — shared primitives.
 *
 * Ported 1:1 from the G5 prototype kit
 * (archive/rox-ui-prototypes-g05 …/playground/proto/g05-kit.tsx): every colour,
 * radius, space, type step and motion value comes from the Rox token layer.
 * `data-g05-*` hooks are preserved so the visual diff stays measurable.
 */
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Status tone. The `*Text` variants map onto the `--color-*-text` theme tokens
 * (added alongside `--color-accent-text`), which stay readable at
 * `--text-caption`; the raw status colours are 3:1-class fills/dots.
 */
export type ContinuumTone = 'neutral' | 'running' | 'success' | 'warning' | 'danger' | 'info'

export function continuumToneClass(tone: ContinuumTone): string {
  switch (tone) {
    case 'running':
      return 'text-accent-text'
    case 'success':
      return 'text-success-text'
    case 'warning':
      return 'text-info-text'
    case 'danger':
      return 'text-destructive-text'
    case 'info':
      return 'text-info-text'
    case 'neutral':
    default:
      return 'text-text-secondary'
  }
}

/** Keyboard hint chip. Caption size (11px floor), mono, token borders only. */
export function ContinuumKbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[var(--radius-xs)] border border-border-subtle bg-surface-elevated px-1 font-mono text-caption text-text-secondary">
      {children}
    </kbd>
  )
}

/** Flat metadata badge used inside artifact headers. */
export function ContinuumBadge({
  tone = 'neutral',
  children,
  mono = false,
}: {
  tone?: ContinuumTone
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <span
      data-g05-badge={tone}
      className={cn(
        'inline-flex items-center gap-1.5 text-caption whitespace-nowrap',
        mono && 'font-mono numeric',
        continuumToneClass(tone),
      )}
    >
      {tone !== 'neutral' && (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-current motion-reduce:animate-none"
        />
      )}
      {children}
    </span>
  )
}