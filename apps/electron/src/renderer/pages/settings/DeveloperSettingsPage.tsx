/**
 * Настройки → «Разработчикам» (spec 2026-10-09 §B.16, D1/D2).
 *
 * Карточка-тумблер мастер-флага Developer Space (`devspace.v1`), статус
 * подключённых репозиториев через мост `devSpace:listRepositories` и ссылка на
 * per-repo согласие. Мост может отсутствовать в текущей волне — тогда
 * показывается пустое состояние с пометкой, без падения.
 */
import * as React from 'react'
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { devSpaceEnabledAtom } from '@/atoms/dev-space'
import { useAppShellContext } from '@/context/AppShellContext'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { SettingsCard, SettingsSection, SettingsToggle } from '@/components/settings'
import { ScrollArea } from '@/components/ui/scroll-area'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'developers',
}

/** Минимальная форма записи каталога, которую умеет отобразить страница. */
interface DevSpaceRepositoryEntry {
  id: string
  label: string
}

/**
 * Мост `devSpace:listRepositories` (channel-map key `listDevSpaceRepositories`).
 * Отсутствует до реализации каталога репо, поэтому доступ опционален.
 */
interface DevSpaceRepositoriesBridge {
  listDevSpaceRepositories?: (input: { workspaceId: string }) => Promise<unknown>
}

type RepositoriesState = 'loading' | 'ready' | 'empty' | 'unavailable' | 'error'

/** Нормализует ответ моста в отображаемые записи, не доверяя форме. */
function readRepositoryEntries(value: unknown): DevSpaceRepositoryEntry[] {
  if (!Array.isArray(value)) return []
  const entries: DevSpaceRepositoryEntry[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue
    const record = raw as Record<string, unknown>
    const id = record.id
    if (typeof id !== 'string' || id.length === 0) continue
    const slug = record.projectSlug
    const name = record.name
    const label = (typeof slug === 'string' && slug) || (typeof name === 'string' && name) || id
    entries.push({ id, label })
  }
  return entries
}

export default function DeveloperSettingsPage() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useAtom(devSpaceEnabledAtom)
  const { activeWorkspaceId } = useAppShellContext()
  const [repositories, setRepositories] = React.useState<DevSpaceRepositoryEntry[]>([])
  const [repositoriesState, setRepositoriesState] = React.useState<RepositoriesState>('empty')

  React.useEffect(() => {
    const bridge = (window.electronAPI as unknown as DevSpaceRepositoriesBridge | undefined)
      ?.listDevSpaceRepositories
    if (typeof bridge !== 'function') {
      setRepositories([])
      setRepositoriesState('unavailable')
      return
    }
    if (!activeWorkspaceId) {
      setRepositories([])
      setRepositoriesState('empty')
      return
    }
    let cancelled = false
    setRepositoriesState('loading')
    bridge({ workspaceId: activeWorkspaceId })
      .then((value) => {
        if (cancelled) return
        const entries = readRepositoryEntries(value)
        setRepositories(entries)
        setRepositoriesState(entries.length > 0 ? 'ready' : 'empty')
      })
      .catch(() => {
        if (cancelled) return
        setRepositories([])
        setRepositoriesState('error')
      })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title={t('settings.developers.title')} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="mx-auto w-full max-w-5xl space-y-8 px-5 py-7">
            <p className="whitespace-normal break-words text-sm text-muted-foreground">
              {t('settings.developers.description')}
            </p>

            <SettingsSection title={t('settings.developers.section.general')}>
              <SettingsCard>
                <SettingsToggle
                  label={t('settings.developers.toggle')}
                  description={t('settings.developers.toggleDesc')}
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
              </SettingsCard>
            </SettingsSection>

            <SettingsSection title={t('settings.developers.repositories.title')}>
              <SettingsCard className="space-y-3" divided={false}>
                {repositoriesState === 'loading' && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {t('settings.developers.repositories.loading')}
                  </p>
                )}
                {repositoriesState === 'unavailable' && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {t('settings.developers.repositories.unavailable')}
                  </p>
                )}
                {repositoriesState === 'empty' && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {t('settings.developers.repositories.empty')}
                  </p>
                )}
                {repositoriesState === 'error' && (
                  <p role="alert" className="text-sm text-destructive">
                    {t('settings.developers.repositories.error')}
                  </p>
                )}
                {repositoriesState === 'ready' && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {t('settings.developers.repositories.count', { count: repositories.length })}
                    </p>
                    <ul className="space-y-2">
                      {repositories.map((repository) => (
                        <li
                          key={repository.id}
                          className="rounded-md border border-border px-3 py-2 text-sm"
                        >
                          {repository.label}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </SettingsCard>
            </SettingsSection>

            <SettingsSection title={t('settings.developers.consent.title')}>
              <SettingsCard className="space-y-3" divided={false}>
                <p className="text-sm text-muted-foreground">
                  {t('settings.developers.consent.description')}
                </p>
                <div
                  role="note"
                  className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
                >
                  {t('settings.developers.consent.placeholder')}
                </div>
              </SettingsCard>
            </SettingsSection>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}