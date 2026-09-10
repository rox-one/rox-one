import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsCardContent, SettingsRow, SettingsSection } from '@/components/settings'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { SETTINGS_ICONS } from '@/components/icons/SettingsIcons'
import { navigate, routes } from '@/lib/navigate'
import { readRecentSettings, recordRecentSetting } from '@/lib/settings-recent'
import { getSettingsPage, type SettingsSubpage } from '../../../shared/settings-registry'

const QUICK_ACTIONS: SettingsSubpage[] = [
  'runtime',
  'ai',
  'permissions',
  'marketplace',
  'accounts',
  'appearance',
  'shortcuts',
]

export function SettingsOverviewPage() {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const {
    activeWorkspaceId,
    llmConnections,
    workspaceDefaultLlmConnection,
  } = useAppShellContext()

  const defaultConnection = useMemo(
    () => llmConnections.find((connection) => connection.slug === workspaceDefaultLlmConnection),
    [llmConnections, workspaceDefaultLlmConnection],
  )
  const [recentPages, setRecentPages] = useState<Array<{ id: SettingsSubpage; page: ReturnType<typeof getSettingsPage> }>>([])

  useEffect(() => {
    let cancelled = false
    void readRecentSettings(activeWorkspaceId).then((ids) => {
      if (cancelled) return
      setRecentPages(
        ids.flatMap((id) => {
          const page = getSettingsPage(id)
          return page ? [{ id, page }] : []
        }),
      )
    })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId])

  const goTo = useCallback((subpage: SettingsSubpage) => {
    void recordRecentSetting(activeWorkspaceId, subpage)
    navigate(routes.view.settings(subpage))
  }, [activeWorkspaceId])

  const missingWorkspace = !activeWorkspace
  const missingConnections = llmConnections.length === 0
  const needsAttention = missingWorkspace || missingConnections

  return (
    <div className="h-full flex flex-col" data-testid="settings-overview">
      <PanelHeader title={t('settings.overview.title')} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              <SettingsSection title={t('settings.overview.workspace')}>
                <SettingsCard>
                  {activeWorkspace ? (
                    <SettingsRow
                      label={activeWorkspace.name}
                      description={activeWorkspace.rootPath}
                    />
                  ) : (
                    <SettingsRow
                      label={t('settings.overview.noWorkspace')}
                      action={
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => goTo('workspace')}
                          aria-label={t('settings.overview.configureWorkspace')}
                        >
                          {t('settings.overview.configureWorkspace')}
                        </Button>
                      }
                    />
                  )}
                  <SettingsRow
                    label={defaultConnection?.name ?? t('settings.overview.noConnection')}
                    description={defaultConnection?.defaultModel ?? defaultConnection?.slug}
                    action={
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => goTo('ai')}
                        aria-label={t('settings.overview.configureAi')}
                      >
                        {t('settings.overview.configureAi')}
                      </Button>
                    }
                  />
                </SettingsCard>
              </SettingsSection>

              {needsAttention && (
                <SettingsSection title={t('settings.overview.attention')}>
                  <SettingsCard divided={false}>
                    <SettingsCardContent className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <div className="min-w-0 flex-1 space-y-3">
                        {missingWorkspace && (
                          <p className="text-sm text-muted-foreground">{t('settings.overview.noWorkspace')}</p>
                        )}
                        {missingConnections && (
                          <p className="text-sm text-muted-foreground">{t('settings.overview.noConnection')}</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {missingWorkspace && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => goTo('workspace')}
                              aria-label={t('settings.overview.configureWorkspace')}
                            >
                              {t('settings.overview.configureWorkspace')}
                            </Button>
                          )}
                          {missingConnections && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => goTo('ai')}
                              aria-label={t('settings.overview.configureAi')}
                            >
                              {t('settings.overview.configureAi')}
                            </Button>
                          )}
                        </div>
                      </div>
                    </SettingsCardContent>
                  </SettingsCard>
                </SettingsSection>
              )}

              <SettingsSection title={t('settings.overview.actions')}>
                <SettingsCard divided={false}>
                  <SettingsCardContent className="grid gap-2 sm:grid-cols-2">
                    {QUICK_ACTIONS.map((id) => {
                      const page = getSettingsPage(id)
                      const Icon = SETTINGS_ICONS[id]
                      const label = id === 'runtime' ? t('settings.overview.runtime') : t(page.labelKey)
                      return (
                        <Button
                          key={id}
                          variant="outline"
                          className="justify-start"
                          onClick={() => goTo(id)}
                          aria-label={label}
                          data-testid={`settings-quick-${id}`}
                        >
                          <Icon className="text-muted-foreground" />
                          <span className="flex-1 text-left">{label}</span>
                          <ArrowRight className="text-muted-foreground" />
                        </Button>
                      )
                    })}
                  </SettingsCardContent>
                </SettingsCard>
              </SettingsSection>

              {recentPages.length > 0 && (
                <SettingsSection title={t('settings.overview.recent')} data-testid="settings-recent">
                  <SettingsCard>
                    {recentPages.map(({ id, page }) => {
                      const Icon = SETTINGS_ICONS[id]
                      return (
                        <SettingsRow
                          key={id}
                          data-testid={`settings-recent-${id}`}
                          label={
                            <span className="flex items-center gap-2">
                              <Icon className="h-4 w-4 text-muted-foreground" />
                              {t(page.labelKey)}
                            </span>
                          }
                          description={t(page.descriptionKey)}
                          onClick={() => goTo(id)}
                        />
                      )
                    })}
                  </SettingsCard>
                </SettingsSection>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
