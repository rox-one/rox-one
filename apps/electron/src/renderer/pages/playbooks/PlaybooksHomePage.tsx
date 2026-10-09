import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'

/** С-12 Playbooks Home — flag-gated stub surface (notebook content lands in В4/В5). */
export default function PlaybooksHomePage() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="playbooks-home">
      <PanelHeader title={t('playbooks.home.title')} />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <p className="mb-2 max-w-2xl text-sm text-muted-foreground">{t('playbooks.home.subtitle')}</p>
        <p className="max-w-2xl text-sm" role="status" data-testid="playbooks-enabled-notice">{t('playbooks.home.enabledNotice')}</p>
      </div>
    </div>
  )
}