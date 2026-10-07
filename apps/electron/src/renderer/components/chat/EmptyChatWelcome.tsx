import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CraftAgentsSymbol } from '@/components/icons/CraftAgentsSymbol'
import { useSuperEngineeringProfile } from '@/hooks/useSuperEngineeringProfile'
import { ProjectHub } from '@/components/hub/ProjectHub'
import { QuickStartDialog } from '@/components/hub/QuickStartDialog'
import { CloneFromUrlDialog } from '@/components/hub/CloneFromUrlDialog'

/** The existing transparent brand asset, confined to the empty chat region. */
export function EmptyChatWelcome() {
  const { t } = useTranslation()
  const se = useSuperEngineeringProfile()
  const [quickOpen, setQuickOpen] = useState(false)
  const [cloneOpen, setCloneOpen] = useState(false)

  if (se) {
    return (
      <>
        <ProjectHub onQuickStart={() => setQuickOpen(true)} onCloneUrl={() => setCloneOpen(true)} />
        <QuickStartDialog open={quickOpen} onOpenChange={setQuickOpen} />
        <CloneFromUrlDialog open={cloneOpen} onOpenChange={setCloneOpen} />
      </>
    )
  }

  return <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 pb-6 text-center" data-testid="empty-chat-welcome">
    <CraftAgentsSymbol className="size-24 max-h-[22vh] opacity-85 dark:invert" />
    <h2 className="text-lg font-medium tracking-tight text-foreground/80">{t('starterPrompts.welcome')}</h2>
  </div>
}
