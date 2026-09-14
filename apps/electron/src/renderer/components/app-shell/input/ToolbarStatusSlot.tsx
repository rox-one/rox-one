/**
 * ToolbarStatusSlot
 *
 * Priority-based status row above the composer controls.
 * Shows contextual status indicators — escape-to-interrupt hint (highest priority),
 * browser session state, or future status types.
 *
 * Uses document flow so a status never covers model, dictation, or stop actions.
 *
 * Browser state is consumed directly from Jotai atoms (same pattern as BrowserTabStrip)
 * to avoid threading props through 4 component levels.
 */

import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { Globe } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { useTranslation, Trans } from 'react-i18next'
import { Spinner } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { Kbd } from '@/components/ui/kbd'
import { getHostname } from '@/components/browser/utils'
import { browserInstancesAtom, filterInstancesForWorkspace } from '@/atoms/browser-pane'
import { useAppShellContext } from '@/context/AppShellContext'
import type { BrowserInstanceInfo } from '../../../../shared/types'
import { computeTokensPerSecond, formatTokensPerSecond, type TurnPhase } from './turn-progress'

interface ToolbarStatusSlotProps {
  /** Whether the escape interrupt overlay should be visible (highest priority) */
  showEscapeOverlay: boolean
  /** Session ID to find the bound browser instance */
  sessionId?: string
  /** Live turn phase / tok/s while the agent is processing (below escape) */
  turnProgress?: {
    phase: TurnPhase
    outputTokens: number
    startedAt?: number
  } | null
}

export function ToolbarStatusSlot({
  showEscapeOverlay,
  sessionId,
  turnProgress = null,
}: ToolbarStatusSlotProps) {
  const { t } = useTranslation()
  const prefersReducedMotion = useReducedMotion()
  // Filter to the active workspace so a session here doesn't surface a
  // browser-status banner for an agent running in a different workspace.
  // Accept both the local workspace id (manual tabs) and the remote-mirror
  // workspace id (tabs stamped by the remote agent over the WS bridge).
  const { activeWorkspaceId, workspaces, isFocusedPanel = true } = useAppShellContext()
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const remoteWorkspaceId = activeWorkspace?.remoteServer?.remoteWorkspaceId ?? null
  const allInstances = useAtomValue(browserInstancesAtom)
  const browserInstances = React.useMemo(
    () => filterInstancesForWorkspace(allInstances, activeWorkspaceId, remoteWorkspaceId),
    [allInstances, activeWorkspaceId, remoteWorkspaceId],
  )

  // Find the visible browser instance bound to this session with active agent control.
  // Hidden instances are intentionally excluded so the status slot mirrors actual visibility.
  const browserInstance = React.useMemo(() => {
    if (!sessionId) return null

    const visibleCandidates = browserInstances.filter(
      i => i.boundSessionId === sessionId && i.agentControlActive && i.isVisible
    )
    if (visibleCandidates.length === 0) return null

    return visibleCandidates.at(-1) ?? null
  }, [browserInstances, sessionId])

  const [now, setNow] = React.useState(() => Date.now())
  const progressActive = turnProgress !== null && isFocusedPanel
  React.useEffect(() => {
    if (!progressActive) return
    let interval: ReturnType<typeof setInterval> | undefined
    const updateVisibility = () => {
      clearInterval(interval)
      if (document.visibilityState === 'hidden') return
      setNow(Date.now())
      interval = setInterval(() => setNow(Date.now()), 500)
    }
    updateVisibility()
    document.addEventListener('visibilitychange', updateVisibility)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', updateVisibility)
    }
  }, [progressActive])

  const tokensPerSecond = turnProgress && progressActive
    ? computeTokensPerSecond(
        turnProgress.outputTokens,
        Math.max(0, now - (turnProgress.startedAt ?? now)),
      )
    : null

  // Priority resolution: escape interrupt > turn progress > browser status
  const showTurnProgress = !showEscapeOverlay && turnProgress !== null
  const showBrowser = !showEscapeOverlay && !showTurnProgress && browserInstance !== null

  const handleBrowserClick = React.useCallback((instanceId: string) => {
    window.electronAPI?.browserPane?.focus?.(instanceId)
  }, [])

  return (
    <AnimatePresence mode="wait" initial={false}>
      {showEscapeOverlay && (
        <motion.div
          key="escape"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
          className={cn(
            "relative flex min-h-7 items-center justify-center border-b border-border/50 px-3 py-1",
          )}
          style={{
            '--shadow-color': 'var(--info-rgb)',
            backgroundColor: 'color-mix(in srgb, var(--info) 10%, var(--background))',
            color: 'color-mix(in oklab, var(--info) 30%, var(--foreground))',
          } as React.CSSProperties}
        >
          <span className="text-xs font-medium flex flex-wrap items-center justify-center gap-1.5" role="status">
            <Trans
              i18nKey="toolbar.escapeToInterrupt"
              components={{ kbd: <Kbd className="text-inherit bg-current/10" /> }}
            />
          </span>
        </motion.div>
      )}

      {showTurnProgress && turnProgress && (
        <motion.div
          key="turn-progress"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
          className={cn(
            "relative flex min-h-7 items-center justify-center border-b border-border/50 px-3 py-1",
          )}
          data-testid="chat-turn-progress"
        >
          <span className="text-xs text-muted-foreground flex flex-wrap items-center justify-center gap-1.5">
            {t(`chat.turnPhase.${turnProgress.phase}`)}
            {tokensPerSecond != null && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t('chat.tokensPerSecond', { rate: formatTokensPerSecond(tokensPerSecond) })}
                </span>
              </>
            )}
          </span>
        </motion.div>
      )}

      {showBrowser && browserInstance && (
        <BrowserStatusBar
          key="browser"
          instance={browserInstance}
          prefersReducedMotion={!!prefersReducedMotion}
          onClick={() => handleBrowserClick(browserInstance.id)}
        />
      )}
    </AnimatePresence>
  )
}

/**
 * Browser status bar — shows when the agent is actively using a browser window.
 * Shares the composer material instead of importing an unrelated site's palette.
 */
function BrowserStatusBar({
  instance,
  onClick,
  prefersReducedMotion,
}: {
  instance: BrowserInstanceInfo
  onClick: () => void
  prefersReducedMotion: boolean
}) {
  const { t } = useTranslation()
  const hostname = getHostname(instance.url)

  const [faviconFailed, setFaviconFailed] = React.useState(false)

  React.useEffect(() => {
    setFaviconFailed(false)
  }, [instance.favicon])

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
      className={cn(
        "relative flex min-h-7 w-full items-center justify-center gap-2 border-b border-border/50 px-3 py-1",
        "bg-foreground/2 text-muted-foreground hover:bg-foreground/5 cursor-pointer",
        "transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
      )}
      onClick={onClick}
    >
      <span className="shrink-0 flex h-3.5 w-3.5 items-center justify-center">
        {instance.isLoading ? (
          <Spinner className="text-[10px] leading-none" />
        ) : instance.favicon && !faviconFailed ? (
            <img
              src={instance.favicon}
              alt=""
              className="h-3.5 w-3.5 rounded-sm block"
              onError={() => setFaviconFailed(true)}
            />
        ) : (
          <Globe className="h-3.5 w-3.5" />
        )}
      </span>
      <span className="min-w-0 truncate text-xs">
        {t('chat.usingConnection', { name: hostname })}
      </span>
    </motion.button>
  )
}
