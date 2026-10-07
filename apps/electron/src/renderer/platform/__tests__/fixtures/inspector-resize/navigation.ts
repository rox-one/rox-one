import type { ReactNode } from 'react'

export { isConnectionsNavigation } from '../../../../../shared/types'

export const useNavigationState = () => ({
  navigator: 'sessions' as const,
  filter: { kind: 'allSessions' as const },
})

export const useNavigation = () => ({
  updateRightSidebar: () => {},
  navigate: () => {},
  navigationState: useNavigationState(),
})

export function NavigationProvider({ children }: { children: ReactNode }) {
  return children
}
