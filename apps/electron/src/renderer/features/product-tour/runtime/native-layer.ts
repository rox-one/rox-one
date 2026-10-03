import { useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { useOptionalModalRegistry } from '@/context/ModalContext'
import { useOptionalDismissibleLayerRegistry } from '@/context/DismissibleLayerContext'
import { TourRuntimeContext } from './hooks'

/** Mirrors native Root open state into the existing registries only while learning is enabled. */
export function useTourNativeLayer(props: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }, modal: boolean) {
  const runtime = useContext(TourRuntimeContext)
  const modals = useOptionalModalRegistry()
  const layers = useOptionalDismissibleLayerRegistry()
  const id = useId()
  const [uncontrolled, setUncontrolled] = useState(props.defaultOpen ?? false)
  const open = props.open ?? uncontrolled
  const handler = useRef(props.onOpenChange); handler.current = props.onOpenChange
  const controlled = useRef(props.open !== undefined); controlled.current = props.open !== undefined
  const onOpenChange = useCallback((value: boolean) => {
    if (!controlled.current) setUncontrolled(value)
    handler.current?.(value)
  }, [])
  useEffect(() => {
    if (!runtime?.enabled || !open) return
    const close = () => onOpenChange(false)
    const unregisterModal = modals?.registerModal(`tour-native-${id}`, close, modal ? 100 : 10)
    const unregisterLayer = layers?.registerLayer({ id: `tour-native-${id}`, type: modal ? 'radix-dialog' : 'radix-popover', priority: modal ? 100 : 10, close })
    return () => { unregisterLayer?.(); unregisterModal?.() }
  }, [runtime?.enabled, open, id, modal, modals, layers, onOpenChange])
  return { open, onOpenChange }
}
