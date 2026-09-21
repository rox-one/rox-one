import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import { AlertCircle, BookOpen, CheckCircle2, Info, MoreHorizontal, Sparkles, X } from 'lucide-react'
import { headerStatusAtom, dismissHeaderStatusAtom, headerSuggestionAtom } from '@/atoms/header-status'
import { focusedSessionIdAtom } from '@/atoms/panel-stack'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import { headerStatusDuration, headerStatusForWorkspace } from '@/lib/header-status'
import { useHeaderStatusDeadline } from '@/hooks/useHeaderStatusDeadline'
import { cn } from '@/lib/utils'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem } from '@/components/ui/styled-dropdown'

const HEADER_STATUS_FALLBACKS: Record<string, string> = {
  'headerStatus.applySkill': '“{{name}}” fits this task',
  'headerStatus.completed': 'Response ready · {{name}}',
  'headerStatus.dismiss': 'Dismiss notification',
  'headerStatus.draftSkill': 'Draft skill',
  'headerStatus.openWorkflow': 'Open workflow',
  'headerStatus.saveProcess': 'Keep this process?',
  'headerStatus.skillAdded': 'Skill added to draft',
  'headerStatus.skillDraftReady': 'Skill request ready · review and send',
  'headerStatus.useSkill': 'Apply skill',
}

function headerStatusCopy(
  t: (key: string, options?: Record<string, unknown>) => string,
  key: string,
  values?: Record<string, string | number>,
) {
  return t(key, { defaultValue: HEADER_STATUS_FALLBACKS[key] ?? key, ...values })
}

export interface HeaderStatusLaneProps {
  className?: string
}

/** Exiting notices remain painted briefly, but their actions must already be gone. */
export function HeaderStatusPresence({ children, ...props }: Omit<ComponentProps<typeof motion.div>, 'children'> & {
  children: (isPresent: boolean) => ReactNode
}) {
  const isPresent = useIsPresent()
  return (
    <motion.div {...props} aria-hidden={!isPresent || undefined} {...(!isPresent ? { inert: '' } : {})}>
      {children(isPresent)}
    </motion.div>
  )
}

/** Mount once in the stable header. This lane never moves keyboard focus. */
export function HeaderStatusLane({ className }: HeaderStatusLaneProps) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)
  const status = useAtomValue(headerStatusAtom).current
  const suggestion = useAtomValue(headerSuggestionAtom)
  const dismissStatus = useSetAtom(dismissHeaderStatusAtom)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const visibleStatus = headerStatusForWorkspace(status, workspaceId)
  useHeaderStatusDeadline(
    status?.id,
    status ? headerStatusDuration(status) : null,
    Boolean(visibleStatus) && !hovered && !focused && !menuOpen,
    dismissStatus,
  )
  const visibleSuggestion = !visibleStatus
    && suggestion?.workspaceId === workspaceId
    && suggestion.sessionId === focusedSessionId ? suggestion : null
  const message = visibleStatus
    ? headerStatusCopy(t, visibleStatus.messageKey, visibleStatus.values)
    : visibleSuggestion?.kind === 'save-process'
      ? headerStatusCopy(t, 'headerStatus.saveProcess')
      : visibleSuggestion ? headerStatusCopy(t, 'headerStatus.applySkill', { name: visibleSuggestion.skill?.metadata.name ?? '' }) : ''
  const id = visibleStatus?.id ?? visibleSuggestion?.id
  useEffect(() => {
    setHovered(false)
    setFocused(false)
    setMenuOpen(false)
  }, [id])
  const actions = visibleStatus?.action ? [visibleStatus.action] : visibleSuggestion?.actions ?? []
  const Icon = visibleSuggestion
    ? visibleSuggestion.kind === 'apply-skill' ? BookOpen : Sparkles
    : visibleStatus?.tone === 'error' ? AlertCircle : visibleStatus?.tone === 'success' ? CheckCircle2 : Info
  const dismiss = () => {
    if (visibleStatus) dismissStatus(visibleStatus.id)
    else visibleSuggestion?.onDismiss()
  }

  return (
    <div className={cn('header-status-lane titlebar-no-drag pointer-events-auto flex min-w-0 max-w-full', className)} data-header-status-lane>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{message}</span>
      <AnimatePresence initial={false} mode="wait">
        {id && (
          <HeaderStatusPresence
            key={id}
            initial={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -3 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocusCapture={() => setFocused(true)}
            onBlurCapture={event => {
              if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
            }}
            className={cn(
              'flex min-h-7 min-w-0 max-w-[560px] items-center gap-1 rounded-full border border-border/60 bg-background/95 pl-2 pr-0.5 text-xs shadow-minimal',
              visibleStatus?.tone === 'error' && 'border-destructive/30 text-destructive',
            )}
          >
            {isPresent => <>
            <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', visibleStatus?.tone !== 'error' && 'text-accent')} />
            <span className="min-w-0 flex-1 truncate px-1" title={message}>{message}</span>
            {actions.map(action => (
              <button
                key={action.labelKey}
                type="button"
                onClick={() => {
                  action.onClick()
                  if (visibleStatus) dismissStatus(visibleStatus.id)
                }}
                className="min-h-[var(--control-hit-min)] shrink-0 rounded-full px-2 font-medium text-accent outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring max-xl:hidden motion-reduce:transition-none"
              >
                {headerStatusCopy(t, action.labelKey)}
              </button>
            ))}
            {actions.length > 0 && (
              <DropdownMenu open={isPresent && menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('common.more')}
                    className="flex size-7 min-h-[var(--control-hit-min)] min-w-[var(--control-hit-min)] shrink-0 items-center justify-center rounded-full text-accent outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring xl:hidden"
                  >
                    <MoreHorizontal aria-hidden="true" className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <StyledDropdownMenuContent align="end" sideOffset={6}>
                  {actions.map(action => (
                    <StyledDropdownMenuItem key={action.labelKey} onSelect={() => {
                      action.onClick()
                      if (visibleStatus) dismissStatus(visibleStatus.id)
                    }}>
                      {headerStatusCopy(t, action.labelKey)}
                    </StyledDropdownMenuItem>
                  ))}
                </StyledDropdownMenuContent>
              </DropdownMenu>
            )}
            <button
              type="button"
              aria-label={headerStatusCopy(t, 'headerStatus.dismiss')}
              title={headerStatusCopy(t, 'headerStatus.dismiss')}
              onClick={dismiss}
              className="flex size-7 min-h-[var(--control-hit-min)] min-w-[var(--control-hit-min)] shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
            </>}
          </HeaderStatusPresence>
        )}
      </AnimatePresence>
    </div>
  )
}
