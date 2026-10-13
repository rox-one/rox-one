import { useTourTarget } from '@/features/product-tour/runtime/hooks'
/**
 * AccountMenu — unified Identity Center surface (S-07) for the top bar and
 * compact panel header. Four sections: Profile, Workspaces, Connections,
 * Account & Security. Workspace switching stays here so ProfileStrip is not a
 * second account switcher.
 *
 * Presentation:
 * - Desktop (`compact` false): Radix DropdownMenu.
 * - Compact (`compact` true): vaul Drawer (nested when opened from craft-menu)
 *   so it stacks inside the craft-menu Drawer instead of floating over it
 *   (shared menus are on z-island, above the drawer scrim/modal).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  Cloud,
  CloudOff,
  ExternalLink,
  FolderPlus,
  Shield,
  Trash2,
} from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { fullscreenOverlayOpenAtom } from '@/atoms/overlay'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { navigate, routes } from '@/lib/navigate'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from '@/components/ui/drawer'
import { WorkspaceAvatar } from '@/components/ui/workspace-avatar'
import { WorkspaceCreationScreen, type WorkspaceCreationSuccess } from '@/components/workspace'
import { waitForTransportConnected } from '@/lib/transport-wait'
import { useWorkspaceIcons } from '@/hooks/useWorkspaceIcon'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { isSshBackedWorkspace } from '../../../shared/ssh'
import blackInkAvatar from '@/assets/rox-avatar-ink-black.png'
import whiteInkAvatar from '@/assets/rox-avatar-ink-white.png'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { resolveDisplayName } from './profile-strip-account'
import type { CredentialHealthStatus, IdentityState, Workspace } from '../../../shared/types'

/**
 * Round identity avatar for the Identity Center profile header: the user's own
 * image when present, otherwise the Rox ink mark (black on light surfaces,
 * white on dark ones — a theme-aware pair, never `dark:invert`).
 */
function ProfileAvatar({ src, className }: { src?: string; className?: string }) {
  return (
    <span className={cn('relative block shrink-0 overflow-hidden rounded-full bg-surface-pressed', className)}>
      {src ? (
        <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
      ) : (
        <>
          <img src={blackInkAvatar} alt="" draggable={false} className="h-full w-full object-cover dark:hidden" />
          <img
            src={whiteInkAvatar}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="hidden h-full w-full object-cover dark:block"
          />
        </>
      )}
    </span>
  )
}

export interface AccountMenuProps {
  /**
   * Visual density + presentation mode.
   * compact true → Drawer surface (touch / craft-menu nested drawer).
   * compact false → DropdownMenu (desktop topbar).
   */
  compact?: boolean
  /** Custom logo trigger; creation, reconnection and identity authority stay in this menu. */
  trigger?: React.ReactElement
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelectWorkspace: (workspaceId: string, openInNewWindow?: boolean) => void | Promise<void>
  onWorkspaceCreated?: (workspace: Workspace) => void
  onWorkspaceRemoved?: () => void
  workspaceUnreadMap?: Record<string, boolean>
  /**
   * Creation flow owned by a host that outlives this menu. The compact
   * craft-menu Drawer (PanelHeader) hosts it so it can close itself when the
   * creation screen opens without unmounting the screen with the drawer.
   */
  creationFlow?: WorkspaceCreationFlow
  /** Called whenever the creation/reconnect screen opens (e.g. to close a host Drawer). */
  onOpenCreationScreen?: () => void
}

export interface WorkspaceCreationFlow {
  /** Opens the creation screen, or the reconnect screen for `reconnectWorkspace`. */
  open: (reconnectWorkspace?: Workspace) => void
  /** The fullscreen creation screen; render it outside any surface that may close. */
  screen: React.ReactNode
}

/**
 * Workspace creation / reconnect flow (fullscreen overlay at --z-fullscreen).
 * Lives in a hook so a host that outlives AccountMenu can own it.
 */
