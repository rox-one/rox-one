// Boundary doubles only: no application boot, Electron transport, or user data.
import React, { createContext, useContext } from 'react'
import { atom } from 'jotai'
import { parseRouteToNavigationState } from '../../../apps/electron/src/shared/route-parser'
export {
  isSessionsNavigation, isSourcesNavigation, isSettingsNavigation, isSkillsNavigation,
  isMemoryNavigation, isTasksNavigation, isMeetingsNavigation, isInboxNavigation,
  isFeedNavigation, isNotesNavigation, isAutomationsNavigation, isProjectsNavigation,
  isPagesNavigation, isBrowserNavigation, isKnowledgeNavigation, isDiffNavigation,
  isExtensionNavigation, isConnectionsNavigation, isHomeNavigation, isCloudRunNavigation,
  isTerminalNavigation,
} from '../../../apps/electron/src/shared/types'
const context = createContext<any>({ workspaces: [], activeWorkspaceId: 'fixture', sessionStatuses: [], projects: [], loadedProjects: [], labels: [] })
export const AppShellProvider = context.Provider
export const useAppShellContext = () => useContext(context)
export const useOptionalAppShellContext = () => useContext(context)
export const useActiveWorkspace = () => ({ id: 'fixture' })
export const useAction = () => {}
export const useNavigationState = () => parseRouteToNavigationState('skills')!
export const useNavigation = () => ({ navigate: () => {} })
export const NavigationContext = createContext<any>(null)
export const knowledgeActiveViewIdAtom = atom<string | null>(null)
export const knowledgeHomeViewAtom = atom('home')
export const recordRecentSetting = () => {}
export const MemoryScreen = () => null
export const ProjectsHomeInMain = () => null
export const CollectionBulkBar = () => null
export const HomeFrontPage = () => null
export const getSettingsPageComponent = () => () => null
export const SettingsOverviewPage = () => null
export const PageView = () => null
export const SessionHeatmapHost = () => null
export default function UnusedSurface() { return null }
export const EditPopover = () => null
export const getEditConfig = () => ({})
export const SkillAvatar = () => <span aria-hidden="true">ϟ</span>
export const SkillMenu = () => null
export const SendResourceToWorkspaceDialog = () => null
export function PanelHeader({ title }: any) { return <header className="p-4 border-b">{title}</header> }
export function MainContentPanel({ navStateOverride }: any) {
  const shell = useAppShellContext()
  return <div className="h-full flex flex-col p-4 gap-4">
    <header className="flex justify-between"><span>{navStateOverride?.navigator}</span>{shell.rightSidebarButton}</header>
    <div className="flex-1">Controlled content; actual PanelSlot geometry and close action.</div>
    <footer className="flex justify-between"><button data-testid="model">Model</button><button data-testid="send">Send</button></footer>
  </div>
}
