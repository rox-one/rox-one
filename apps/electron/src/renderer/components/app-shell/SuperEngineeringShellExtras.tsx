import * as React from 'react'
import { useSetAtom } from 'jotai'
import { useAction } from '@/actions'
import { seChatPipOpenAtom } from '@/atoms/se-chat-pip'
import { useSuperEngineeringProfile } from '@/hooks/useSuperEngineeringProfile'
import { WhatsNewSheet } from './WhatsNewSheet'
import { SeChatPictureInPicture } from './SeChatPictureInPicture'
import {
  SuperEngineeringOnboardingDialog,
  useSeOnboardingGate,
} from '@/components/onboarding/SuperEngineeringOnboardingDialog'
import { KEYS, getKeyString } from '@/lib/local-storage'

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
    <>
      <SuperEngineeringOnboardingDialog
        open={onboarding.shouldShow}
        onOpenChange={(open) => {
          if (!open) onboarding.dismiss()
        }}
      />
      <WhatsNewSheet
        open={whatsNewOpen}
        onOpenChange={(open) => {
          setWhatsNewOpen(open)
          if (!open) markWhatsNewSeen()
        }}
      />
      <SeChatPictureInPicture />
    </>
  )
}
