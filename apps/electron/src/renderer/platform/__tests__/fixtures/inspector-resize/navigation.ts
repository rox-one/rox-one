export { isConnectionsNavigation } from '../../../../../shared/types'
export const useNavigationState = () => ({ navigator: 'home' })
export const useNavigation = () => ({ updateRightSidebar() {}, navigationState: useNavigationState() })
