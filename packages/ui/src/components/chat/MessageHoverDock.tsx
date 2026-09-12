import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Heart, Highlighter, MessageSquareQuote, Share2, SmilePlus, Sparkles } from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  DEFAULT_REACTION_EMOJI,
  QUICK_REACTION_EMOJIS,
  type ReactionCount,
} from './message-reactions'

export type MessageHoverDockProps = {
  reactionCounts: ReactionCount[]
  pickerOpen: boolean
  onToggleHeart: () => void
  onToggleEmoji: (emoji: string) => void
  onTogglePicker: () => void
  onCopy: () => void
  onQuote?: () => void
  onShare?: () => void
  onLearn?: () => void
  onHighlight?: () => void
  className?: string
}

export function MessageHoverDock({
  reactionCounts,
  pickerOpen,
  onToggleHeart,
  onToggleEmoji,
  onTogglePicker,
  onCopy,
  onQuote,
  onShare,
  onLearn,
  onHighlight,
  className,
}: MessageHoverDockProps) {
  const { t } = useTranslation()
  const heart = reactionCounts.find((item) => item.emoji === DEFAULT_REACTION_EMOJI)

  return (
    <div
      role="toolbar"
      aria-label={t('chat.messageDock')}
      className={cn(
        'flex flex-wrap items-center gap-1 rounded-full border border-border/60 bg-background/90 px-1.5 py-1 shadow-minimal',
        className,
      )}
    >
      <button
        type="button"
        aria-pressed={heart?.mine ?? false}
        aria-label={t('chat.reactHeart')}
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs',
          heart?.mine ? 'bg-rose-500/15 text-rose-600' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
        )}
        onClick={onToggleHeart}
      >
        <Heart className={cn('h-3.5 w-3.5', heart?.mine && 'fill-current')} />
        {heart?.count ? <span>{heart.count}</span> : null}
      </button>
      <button
        type="button"
        aria-expanded={pickerOpen}
        aria-label={t('chat.reactMore')}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        onClick={onTogglePicker}
      >
        <SmilePlus className="h-3.5 w-3.5" />
      </button>
      {pickerOpen ? (
        <div role="listbox" aria-label={t('chat.reactPicker')} className="flex items-center gap-0.5">
          {QUICK_REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="option"
              aria-label={emoji}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-sm hover:bg-foreground/5"
              onClick={() => onToggleEmoji(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
      {onHighlight ? (
        <button
          type="button"
          aria-label={t('chat.highlightPassage')}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={onHighlight}
        >
          <Highlighter className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={t('common.copy')}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        onClick={onCopy}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      {onQuote ? (
        <button
          type="button"
          aria-label={t('chat.quoteReply')}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={onQuote}
        >
          <MessageSquareQuote className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {onShare ? (
        <button
          type="button"
          aria-label={t('chat.shareMessage')}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={onShare}
        >
          <Share2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {onLearn ? (
        <button
          type="button"
          aria-label={t('chat.learnFromMessage')}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={onLearn}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}
