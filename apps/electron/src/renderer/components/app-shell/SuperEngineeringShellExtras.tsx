import * as React from 'react'
import { useSetAtom } from 'jotai'
import { useAction } from '@/actions'
import { seChatPipOpenAtom } from '@/atoms/se-chat-pip'
import { useSuperEngineeringProfile } from '@/hooks/useSuperEngineeringProfile'
import { useSeOnboardingGate } from '@/components/onboarding/se-onboarding-gate'
import { KEYS, getKeyString } from '@/lib/local-storage'

const SuperEngineeringOnboardingDialog = React.lazy(() =>
  import('@/components/onboarding/SuperEngineeringOnboardingDialog').then((m) => ({
    default: m.SuperEngineeringOnboardingDialog,
  })),
)
const WhatsNewSheet = React.lazy(() =>
  import('./WhatsNewSheet').then((m) => ({ default: m.WhatsNewSheet })),
)
const SeChatPictureInPicture = React.lazy(() =>
  import('./SeChatPictureInPicture').then((m) => ({ default: m.SeChatPictureInPicture })),
)

function readWhatsNewSeen(): boolean {
  try {
    return localStorage.getItem(getKeyString(KEYS.seWhatsNewSeen)) === '1'
  } catch {
    return false
  }
}

function markWhatsNewSeen(): void {
  try {
    localStorage.setItem(getKeyString(KEYS.seWhatsNewSeen), '1')
  } catch {
    /* ignore */
  }
}

/** SE-only overlays: What's New + 4-step onboarding (opt-in profile). */
export function SuperEngineeringShellExtras() {
  const se = useSuperEngineeringProfile()
  const onboarding = useSeOnboardingGate(se)
  const [whatsNewOpen, setWhatsNewOpen] = React.useState(false)
  const setChatPipOpen = useSetAtom(seChatPipOpenAtom)

  useAction('view.toggleChatPictureInPicture', () => {
    if (!se) return
    setChatPipOpen((v) => !v)
  })

  React.useEffect(() => {
    if (!se || onboarding.shouldShow) return
    if (!readWhatsNewSeen()) setWhatsNewOpen(true)
  }, [se, onboarding.shouldShow])

  if (!se) return null

  return (
    <React.Suspense fallback={null}>
      {onboarding.shouldShow && (
        <SuperEngineeringOnboardingDialog
          open={onboarding.shouldShow}
          onOpenChange={(open) => {
            if (!open) onboarding.dismiss()
          }}
        />
      )}
      {whatsNewOpen && (
        <WhatsNewSheet
          open={whatsNewOpen}
          onOpenChange={(open) => {
            setWhatsNewOpen(open)
            if (!open) markWhatsNewSeen()
          }}
        />
      )}
      <SeChatPictureInPicture />
    </React.Suspense>
  )
}
