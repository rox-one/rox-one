import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Heart, MessageSquareQuote, MoreHorizontal, SmilePlus, Sparkles, Swords } from 'lucide-react'
import { SIDE_THREAD_ACTIONS, type SideThreadAction } from '@craft-agent/shared/side-threads'
import { cn } from '../../lib/utils'
import {
  DropdownMenu,
  DropdownMenuSub,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSubContent,
  StyledDropdownMenuSubTrigger,
} from '../ui/StyledDropdown'
import {
  DEFAULT_REACTION_EMOJI,
  QUICK_REACTION_EMOJIS,
  type ReactionCount,
} from './message-reactions'

/** Listen/branch render directly; other actions render in the «…» menu. */
export type MessageDockExtraAction = {
  id: string
  label: string
  icon?: React.ReactNode
  onSelect: () => void
}

/** Heart, copy, quote, listen and branch are directly available. */
export const MESSAGE_DOCK_MAX_VISIBLE = 5

export type MessageHoverDockProps = {
  reactionCounts: ReactionCount[]
  /** Legacy inline picker state; reactions now live in the «…» submenu. */
  pickerOpen?: boolean
  onToggleHeart: () => void
  onToggleEmoji: (emoji: string) => void
  reactionsDisabled?: boolean
  onTogglePicker?: () => void
  /** May return a promise; the copy icon flips to a check once it resolves. */
  onCopy: () => void | Promise<void>
  onQuote?: () => void
  onLearn?: () => void
  /** Side-thread actions (rendered as a submenu of «…»). */
  onPickSideThread?: (action: SideThreadAction) => void
  /** Direct Listen/Branch and additional overflow actions. */
  extraActions?: MessageDockExtraAction[]
  className?: string
}

const iconButton =
  'inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 data-[state=open]:bg-foreground/5 data-[state=open]:text-foreground'

/**
 * Compact message action dock with direct listening and branching buttons,
 * followed by a «…» overflow menu. Flat — no border or
 * pill background.
 */
export function MessageHoverDock({
  reactionCounts,
  onToggleHeart,
  onToggleEmoji,
  reactionsDisabled = false,
  onCopy,
  onQuote,
  onLearn,
  onPickSideThread,
  extraActions = [],
  className,
}: MessageHoverDockProps) {
  const { t } = useTranslation()
  const heart = reactionCounts.find((item) => item.emoji === DEFAULT_REACTION_EMOJI)
  const otherReactions = reactionCounts.filter((item) => item.emoji !== DEFAULT_REACTION_EMOJI && item.count > 0)
  const [copied, setCopied] = React.useState(false)
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])
  const handleCopy = React.useCallback(async () => {
    try {
      await onCopy()
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }, [onCopy])

  return (
    <div
      role="toolbar"
      aria-label={t('chat.messageDock')}
      data-message-dock="compact"
      className={cn('flex items-center gap-0.5', className)}
    >
      <button
        type="button"
        aria-pressed={heart?.mine ?? false}
        aria-label={t('chat.reactHeart')}
        title={t('chat.reactHeart')}
        disabled={reactionsDisabled}
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-[6px] px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
          heart?.mine ? 'text-rose-500' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
        )}
        onClick={onToggleHeart}
      >
        <Heart className={cn('h-3.5 w-3.5', heart?.mine && 'fill-current')} />
        {heart?.count ? <span>{heart.count}</span> : null}
      </button>
      <button
        type="button"
        aria-label={t('common.copy')}
        title={t('common.copy')}
        data-copied={copied ? 'true' : undefined}
        className={iconButton}
        onClick={() => { void handleCopy() }}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {onQuote ? (
        <button type="button" aria-label={t('chat.quoteReply')} title={t('chat.quoteReply')} className={iconButton} onClick={onQuote}>
          <MessageSquareQuote className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {['listen', 'branch'].flatMap((id) => extraActions.filter((action) => action.id === id)).map((action) => (
        <button key={action.id} type="button" aria-label={action.label} title={action.label} className={iconButton} onClick={action.onSelect}>
          <span className="[&_svg]:h-3.5 [&_svg]:w-3.5">{action.icon}</span>
        </button>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={t('common.more')} title={t('common.more')} className={iconButton}>
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="start" minWidth="min-w-48" sideOffset={4}>
          <DropdownMenuSub>
            <StyledDropdownMenuSubTrigger>
              <SmilePlus />
              <span>{t('chat.reactMore')}</span>
            </StyledDropdownMenuSubTrigger>
            <StyledDropdownMenuSubContent minWidth="min-w-0">
              <div role="listbox" aria-label={t('chat.reactPicker')} className="flex items-center gap-0.5">
                {QUICK_REACTION_EMOJIS.map((emoji) => (
                  <StyledDropdownMenuItem
                    key={emoji}
                    role="option"
                    aria-label={emoji}
                    disabled={reactionsDisabled}
                    className="h-7 w-7 justify-center p-0 pr-0 text-sm"
                    onSelect={() => onToggleEmoji(emoji)}
                  >
                    {emoji}
                  </StyledDropdownMenuItem>
                ))}
              </div>
            </StyledDropdownMenuSubContent>
          </DropdownMenuSub>
          {onLearn ? (
            <StyledDropdownMenuItem onSelect={onLearn}>
              <Sparkles />
              <span>{t('chat.learnFromMessage')}</span>
            </StyledDropdownMenuItem>
          ) : null}
          {onPickSideThread ? (
            <DropdownMenuSub>
              <StyledDropdownMenuSubTrigger>
                <Swords />
                <span>{t('sideThread.menu')}</span>
              </StyledDropdownMenuSubTrigger>
              <StyledDropdownMenuSubContent>
                {SIDE_THREAD_ACTIONS.map((action) => (
                  <StyledDropdownMenuItem key={action} onSelect={() => onPickSideThread(action)}>
                    {t(`sideThread.action.${action}`)}
                  </StyledDropdownMenuItem>
                ))}
              </StyledDropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          {extraActions.filter((action) => action.id !== 'listen' && action.id !== 'branch').map((action) => (
            <StyledDropdownMenuItem key={action.id} onSelect={action.onSelect}>
              {action.icon}
              <span>{action.label}</span>
            </StyledDropdownMenuItem>
          ))}
        </StyledDropdownMenuContent>
      </DropdownMenu>
      {otherReactions.map((item) => (
        <button
          key={item.emoji}
          type="button"
          aria-pressed={item.mine}
          disabled={reactionsDisabled}
          aria-label={item.emoji}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-[6px] px-1.5 text-xs',
            item.mine ? 'bg-foreground/5 text-foreground' : 'text-muted-foreground hover:bg-foreground/5',
          )}
          onClick={() => onToggleEmoji(item.emoji)}
        >
          <span>{item.emoji}</span>
          <span>{item.count}</span>
        </button>
      ))}
    </div>
  )
}
