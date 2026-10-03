/**
 * Production catalog surfaces inside an isolated, readback-backed test shell.
 * The owning stream harness supplies the existing preload facade and snapshots
 * loaded from a temporary workspace. This component invents no credentials,
 * usage history, provider connection results, or runtime capability activity.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { AppShellProvider, type AppShellContextType } from '../../../apps/electron/src/renderer/context/AppShellContext'
import { ActionRegistryProvider } from '../../../apps/electron/src/renderer/actions'
import { FocusProvider } from '../../../apps/electron/src/renderer/context/FocusContext'
import { EscapeInterruptProvider } from '../../../apps/electron/src/renderer/context/EscapeInterruptContext'
import { ModalProvider } from '../../../apps/electron/src/renderer/context/ModalContext'
import { TooltipProvider } from '../../../packages/ui/src/components/tooltip'
import { NavigationContext } from '../../../apps/electron/src/renderer/contexts/NavigationContext'
import { DEFAULT_NAVIGATION_STATE, type LoadedSource } from '../../../apps/electron/src/shared/types'
import { sourceSelection, skillSelection } from '../../../apps/electron/src/renderer/hooks/useEntitySelection'
import { SourcesListPanel } from '../../../apps/electron/src/renderer/components/app-shell/SourcesListPanel'
import { MultiSelectPanel } from '../../../apps/electron/src/renderer/components/app-shell/MultiSelectPanel'
import SkillsCatalogPage from '../../../apps/electron/src/renderer/pages/SkillsCatalogPage'
import IntegrationsCatalogPage from '../../../apps/electron/src/renderer/pages/IntegrationsCatalogPage'
import { NAVIGATE_EVENT, navigate, routes } from '../../../apps/electron/src/renderer/lib/navigate'

export interface CatalogHarnessProps {
  mode: 'skills' | 'integrations'
  workspaceId: string
  workspaceRootPath: string
  /** Actual loadWorkspaceSources() result from the server's temporary store. */
  sources: LoadedSource[]
  /** Optional production navigator, used to exercise retained source selection. */
  withSourceList?: boolean
}

function CatalogContent({ mode, workspaceId, workspaceRootPath, sources, withSourceList = false }: CatalogHarnessProps) {
  const [sourceSlug, setSourceSlug] = useState<string | null>(null)
  const [lastRoute, setLastRoute] = useState('')
  const skills = skillSelection.useSelection()
  const source = sourceSelection.useSelection()
  const selection = mode === 'skills' ? skills : source
  useEffect(() => {
    const onNavigate = (event: Event) => setLastRoute(String((event as CustomEvent<{ route: string }>).detail.route))
    window.addEventListener(NAVIGATE_EVENT, onNavigate)
    return () => window.removeEventListener(NAVIGATE_EVENT, onNavigate)
  }, [])
  const navigation = useMemo(() => ({
    navigate, isReady: true, navigationState: DEFAULT_NAVIGATION_STATE, navigationRevision: 0,
    canGoBack: false, canGoForward: false, goBack: () => {}, goForward: () => {},
    updateRightSidebar: () => {}, toggleRightSidebar: () => {}, navigateToSource: () => {}, navigateToSession: () => {},
  }), [])
  const shell = useMemo<AppShellContextType>(() => ({
    panelId: 'catalog-test-panel',
    workspaces: [{ id: workspaceId, slug: workspaceId, name: 'Isolated catalog workspace', rootPath: workspaceRootPath, createdAt: 0 }],
    activeWorkspaceId: workspaceId, activeWorkspaceSlug: 'catalog-fixture', llmConnections: [], refreshLlmConnections: async () => {},
    enabledSources: sources, localMcpEnabled: false,
    pendingPermissions: new Map(), pendingCredentials: new Map(), sessionOptions: new Map(),
    getDraft: () => '', getDraftAttachmentRefs: () => [], hydrateDraftAttachments: async () => [],
    onCreateSession: async () => { throw new Error('Catalog fixture cannot create sessions') },
    onSendMessage: () => { throw new Error('Catalog fixture cannot send messages') },
    onRenameSession: () => {}, onFlagSession: () => {}, onUnflagSession: () => {}, onArchiveSession: () => {}, onUnarchiveSession: () => {},
    onMarkSessionRead: () => {}, onMarkSessionUnread: () => {}, onSetActiveViewingSession: () => {}, onSessionStatusChange: () => {}, onDeleteSession: async () => false,
    onOpenFile: () => {}, onOpenUrl: () => {}, onSelectWorkspace: () => {}, onOpenSettings: () => {}, onOpenKeyboardShortcuts: () => {},
    onOpenStoredUserPreferences: () => {}, onReset: () => {}, onSessionOptionsChange: () => {}, onInputChange: () => {}, onAttachmentsChange: () => {},
    isFocusedPanel: true,
  }), [sources, workspaceId, workspaceRootPath])
  return <AppShellProvider value={shell}><NavigationContext.Provider value={navigation}>
    <ActionRegistryProvider><FocusProvider><EscapeInterruptProvider><ModalProvider><TooltipProvider>
      <div data-testid="catalog-harness" className="flex h-screen min-h-0 flex-col bg-background text-foreground">
        <div role="status" className="shrink-0 border-b border-border/50 px-4 py-2 text-xs text-muted-foreground">
          Isolated catalog test · temporary workspace · no provider requests
        </div>
        <div className="flex min-h-0 flex-1" data-testid="catalog-production-surfaces">
          {withSourceList && <aside data-testid="catalog-source-navigator" data-focus-zone="navigator" className="w-72 shrink-0 overflow-auto border-r border-border/50">
            <SourcesListPanel sources={sources} workspaceRootPath={workspaceRootPath} selectedSourceSlug={sourceSlug} localMcpEnabled={false}
              onDeleteSource={() => { throw new Error('Catalog fixture cannot delete sources') }}
              onSourceClick={item => { setSourceSlug(item.config.slug); navigate(routes.view.sources({ sourceSlug: item.config.slug })) }} />
          </aside>}
          <main data-testid="catalog-main-content" className="min-h-0 min-w-0 flex-1">
            {selection.isMultiSelectActive
              ? <MultiSelectPanel count={selection.selectionCount} entityType={mode === 'skills' ? 'skill' : 'source'} />
              : mode === 'skills'
                ? <SkillsCatalogPage workspaceId={workspaceId} workspaceRootPath={workspaceRootPath} />
                : <IntegrationsCatalogPage workspaceId={workspaceId} workspaceRootPath={workspaceRootPath} localMcpEnabled={false} />}
          </main>
        </div>
        <output data-testid="catalog-selection-count" className="sr-only">{selection.selectionCount}</output>
        <output data-testid="catalog-selection-ids" className="sr-only">{JSON.stringify([...selection.state.selectedIds].sort())}</output>
        <output data-testid="catalog-navigation-route" className="sr-only">{lastRoute}</output>
      </div>
    </TooltipProvider></ModalProvider></EscapeInterruptProvider></FocusProvider></ActionRegistryProvider>
  </NavigationContext.Provider></AppShellProvider>
}

export default function CatalogHarness(props: CatalogHarnessProps) {
  return <CatalogContent {...props} />
}
