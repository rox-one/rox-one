/**
 * OmniboxHost — mounts the palette, bootstraps registries, wires app.omnibox.
 *
 * Place near DismissibleLayerProvider in App.tsx (inside ActionRegistryProvider
 * so useAction / useActionRegistry are available).
 *
 * Embedded SiYuan/browser page ⌘K is bridged from main via onOmniboxOpen
 * (browser-pane-manager → omnibox:open IPC) because BrowserView holds focus.
 */

import { useEffect, useMemo } from 'react'
import { getDefaultStore, useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useAction, useActionRegistry } from '@/actions'
import {
  featureWorkbenchConationInspectorAtom,
  featureWorkbenchConationShellAtom,
} from '@/atoms/conation-shell'
import { omniboxOpenAtom } from '@/atoms/omnibox'
import {
  featureWorkbenchConationBoardAtom,
  featureWorkbenchConationCanvasAtom,
} from '@/atoms/unified-shell'
import {
  bootstrapOmnibox,
  getOmniboxPlatform,
  setOmniboxActionExecutor,
} from './omnibox-bootstrap'
import { createConationContextKeyProvider } from './omnibox-conation'
import { Omnibox } from './Omnibox'

export function OmniboxHost() {
  const { t } = useTranslation()
  const [open, setOpen] = useAtom(omniboxOpenAtom)
  const { execute, getHotkeyDisplay } = useActionRegistry()

  // Bridge ActionRegistry.execute into command contributions
  useEffect(() => {
    setOmniboxActionExecutor(execute)
  }, [execute])

  // Idempotent registry bootstrap (localized settings labels)
  const platform = useMemo(() => {
    return bootstrapOmnibox({
      t: (key, fallback) => {
        const value = t(key, { defaultValue: fallback })
        return typeof value === 'string' ? value : fallback
      },
    })
  }, [t])

  // Ensure platform exists even if memo skipped
  useEffect(() => {
    void getOmniboxPlatform()
  }, [])

  // Pull live workbench.conation.* flags so Fund/Board commands stay hidden
  // while Appearance toggles are off (defaults false).
  useEffect(() => {
    const store = getDefaultStore()
    return platform.contextKeys.registerProvider(
      createConationContextKeyProvider(() => ({
        shellEnabled: store.get(featureWorkbenchConationShellAtom),
        inspectorEnabled: store.get(featureWorkbenchConationInspectorAtom),
        canvasEnabled: store.get(featureWorkbenchConationCanvasAtom),
        boardEnabled: store.get(featureWorkbenchConationBoardAtom),
      })),
    ).dispose
  }, [platform])

  // ⌘K / mod+k via existing action hotkey system (definitions: app.omnibox)
  useAction('app.omnibox', () => {
    setOpen((v) => !v)
  })

  // Embedded BrowserView focus path: main sends omnibox:open on ⌘K/Ctrl+K
  useEffect(() => {
    const off = window.electronAPI.onOmniboxOpen?.(() => setOpen(true))
    return () => off?.()
  }, [setOpen])

  return (
    <Omnibox
      open={open}
      onOpenChange={setOpen}
      commands={platform.commands}
      resources={platform.resources}
      contextKeys={platform.contextKeys}
      getHotkeyDisplay={getHotkeyDisplay}
    />
  )
}
