/**
 * PublishSessionDialogHost — AppShell-level host so the publish dialog survives
 * context-menu / dropdown close (same pattern as MessagingDialogHost).
 *
 * Boot-closure split: AppShell statically imported this module, so
 * `PublishSessionDialog` → `@/components/markdown` → `rehype-raw` dragged
 * parse5 + hast-util (~361 KB of sources across 18 modules) plus react-markdown
 * and remark-gfm/math into index.html's preloaded startup closure. The dialog is
 * opened only from SessionMenu / CompactSessionMenu / SessionPublishedChip
 * (`publishSessionDialogAtom`), and a closed Radix Dialog renders nothing — so
 * the host stays in boot (it is 765 B and owns the atom subscription) and the
 * dialog itself loads on first open.
 */
import * as React from 'react'
import { useAtom } from 'jotai'
import { publishSessionDialogAtom } from '@/atoms/knowledge-publish'

// Same lazy idiom as the neighbouring MessagingDialogHost / OnboardingDialog.
const PublishSessionDialog = React.lazy(() =>
  import('./PublishSessionDialog').then((m) => ({ default: m.PublishSessionDialog })),
)

export function PublishSessionDialogHost() {
  const [state, setState] = useAtom(publishSessionDialogAtom)

  // A closed dialog renders `null` either way (no portal, no content), so this
  // gate changes nothing visually — it only keeps the markdown pipeline out of
  // the boot fetch until the user actually publishes.
  if (!state.open) return null

  return (
    <React.Suspense fallback={null}>
      <PublishSessionDialog
        open
        sessionId={state.sessionId}
        connectionId={state.connectionId}
        runIds={state.runIds}
        onOpenChange={(open) => {
          if (!open) setState({ open: false })
        }}
      />
    </React.Suspense>
  )
}
