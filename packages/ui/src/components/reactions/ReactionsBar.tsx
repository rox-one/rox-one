/**
 * ReactionsBar (W1-08, UI-SPEC §4 "ReactionBar"; TECH-SPEC §3.7).
 *
 * Emoji chips with counts; a chip is `aria-pressed` when the viewer has
 * reacted. "+" opens a small built-in emoji palette (emoji-mart is not a
 * dependency of the repo; the palette is replaceable through `palette`).
 * Controlled: emits `onToggle(emoji)`; the host runs reactions.add/remove.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { FOCUS_RING, HOVER_TINT, MOTION_FAST, POPOVER_SURFACE, SELECTED_TINT } from '../primitives/tokens'

export interface ReactionSummary {
  emoji: string
  count: number
  /** True when the current viewer reacted with this emoji. */
  mine?: boolean
}

export const DEFAULT_REACTION_PALETTE = ['👍', '👎', '❤️', '🎉', '😄', '😮', '😢', '🔥', '👀', '✅'] as const

/** Apply a viewer toggle to a reaction list (pure; exported for optimistic UIs + tests). */
export function applyReactionToggle(reactions: readonly ReactionSummary[], emoji: string): ReactionSummary[] {
  const existing = reactions.find((r) => r.emoji === emoji)
  if (!existing) return [...reactions, { emoji, count: 1, mine: true }]
  const next = reactions.map((r) => r.emoji !== emoji ? r : { ...r, count: r.count + (r.mine ? -1 : 1), mine: !r.mine })
  return next.filter((r) => r.count > 0)
}

export interface ReactionsBarProps {
  reactions: readonly ReactionSummary[]
  onToggle?: (emoji: string) => void
  palette?: readonly string[]
  className?: string
}

export function ReactionsBar({ reactions, onToggle, palette = DEFAULT_REACTION_PALETTE, className }: ReactionsBarProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const addRef = React.useRef<HTMLButtonElement>(null)
  const interactive = !!onToggle

  return (
    <div className={cn('relative flex flex-wrap items-center gap-1', className)}>
      {reactions.filter((r) => r.count > 0).map((r) => (
        <button
          key={r.emoji}
          type="button"
          disabled={!interactive}
          aria-pressed={!!r.mine}
          aria-label={t('entities.ui.reactions.toggle', { emoji: r.emoji, count: r.count })}
          onClick={() => onToggle?.(r.emoji)}
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[12px] tabular-nums',
            r.mine ? cn(SELECTED_TINT, 'border-accent/40') : 'border-border bg-foreground/[0.03]',
            interactive && HOVER_TINT, MOTION_FAST, FOCUS_RING,
          )}
        >
          <span aria-hidden="true">{r.emoji}</span>
          <span aria-hidden="true">{r.count}</span>
        </button>
      ))}
      {interactive ? (
        <button
          ref={addRef}
          type="button"
          aria-label={t('entities.ui.reactions.add')}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn('inline-flex h-6 w-7 items-center justify-center rounded-full border border-border text-[12px] text-text-muted', HOVER_TINT, MOTION_FAST, FOCUS_RING)}
        >
          +
        </button>
      ) : null}
      {open && interactive ? (
        <div
          role="group"
          aria-label={t('entities.ui.reactions.picker')}
          onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); addRef.current?.focus() } }}
          className={cn('absolute left-0 top-full z-20 mt-1 grid grid-cols-5 gap-0.5 p-1', POPOVER_SURFACE)}
        >
          {palette.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={emoji}
              onClick={() => { onToggle?.(emoji); setOpen(false); addRef.current?.focus() }}
              className={cn('size-8 rounded-[6px] text-[16px]', HOVER_TINT, FOCUS_RING)}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