export function useWorkspaceCreationFlow({
  activeWorkspaceId,
  onSelectWorkspace,
  onWorkspaceCreated,
}: Pick<AccountMenuProps, 'activeWorkspaceId' | 'onSelectWorkspace' | 'onWorkspaceCreated'>): WorkspaceCreationFlow {
  const { t } = useTranslation()
  const [showCreationScreen, setShowCreationScreen] = React.useState(false)
  const [reconnectTarget, setReconnectTarget] = React.useState<Workspace | null>(null)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)
  const showingRef = React.useRef(false)
  showingRef.current = showCreationScreen

  const open = React.useCallback((reconnectWorkspace?: Workspace) => {
    setReconnectTarget(reconnectWorkspace ?? null)
    setShowCreationScreen(true)
    setFullscreenOverlayOpen(true)
  }, [setFullscreenOverlayOpen])

  const handleWorkspaceCreated = ({ workspace, activation }: WorkspaceCreationSuccess) => {
    setShowCreationScreen(false)
    setFullscreenOverlayOpen(false)
    toast.success(t('toast.createdWorkspace', { name: workspace.name }))
    onWorkspaceCreated?.(workspace)
    void onSelectWorkspace(activation?.activeWorkspaceId ?? workspace.id)
  }

  const handleCloseCreationScreen = React.useCallback(() => {
    setShowCreationScreen(false)
    setReconnectTarget(null)
    setFullscreenOverlayOpen(false)
  }, [setFullscreenOverlayOpen])

  const handleReconnectWorkspace = React.useCallback(
    async (
      workspaceId: string,
      remoteServer: { url: string; token: string; remoteWorkspaceId: string; sshHostId?: string; tlsTrust?: import('../../../shared/types').RemoteTlsTrust },
    ) => {
      await window.electronAPI.updateWorkspaceRemoteServer(workspaceId, remoteServer)
      if (workspaceId === activeWorkspaceId) {
        await window.electronAPI.reconnectTransport()
        await waitForTransportConnected(window.electronAPI)
      } else {
        await Promise.resolve(onSelectWorkspace(workspaceId))
        await waitForTransportConnected(window.electronAPI)
      }
      handleCloseCreationScreen()
      toast.success(t('toast.workspaceReconnected'))
    },
    [activeWorkspaceId, handleCloseCreationScreen, onSelectWorkspace, t],
  )

  // Unmounting the owner while the screen is open must not leave the
  // fullscreen-overlay flag stuck on.
  React.useEffect(() => () => {
    if (showingRef.current) setFullscreenOverlayOpen(false)
  }, [setFullscreenOverlayOpen])

  const screen = (
    <AnimatePresence>
      {showCreationScreen && (
        <WorkspaceCreationScreen
          onWorkspaceCreated={handleWorkspaceCreated}
          onClose={handleCloseCreationScreen}
          reconnectWorkspace={reconnectTarget ?? undefined}
          onReconnectWorkspace={handleReconnectWorkspace}
        />
      )}
    </AnimatePresence>
  )

  return { open, screen }
}

function sectionLabel(text: string) {
  return (
    <div className="px-2 pt-1.5 pb-1 text-xs font-semibold uppercase caps-label text-muted-foreground/80">
      {text}
    </div>
  )
}

function drawerSectionLabel(text: string) {
  return (
    <div className="px-3 pt-3 pb-1 text-xs font-semibold uppercase caps-label text-muted-foreground/80">
      {text}
    </div>
  )
}

const drawerRowClass =
  'flex w-full items-center gap-3 px-3 py-3 rounded-[var(--radius-control)] text-left text-sm transition-colors hover:bg-foreground/5 outline-none disabled:opacity-50 disabled:pointer-events-none'

