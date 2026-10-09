/**
 * Настройки → «Плейбуки» (spec 2026-10-09, D12) — предрегистрация поверхности.
 * Мастер-флаг `playbooks.v1` включается только явным действием пользователя
 * (тумблер); режимы «знания»/«кодбук» появятся в следующих волнах.
 */
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { playbooksEnabledAtom } from '@/atoms/playbooks'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { SettingsCard, SettingsSection, SettingsToggle } from '@/components/settings'
import { ScrollArea } from '@/components/ui/scroll-area'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'playbooks',
}

export default function PlaybooksSettingsPage() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useAtom(playbooksEnabledAtom)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title={t('settings.playbooks.title')} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="mx-auto w-full max-w-5xl space-y-8 px-5 py-7">
            <p className="whitespace-normal break-words text-sm text-muted-foreground">
              {t('settings.playbooks.description')}
            </p>
            <SettingsSection title={t('settings.playbooks.section.general')}>
              <SettingsCard>
                <SettingsToggle
                  label={t('settings.playbooks.toggle')}
                  description={t('settings.playbooks.toggleDesc')}
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
              </SettingsCard>
            </SettingsSection>
            <div role="note" className="rounded-md border border-border px-3 py-3 text-sm text-muted-foreground">
              {t('settings.playbooks.preregistration')}
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}