// Only unrelated application services/input are isolated. ChatDisplay, TurnCard,
// SkillsListPanel, EntityPanel, ScrollArea and tour geometry are production modules.
import * as React from 'react'
export { useRovingTabIndex } from '../../../../../hooks/keyboard/useRovingTabIndex'
export const useAppShellContext = () => ({ isFocusedPanel: true, workspaces: [], activeWorkspaceId: 'workspace-a' })
export const useActiveWorkspace = () => ({ id: 'workspace-a', name: 'Fixture' })
export const useSession = () => null
export const usePendingPermission = () => null
export const usePendingCredential = () => null
export const useAuthenticatedReactionActor = () => null
export const useFocusZone = () => ({ zoneRef: React.useRef(null), isFocused: false })
export const useBackgroundTasks = () => ({ tasks: [], killTask: () => {} })
export const useContextualSuggestions = () => {}
export const useTheme = () => ({ isDark: false })
export const useNavigation = () => ({ navigate: () => {} })
export const SessionMemoryProposalLane = () => null
export const MemoryProvenanceStrip = () => null
export function ChatInputZone() { return <div style={{ height: 42, flexShrink: 0 }}>Native input service seam</div> }
