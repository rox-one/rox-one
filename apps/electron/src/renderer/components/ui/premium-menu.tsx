import { PremiumMenu as NativePremiumMenu, type PremiumMenuProps } from '@rox/ui'
import { useTourNativeLayer } from '@/features/product-tour/runtime/native-layer'

/** The native portal keeps its own focus/selection while the existing close registries own the handoff. */
export function PremiumMenu(props: PremiumMenuProps) {
  const state = useTourNativeLayer(props, false)
  return <NativePremiumMenu {...props} {...state} />
}

export type { PremiumMenuProps }