export function AccountMenu({
  compact = false,
  trigger,
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onWorkspaceCreated,
  onWorkspaceRemoved,
  workspaceUnreadMap,
  creationFlow: hostedCreationFlow,
  onOpenCreationScreen,
}: AccountMenuProps) {
  const { t } = useTranslation()
  // The shell already tracks the signed-in Rox cloud account; reuse it so the
  // menu shows the same merged name as the profile strip.
  const roxAccount = useOptionalAppShellContext()?.roxAccount ?? null
  const tourWorkspaceTarget = useTourTarget('workspace.switcher', { scope: 'shell', workspaceId: activeWorkspaceId ?? undefined, variant: compact ? 'compact' : 'regular' })
  const [open, setOpen] = React.useState(false)
  const ownCreationFlow = useWorkspaceCreationFlow({ activeWorkspaceId, onSelectWorkspace, onWorkspaceCreated })
  const creationFlow = hostedCreationFlow ?? ownCreationFlow
  const selectedWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const workspaceIconMap = useWorkspaceIcons(workspaces)
  const connectionState = useTransportConnectionState()
  const isRemote = connectionState?.mode === 'remote'

  const [remoteHealthMap, setRemoteHealthMap] = React.useState<Map<string, 'ok' | 'error' | 'checking'>>(new Map())
  const healthCheckAbort = React.useRef<AbortController | null>(null)
  const [identity, setIdentity] = React.useState<IdentityState | null>(null)
  const [credentialHealth, setCredentialHealth] = React.useState<CredentialHealthStatus | null>(null)

  const loadIdentity = React.useCallback(async () => {
    try {
      const next = await window.electronAPI.identityGetState(
        activeWorkspaceId ? { workspaceId: activeWorkspaceId } : undefined,
      )
      setIdentity(next)
    } catch {
      // Menu still works for workspace switching if identity is unavailable.
    }
  }, [activeWorkspaceId])

  const loadCredentialHealth = React.useCallback(async () => {
    try {
      setCredentialHealth(await window.electronAPI.getCredentialHealth())
    } catch {
      setCredentialHealth(null)
    }
  }, [])

  React.useEffect(() => {
    void loadIdentity()
    const unsub = window.electronAPI.onIdentityChanged?.(() => {
      void loadIdentity()
    })
    return () => {
      unsub?.()
    }
  }, [loadIdentity])


  const checkRemoteHealth = React.useCallback(() => {
    healthCheckAbort.current?.abort()
    const abort = new AbortController()
    healthCheckAbort.current = abort

    const remoteWorkspaces = workspaces.filter(
      (w) => w.remoteServer && !isSshBackedWorkspace(w) && w.id !== activeWorkspaceId,
    )
    if (remoteWorkspaces.length === 0) return

    setRemoteHealthMap((prev) => {
      const next = new Map(prev)
      for (const ws of remoteWorkspaces) next.set(ws.id, 'checking')
      return next
    })

    for (const ws of remoteWorkspaces) {
      window.electronAPI
        .testRemoteConnection(ws.remoteServer!.url, ws.remoteServer!.token)
        .then((result) => {
          if (abort.signal.aborted) return
          setRemoteHealthMap((prev) => new Map(prev).set(ws.id, result.ok ? 'ok' : 'error'))
        })
        .catch(() => {
          if (abort.signal.aborted) return
          setRemoteHealthMap((prev) => new Map(prev).set(ws.id, 'error'))
        })
    }
  }, [workspaces, activeWorkspaceId])

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      setOpen(next)
      if (next) {
        checkRemoteHealth()
        void loadIdentity()
        void loadCredentialHealth()
      }
    },
    [checkRemoteHealth, loadCredentialHealth, loadIdentity],
  )

  const getDisconnectTooltip = (workspaceId: string): string => {
    if (workspaceId === activeWorkspaceId && connectionState?.lastError) {
      const { kind } = connectionState.lastError
      if (kind === 'auth') return t('toast.authenticationFailed')
      if (kind === 'timeout' || kind === 'network') return t('toast.serverUnreachable')
    }
    return t('toast.disconnected')
  }

  const isRemoteDisconnected = (workspaceId: string) => {
    const workspace = workspaces.find((w) => w.id === workspaceId)
    if (isSshBackedWorkspace(workspace)) {
      if (workspaceId !== activeWorkspaceId || !isRemote || !connectionState) return false
      const { status, lastError } = connectionState
      const terminal = status === 'failed' || status === 'disconnected'
      return terminal && lastError?.kind === 'auth'
    }
    if (workspaceId === activeWorkspaceId) {
      if (!isRemote || !connectionState) return false
      const { status } = connectionState
      return status !== 'connected' && status !== 'connecting' && status !== 'idle'
    }
    return remoteHealthMap.get(workspaceId) === 'error'
  }

  const hasUnreadInOtherWorkspaces = React.useMemo(() => {
    if (!activeWorkspaceId || !workspaceUnreadMap) return false
    return workspaces.some((workspace) => workspace.id !== activeWorkspaceId && workspaceUnreadMap[workspace.id])
  }, [workspaces, activeWorkspaceId, workspaceUnreadMap])

  const closeMenu = React.useCallback(() => setOpen(false), [])

  const openAccountPage = React.useCallback(() => {
    closeMenu()
    navigate(routes.view.settings('account'))
  }, [closeMenu])

  const openAccountsSettings = React.useCallback(() => {
    closeMenu()
    navigate(routes.view.settings('accounts'))
  }, [closeMenu])

  const handleResetAppData = React.useCallback(async () => {
    try {
      const confirmed = await window.electronAPI.showLogoutConfirmation()
      if (!confirmed) return
      closeMenu()
      await window.electronAPI.logout()
      toast.success(t('accountMenu.resetDone'))
    } catch {
      toast.error(t('accountMenu.resetFailed', { message: t('common.failed') }))
    }
  }, [closeMenu, t])

  const profile = identity?.profile
  // Same merge as the profile strip: the name the user signed in with wins.
  const displayName = resolveDisplayName(roxAccount, profile?.displayName, t('profile.defaultName'))
  const connections = identity?.connections ?? []
  const connectedCount = connections.filter(
    (connection) => connection.status === 'connected' || connection.status === 'syncing',
  ).length
  const expiredCount = connections.filter((connection) => connection.status === 'expired').length
  const errorCount = connections.filter((connection) => connection.status === 'error').length
  const profileModeLabel = t('accountMenu.profileMode', {
    mode: profile?.mode ?? 'local',
  })
  const connectionsSummary = t('accountMenu.connectionsSummary', {
    connected: connectedCount,
    expired: expiredCount,
    errors: errorCount,
  })
  const siyuanCloud = connections.find((connection) => connection.provider === 'siyuan-cloud')
  const license = identity?.entitlements.find(
    (item) => item.provider === 'siyuan-cloud' && item.product === 'cloud-sync',
  )
  const healthLabel = credentialHealth
    ? credentialHealth.healthy
      ? t('accountMenu.healthOk')
      : t('accountMenu.healthIssues', { count: credentialHealth.issues?.length ?? 0 })
    : t('accountMenu.healthUnknown')

  /** Opens creation (or reconnect) and lets a host surface (craft-menu Drawer) close. */
  const openCreationScreen = (reconnectWorkspace?: Workspace) => {
    creationFlow.open(reconnectWorkspace)
    onOpenCreationScreen?.()
  }

  const handleNewWorkspace = () => {
    openCreationScreen()
    closeMenu()
  }

  const handleRemoveWorkspace = React.useCallback(
    async (workspace: Workspace) => {
      if (workspace.id === activeWorkspaceId) {
        toast.error(t('toast.cannotRemoveActiveWorkspace'))
        return
      }
      const confirmed = await window.electronAPI.showDeleteWorkspaceConfirmation(workspace.name)
      if (!confirmed) return
      const removed = await window.electronAPI.removeWorkspace(workspace.id)
      if (removed) {
        toast.success(t('toast.removedWorkspace', { name: workspace.name }))
        onWorkspaceRemoved?.()
      }
    },
    [activeWorkspaceId, onWorkspaceRemoved, t],
  )

  const selectWorkspace = (workspace: Workspace, openInNewWindow?: boolean) => {
    const disconnected = isRemoteDisconnected(workspace.id)
    if (disconnected && workspace.remoteServer) {
      openCreationScreen(workspace)
      closeMenu()
      return
    }
    if (disconnected) return
    void onSelectWorkspace(workspace.id, openInNewWindow)
    closeMenu()
  }


  const triggerLabel = selectedWorkspace?.name || t('workspace.selectWorkspace')

  const triggerButton = (
    <button
      type="button"
      ref={tourWorkspaceTarget}
      data-account-menu={compact ? 'compact' : 'topbar'}
      className={cn(
        'header-icon-btn titlebar-no-drag ml-1 flex min-w-0 items-center justify-start gap-0.5 h-[30px] rounded-[var(--radius-control)] border border-border/50 bg-[var(--surface-elevated)] text-base text-foreground/70 hover:bg-foreground/5 hover:text-foreground transition-colors cursor-pointer data-[state=open]:bg-foreground/5 data-[state=open]:text-foreground',
        compact ? 'flex-1 px-2' : 'flex-1 px-3',
      )}
      aria-label={t('workspace.selectWorkspace')}
    >
      <WorkspaceAvatar
        workspaceId={selectedWorkspace?.id}
        workspaceName={selectedWorkspace?.name || triggerLabel}
        src={selectedWorkspace ? workspaceIconMap.get(selectedWorkspace.id) : undefined}
        className="h-4 w-4 mr-1.5 rounded-full ring-1 ring-border/50"
        fallbackClassName="rounded-full"
      />
      <span className="truncate min-w-0 flex-1 text-left" title={triggerLabel}>{triggerLabel}</span>
      {selectedWorkspace?.remoteServer &&
        (isRemoteDisconnected(selectedWorkspace.id) ? (
          <CloudOff
            className="h-3 w-3 text-destructive shrink-0"
            aria-label={t('dashboard.syncOffline')}
          />
        ) : (
          <Cloud
            className="h-3 w-3 opacity-60 shrink-0"
            aria-label={t('dashboard.syncConnected')}
          />
        ))}
      <ChevronDown data-slot="chevron" className="h-3 w-3 opacity-60 shrink-0" />
      {hasUnreadInOtherWorkspaces && <span className="h-2 w-2 rounded-full bg-accent shrink-0" />}
    </button>
  )

  // A hosted flow renders its screen in the host; only the own flow renders here.
  const creationScreen = hostedCreationFlow ? null : ownCreationFlow.screen

  // ---------------------------------------------------------------------------
  // Compact: Drawer surface (nested under craft-menu Drawer when applicable)
  // ---------------------------------------------------------------------------
  if (compact) {
    return (
      <>
        {creationScreen}

        <Drawer nested open={open} onOpenChange={handleOpenChange}>
          <DrawerTrigger asChild>{trigger ?? triggerButton}</DrawerTrigger>

          <DrawerContent className="max-h-[85vh]">
            <DrawerHeader>
              <DrawerTitle>{t('workspace.selectWorkspace')}</DrawerTitle>
            </DrawerHeader>

            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-6 flex flex-col gap-0.5">
              {drawerSectionLabel(t('accountMenu.section.profile'))}
              <div className="flex items-center gap-3 px-3 py-3">
                <ProfileAvatar src={profile?.avatar} className="h-7 w-7 shadow-minimal" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" title={displayName}>
                    {displayName}
                  </div>
                  <div className="text-xs text-foreground/50">
                    {profileModeLabel}
                  </div>
                </div>
              </div>
              <DrawerClose asChild>
                <button type="button" className={drawerRowClass} onClick={openAccountPage}>
                  <span className="font-medium">{t('accountMenu.editProfile')}</span>
                </button>
              </DrawerClose>

              {drawerSectionLabel(t('accountMenu.section.workspaces'))}
              {workspaces.map((workspace) => {
                const disconnected = isRemoteDisconnected(workspace.id)
                const isActive = activeWorkspaceId === workspace.id
                return (
                  <div
                    key={workspace.id}
                    className={cn(
                      'flex items-center gap-1 rounded-[var(--radius-control)] transition-colors',
                      isActive ? 'bg-foreground/5' : 'hover:bg-foreground/5',
                      disconnected && 'opacity-60',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => selectWorkspace(workspace)}
                      className="flex-1 min-w-0 flex items-center gap-3 px-3 py-3 text-left outline-none"
                    >
                      <WorkspaceAvatar
                        workspaceId={workspace.id}
                        workspaceName={workspace.name}
                        src={workspaceIconMap.get(workspace.id)}
                        className="h-7 w-7 rounded-full ring-1 ring-border/50 shrink-0"
                        fallbackClassName="rounded-full text-sm"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate text-sm font-medium" title={workspace.name}>{workspace.name}</span>
                          {workspaceUnreadMap?.[workspace.id] && (
                            <span className="h-2 w-2 rounded-full bg-accent shrink-0" />
                          )}
                        </div>
                        {workspace.remoteServer && (
                          <div className="flex items-center gap-1 text-xs text-foreground/50 mt-0.5">
                            {disconnected ? (
                              <>
                                <CloudOff className="h-3 w-3 text-destructive shrink-0" />
                                <span title={getDisconnectTooltip(workspace.id)}>
                                  {t('toast.disconnected')}
                                </span>
                              </>
                            ) : (
                              <>
                                <Cloud className="h-3 w-3 shrink-0" />
                                <span className="truncate">
                                  {workspace.remoteServer.sshHostId
                                    ? t('ssh.workspaceSubtitle', {
                                        host: workspace.remoteServer.sshHostId,
                                      })
                                    : workspace.remoteServer.url}
                                </span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => void handleRemoveWorkspace(workspace)}
                        className="shrink-0 h-9 w-9 rounded-[var(--radius-control)] flex items-center justify-center text-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                        aria-label={t('workspace.removeWorkspace')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                    {!isActive && !disconnected && (
                      <button
                        type="button"
                        onClick={() => selectWorkspace(workspace, true)}
                        className="shrink-0 h-9 w-9 rounded-[var(--radius-control)] flex items-center justify-center text-foreground/50 hover:text-foreground hover:bg-foreground/10 transition-colors mr-1"
                        aria-label={t('sidebarMenu.openInNewWindow')}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </button>
                    )}
                    {isActive && <Check className="h-4 w-4 shrink-0 text-foreground/60 mr-3" />}
                  </div>
                )
              })}
              <DrawerClose asChild>
                <button type="button" className={drawerRowClass} onClick={handleNewWorkspace}>
                  <div className="h-7 w-7 rounded-full bg-foreground/5 flex items-center justify-center shrink-0">
                    <FolderPlus className="h-4 w-4 text-foreground/60" />
                  </div>
                  <span className="font-medium">{t('workspace.addWorkspace')}</span>
                </button>
              </DrawerClose>

              {drawerSectionLabel(t('accountMenu.section.connections'))}
              <div className="px-3 py-2 text-sm text-foreground/70">
                {connectionsSummary}
              </div>
              {siyuanCloud && (
                <div className="px-3 py-2 text-sm text-foreground/70">
                  {t('accountMenu.knowledgeCloudStatus', {
                    status: t(`settings.accounts.status.${siyuanCloud.status}`),
                  })}
                </div>
              )}
              {license && (
                <div className="px-3 py-2 text-sm text-foreground/70">
                  {t('accountMenu.licenseStatus', {
                    status: t(`settings.accounts.entitlement.${license.status}`, {
                      product: license.product,
                    }),
                  })}
                </div>
              )}
              <DrawerClose asChild>
                <button type="button" className={drawerRowClass} onClick={openAccountsSettings}>
                  <span className="font-medium">{t('accountMenu.manageConnections')}</span>
                </button>
              </DrawerClose>

              {drawerSectionLabel(t('accountMenu.section.security'))}
              <DrawerClose asChild>
                <button type="button" className={drawerRowClass} onClick={openAccountsSettings}>
                  <Shield className="h-4 w-4 text-foreground/60 shrink-0" />
                  <span className="font-medium">{t('accountMenu.openAccountsSettings')}</span>
                </button>
              </DrawerClose>
              <div className="px-3 py-2 text-sm text-foreground/70">
                {t('accountMenu.credentialHealth', { status: healthLabel })}
              </div>
              <DrawerClose asChild>
                <button
                  type="button"
                  className={drawerRowClass}
                  onClick={() => void handleResetAppData()}
                >
                  <span className="font-medium text-destructive">{t('accountMenu.resetAppData')}</span>
                </button>
              </DrawerClose>
            </div>
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  // ---------------------------------------------------------------------------
  // Desktop: DropdownMenu
  // ---------------------------------------------------------------------------
  return (
    <>
      {creationScreen}

      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>{trigger ?? triggerButton}</DropdownMenuTrigger>

        <StyledDropdownMenuContent align="start" sideOffset={6} minWidth="min-w-72">
          {sectionLabel(t('accountMenu.section.profile'))}
          <div className="flex items-center gap-3 px-2 py-1.5">
            <ProfileAvatar src={profile?.avatar} className="h-8 w-8 shadow-minimal" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium" title={displayName}>
                {displayName}
              </div>
              <div className="text-xs text-muted-foreground">{profileModeLabel}</div>
            </div>
          </div>
          <StyledDropdownMenuItem onClick={openAccountPage} className="font-sans">
            {t('accountMenu.editProfile')}
          </StyledDropdownMenuItem>
          <StyledDropdownMenuSeparator />
          {sectionLabel(t('accountMenu.section.workspaces'))}
          {workspaces.map((workspace) => {
            const disconnected = isRemoteDisconnected(workspace.id)
            return (
              <StyledDropdownMenuItem
                key={workspace.id}
                onClick={(e) => {
                  if (disconnected && workspace.remoteServer) {
                    openCreationScreen(workspace)
                    return
                  }
                  if (disconnected) return
                  const openInNewWindow = e.metaKey || e.ctrlKey
                  void onSelectWorkspace(workspace.id, openInNewWindow)
                }}
                className={cn(
                  'justify-between group font-sans',
                  activeWorkspaceId === workspace.id && 'bg-foreground/10',
                  disconnected && 'opacity-60',
                )}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <WorkspaceAvatar
                    workspaceId={workspace.id}
                    workspaceName={workspace.name}
                    src={workspaceIconMap.get(workspace.id)}
                    className="h-5 w-5 rounded-full ring-1 ring-border/50"
                    fallbackClassName="rounded-full text-xs"
                  />
                  <span className="truncate" title={workspace.name}>{workspace.name}</span>
                  {workspace.remoteServer &&
                    (disconnected ? (
                      <span title={getDisconnectTooltip(workspace.id)} className="shrink-0">
                        <CloudOff className="h-3.5 w-3.5 text-destructive" />
                      </span>
                    ) : (
                      <Cloud className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ))}
                  {workspaceUnreadMap?.[workspace.id] && (
                    <span className="h-2 w-2 rounded-full bg-accent shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {activeWorkspaceId !== workspace.id && (
                    <button
                      data-touch-reveal="true"
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleRemoveWorkspace(workspace)
                      }}
                      title={t('workspace.removeWorkspace')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {activeWorkspaceId !== workspace.id && !disconnected && (
                    <button
                      data-touch-reveal="true"
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-foreground/10 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation()
                        void onSelectWorkspace(workspace.id, true)
                      }}
                      title={t('sidebarMenu.openInNewWindow')}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {activeWorkspaceId === workspace.id && <Check className="h-3.5 w-3.5" />}
                </div>
              </StyledDropdownMenuItem>
            )
          })}
          <StyledDropdownMenuItem onClick={handleNewWorkspace} className="font-sans">
            <FolderPlus className="h-4 w-4" />
            {t('workspace.addWorkspace')}
          </StyledDropdownMenuItem>
          <StyledDropdownMenuSeparator />
          {sectionLabel(t('accountMenu.section.connections'))}
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {connectionsSummary}
          </div>
          {siyuanCloud && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {t('accountMenu.knowledgeCloudStatus', {
                status: t(`settings.accounts.status.${siyuanCloud.status}`),
              })}
            </div>
          )}
          {license && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {t('accountMenu.licenseStatus', {
                status: t(`settings.accounts.entitlement.${license.status}`, {
                  product: license.product,
                }),
              })}
            </div>
          )}
          <StyledDropdownMenuItem onClick={openAccountsSettings} className="font-sans">
            {t('accountMenu.manageConnections')}
          </StyledDropdownMenuItem>
          <StyledDropdownMenuSeparator />
          {sectionLabel(t('accountMenu.section.security'))}
          <StyledDropdownMenuItem onClick={openAccountsSettings} className="font-sans">
            <Shield className="h-4 w-4" />
            {t('accountMenu.openAccountsSettings')}
          </StyledDropdownMenuItem>
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {t('accountMenu.credentialHealth', { status: healthLabel })}
          </div>
          <StyledDropdownMenuItem
            className="font-sans text-destructive focus:text-destructive"
            onClick={() => void handleResetAppData()}
          >
            {t('accountMenu.resetAppData')}
          </StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
