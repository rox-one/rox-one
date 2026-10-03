/**
 * Drawer — re-export from @rox/ui.
 *
 * The implementation moved to packages/ui so it can be used by shared chat
 * components (e.g. the compact Accept-Plan drawer in TurnCard). Existing
 * `@/components/ui/drawer` imports keep working via this shim.
 */
import type { ComponentProps } from 'react'
import { Drawer as SharedDrawer } from '@rox/ui/ui/drawer'
import { useTourNativeLayer } from '@/features/product-tour/runtime/native-layer'
export function Drawer(props: ComponentProps<typeof SharedDrawer>) {
  const state = useTourNativeLayer(props, true)
  return <SharedDrawer {...props} {...state} />
}
export {
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
} from '@rox/ui/ui/drawer'
