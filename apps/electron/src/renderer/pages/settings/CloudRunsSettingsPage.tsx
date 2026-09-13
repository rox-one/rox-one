/**
 * CloudRunsSettingsPage — enable/configure cloud runs
 * (PRD docs/cloud-runs-prd.md, G3.4 + P2.8 UX rewrite).
 *
 * Reads/writes config.json via cloudRuns RPC. The provider token is NOT
 * editable here: it lives in <configDir>/cloud-runs.env (0600,
 * user-managed); the page only shows whether it's present.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { routes } from '@/lib/navigate'
import { settingsPageActionAllowed, settingsRuntimeSource } from './settings-rox2-surface'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'cloudRuns',
}

type Provider = 'local' | 'daytona' | 'native'
interface Config {
  enabled: boolean
  provider: Provider
  gatewayUrl?: string
  notifyWebhookUrl?: string
  cheapModelId?: string
  personas?: boolean
  tokenConfigured: boolean
  secretConfigured?: boolean
  daytonaProjectId?: string
  daytonaSnapshot?: string
  daytonaSandbox?: string
  daytonaRegion?: string
  daytonaImage?: string
  daytonaApiUrl?: string
  defaultTtlSec?: number
  defaults: { maxWallClockSec: number; maxLlmTokens: number; maxArtifactsBytes: number }
}

const fieldClass =
  'w-full max-w-xl rounded-md border border-border bg-background px-2.5 py-1.5 text-sm shadow-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

type ConfigPatch = Partial<Config> & {
  defaultMaxWallClockSec?: number
  defaultMaxLlmTokens?: number
  defaultMaxArtifactsBytes?: number
  defaultTtlSec?: number
}

type FieldDraft = {
  notifyWebhookUrl: string
  maxWallClockSec: string
  maxLlmTokens: string
  maxArtifactsBytes: string
  cheapModelId: string
  daytonaProjectId: string
  daytonaSnapshot: string
  daytonaSandbox: string
  daytonaRegion: string
  daytonaImage: string
  daytonaApiUrl: string
  defaultTtlSec: string
}

function draftFromConfig(config: Config): FieldDraft {
  return {
    notifyWebhookUrl: config.notifyWebhookUrl ?? '',
    maxWallClockSec: String(config.defaults.maxWallClockSec),
    maxLlmTokens: String(config.defaults.maxLlmTokens),
    maxArtifactsBytes: String(config.defaults.maxArtifactsBytes),
    cheapModelId: config.cheapModelId ?? '',
    daytonaProjectId: config.daytonaProjectId ?? '',
    daytonaSnapshot: config.daytonaSnapshot ?? '',
    daytonaSandbox: config.daytonaSandbox ?? '',
    daytonaRegion: config.daytonaRegion ?? '',
    daytonaImage: config.daytonaImage ?? '',
    daytonaApiUrl: config.daytonaApiUrl ?? '',
    defaultTtlSec: String(config.defaultTtlSec ?? 3600),
  }
}

function SettingText({ label, description }: { label: string; description: string }) {
  return (
    <div className="min-w-0 whitespace-normal break-words">
      <div>{label}</div>
      <div className="mt-1 text-xs font-normal text-muted-foreground">{description}</div>
    </div>
  )
}

function translateCloudRunsError(message: string, t: (key: string) => string): string {
  if (message.startsWith('security.assurance.')) return t(message)
  return message
}

export default function CloudRunsSettingsPage() {
  const { t } = useTranslation()
  const [config, setConfig] = React.useState<Config | null>(null)
  const [draft, setDraft] = React.useState<FieldDraft | null>(null)
  // config-read is device-read: config.json is only read after the user
  // explicitly grants it. Opening the page is not a grant.
  const [granted, setGranted] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [failedPatch, setFailedPatch] = React.useState<ConfigPatch | null>(null)

  const load = React.useCallback(async (isGranted: boolean) => {
    const allowed = settingsPageActionAllowed({
      pageId: 'cloudRuns',
      action: 'config-read',
      source: settingsRuntimeSource(),
      granted: isGranted,
    })
    if (!allowed) return
    setLoading(true)
    setLoadError(null)
    try {
      const getConfig = window.electronAPI?.getCloudRunsConfig
      if (typeof getConfig !== 'function') throw new Error(t('common.unavailable'))
      const next = await getConfig()
      setConfig(next)
      setDraft(draftFromConfig(next))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    if (!granted) return
    void load(granted)
  }, [granted, load])

  const patch = (nextPatch: ConfigPatch) => {
    setSaveError(null)
    setFailedPatch(null)
    const allowed = settingsPageActionAllowed({
      pageId: 'cloudRuns',
      action: 'pref-write',
      source: settingsRuntimeSource(),
    })
    if (!allowed) return
    window.electronAPI
      .setCloudRunsConfig(nextPatch)
      .then(() =>
        setConfig((previous) => {
          if (!previous) return previous
          const next = { ...previous, ...nextPatch }
          if (nextPatch.defaultMaxWallClockSec != null) {
            next.defaults = { ...previous.defaults, maxWallClockSec: nextPatch.defaultMaxWallClockSec }
          }
          if (nextPatch.defaultMaxLlmTokens != null) {
            next.defaults = { ...next.defaults, maxLlmTokens: nextPatch.defaultMaxLlmTokens }
          }
          if (nextPatch.defaultMaxArtifactsBytes != null) {
            next.defaults = { ...next.defaults, maxArtifactsBytes: nextPatch.defaultMaxArtifactsBytes }
          }
          return next
        }),
      )
      .catch((error) => {
        const message = translateCloudRunsError(error instanceof Error ? error.message : String(error), t)
        setSaveError(message)
        setFailedPatch(nextPatch)
        toast.error(t('cloudRuns.error'), { description: message })
      })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title={t('settings.cloudRuns.title')}
        actions={
          <>
            <Button size="sm" variant="outline" disabled={loading || !granted} onClick={() => void load(granted)}>
              {loading ? t('common.loading') : t('common.refresh')}
            </Button>
            <HeaderMenu route={routes.view.settings('cloudRuns')} />
          </>
        }
      />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
        <div className="mx-auto w-full max-w-5xl space-y-8 px-5 py-7">
          <p className="whitespace-normal break-words text-sm text-muted-foreground">
            {t('settings.cloudRuns.description')}
          </p>
          {config && (
            <p className="text-xs text-muted-foreground" role="status">
              {config.enabled ? t('automations.statusActive') : t('automations.statusDisabled')}
            </p>
          )}
          {loadError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
              <span className="min-w-0 whitespace-normal break-words">{loadError}</span>
              <Button size="sm" variant="outline" onClick={() => void load(granted)}>
                {t('common.retry')}
              </Button>
            </div>
          )}
          {saveError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
              <span className="min-w-0 whitespace-normal break-words">{saveError}</span>
              {failedPatch && (
                <Button size="sm" variant="outline" onClick={() => patch(failedPatch)}>
                  {t('common.retry')}
                </Button>
              )}
            </div>
          )}

          {!granted ? (
            <SettingsCard className="px-4 py-3.5">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t('settings.cloudRuns.loadConfigDesc')}
                </p>
                <Button size="sm" onClick={() => setGranted(true)}>
                  {t('settings.cloudRuns.loadConfig')}
                </Button>
              </div>
            </SettingsCard>
          ) : !config && !loadError ? (
            <div role="status" className="rounded-md border border-border/60 px-3 py-2 text-sm text-muted-foreground">
              {t('common.loading')}
            </div>
          ) : null}

          {config && draft && (
            <>
              <SettingsSection title={t('settings.cloudRuns.sectionConnection')}>
                <SettingsCard className="gap-1">
                  <SettingsToggle
                    label={<SettingText label={t('settings.cloudRuns.enable')} description={t('settings.cloudRuns.enableHint')} />}
                    checked={config.enabled}
                    onCheckedChange={(checked) => patch({ enabled: checked })}
                  />
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.provider')} description={t('settings.cloudRuns.providerHint')} />}>
                    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t('settings.cloudRuns.provider')}>
                      {(['daytona', 'local', 'native'] as const).map((id) => (
                        <Button
                          key={id}
                          type="button"
                          size="sm"
                          variant={config.provider === id ? 'default' : 'outline'}
                          aria-pressed={config.provider === id}
                          onClick={() => patch({ provider: id })}
                        >
                          {id === 'daytona' ? t('settings.cloudRuns.providerDaytona') : id === 'local' ? t('settings.cloudRuns.providerLocal') : t('settings.cloudRuns.providerNative')}
                        </Button>
                      ))}
                    </div>
                  </SettingsRow>
                  {config.provider === 'daytona' && (
                    <>
                      <SettingsRow
                        label={
                          <SettingText
                            label={t('settings.cloudRuns.secretRef')}
                            description={(config.secretConfigured ?? config.tokenConfigured) ? t('settings.cloudRuns.secretRefSet') : t('settings.cloudRuns.secretRefMissing')}
                          />
                        }
                      >
                        <span
                          className={`inline-flex h-7 min-w-[2rem] items-center justify-center rounded-md border px-2 text-xs font-medium ${
                            config.secretConfigured ?? config.tokenConfigured
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'border-destructive/40 bg-destructive/10 text-destructive'
                          }`}
                        >
                          {(config.secretConfigured ?? config.tokenConfigured) ? '✓' : '✗'}
                        </span>
                      </SettingsRow>
                    </>
                  )}
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.webhook')} description={t('settings.cloudRuns.webhookHint')} />}>
                    <Input
                      className={fieldClass}
                      value={draft.notifyWebhookUrl}
                      placeholder={t('settings.cloudRuns.webhookPlaceholder')}
                      onChange={(e) => setDraft((current) => current && { ...current, notifyWebhookUrl: e.target.value })}
                      onBlur={(e) => patch({ notifyWebhookUrl: e.target.value.trim() || undefined })}
                    />
                  </SettingsRow>
                </SettingsCard>
              </SettingsSection>

              {config.provider === 'daytona' && (
              <SettingsSection title={t('settings.cloudRuns.sectionSandbox')}>
                <SettingsCard>
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.project')} description={t('settings.cloudRuns.projectHint')} />}>
                    <Input
                      className={fieldClass}
                      value={draft.daytonaProjectId}
                      onChange={(e) => setDraft((current) => current && { ...current, daytonaProjectId: e.target.value })}
                      onBlur={(e) => patch({ daytonaProjectId: e.target.value.trim() || undefined })}
                    />
                  </SettingsRow>
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.snapshot')} description={t('settings.cloudRuns.snapshotHint')} />}>
                    <Input
                      className={fieldClass}
                      value={draft.daytonaSnapshot}
                      onChange={(e) => setDraft((current) => current && { ...current, daytonaSnapshot: e.target.value })}
                      onBlur={(e) => patch({ daytonaSnapshot: e.target.value.trim() || undefined })}
                    />
                  </SettingsRow>
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.sandbox')} description={t('settings.cloudRuns.sandboxHint')} />}>
                    <Input
                      className={fieldClass}
                      value={draft.daytonaSandbox}
                      onChange={(e) => setDraft((current) => current && { ...current, daytonaSandbox: e.target.value })}
                      onBlur={(e) => patch({ daytonaSandbox: e.target.value.trim() || undefined })}
                    />
                  </SettingsRow>
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.region')} description={t('settings.cloudRuns.regionHint')} />}>
                    <Input
                      className={fieldClass + ' w-40'}
                      value={draft.daytonaRegion}
                      onChange={(e) => setDraft((current) => current && { ...current, daytonaRegion: e.target.value })}
                      onBlur={(e) => patch({ daytonaRegion: e.target.value.trim() || undefined })}
                    />
                  </SettingsRow>
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.image')} description={t('settings.cloudRuns.imageHint')} />}>
                    <Input
                      className={fieldClass}
                      value={draft.daytonaImage}
                      onChange={(e) => setDraft((current) => current && { ...current, daytonaImage: e.target.value })}
                      onBlur={(e) => patch({ daytonaImage: e.target.value.trim() || undefined })}
                    />
                  </SettingsRow>
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.ttl')} description={t('settings.cloudRuns.ttlHint')} />}>
                    <Input
                      className={fieldClass + ' w-32'}
                      type="number"
                      min={60}
                      value={draft.defaultTtlSec}
                      onChange={(e) => setDraft((current) => current && { ...current, defaultTtlSec: e.target.value })}
                      onBlur={(e) => {
                        const value = Number(e.target.value)
                        if (Number.isInteger(value) && value >= 60) patch({ defaultTtlSec: value })
                      }}
                    />
                  </SettingsRow>
                </SettingsCard>
              </SettingsSection>
              )}

              <SettingsSection title={t('settings.cloudRuns.sectionLimits')}>
                <SettingsCard>
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.maxWallClock')} description={t('settings.cloudRuns.maxWallClockHint')} />}>
                    <Input
                      className={fieldClass + ' w-32'}
                      type="number"
                      min={60}
                      value={draft.maxWallClockSec}
                      onChange={(e) => setDraft((current) => current && { ...current, maxWallClockSec: e.target.value })}
                      onBlur={(e) => {
                        const value = Number(e.target.value)
                        if (Number.isInteger(value) && value >= 60) patch({ defaultMaxWallClockSec: value })
                      }}
                    />
                  </SettingsRow>
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.maxLlmTokens')} description={t('settings.cloudRuns.maxLlmTokensHint')} />}>
                    <Input
                      className={fieldClass + ' w-40'}
                      type="number"
                      min={10_000}
                      value={draft.maxLlmTokens}
                      onChange={(e) => setDraft((current) => current && { ...current, maxLlmTokens: e.target.value })}
                      onBlur={(e) => {
                        const value = Number(e.target.value)
                        if (Number.isInteger(value) && value >= 10_000) patch({ defaultMaxLlmTokens: value })
                      }}
                    />
                  </SettingsRow>
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.maxArtifacts')} description={t('settings.cloudRuns.maxArtifactsHint')} />}>
                    <Input
                      className={fieldClass + ' w-40'}
                      type="number"
                      min={1_000_000}
                      value={draft.maxArtifactsBytes}
                      onChange={(e) => setDraft((current) => current && { ...current, maxArtifactsBytes: e.target.value })}
                      onBlur={(e) => {
                        const value = Number(e.target.value)
                        if (Number.isInteger(value) && value >= 1_000_000) patch({ defaultMaxArtifactsBytes: value })
                      }}
                    />
                  </SettingsRow>
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.cheapModel')} description={t('settings.cloudRuns.cheapModelHint')} />}>
                    <Input
                      className={fieldClass + ' w-64'}
                      value={draft.cheapModelId}
                      placeholder={t('settings.cloudRuns.cheapModelPlaceholder')}
                      onChange={(e) => setDraft((current) => current && { ...current, cheapModelId: e.target.value })}
                      onBlur={(e) => patch({ cheapModelId: e.target.value.trim() || undefined })}
                    />
                  </SettingsRow>
                </SettingsCard>
              </SettingsSection>

              <SettingsSection title={t('settings.cloudRuns.sectionSchedule')}>
                <SettingsCard>
                  <div className="space-y-2 px-4 py-3 text-sm text-muted-foreground">
                    <p className="min-w-0 whitespace-normal break-words">{t('settings.cloudRuns.scheduleHelp')}</p>
                    <p className="min-w-0 whitespace-normal break-words text-xs opacity-80">{t('settings.cloudRuns.everyHoursHelp')}</p>
                  </div>
                </SettingsCard>
              </SettingsSection>

              <SettingsSection title={t('settings.cloudRuns.sectionPersonas')}>
                <SettingsCard>
                  <SettingsToggle
                    label={<SettingText label={t('settings.cloudRuns.personasLbl')} description={t('settings.cloudRuns.personasHint')} />}
                    checked={config.personas ?? false}
                    onCheckedChange={(checked) => patch({ personas: checked })}
                  />
                </SettingsCard>
              </SettingsSection>
              <SettingsSection title={t('settings.cloudRuns.sectionRoxSandbox')}>
                <SettingsCard>
                  <SettingsRow
                    label={
                      <SettingText
                        label={t('settings.cloudRuns.sandboxTab')}
                        description={t('settings.cloudRuns.sandboxHint')}
                      />
                    }
                  >
                    <span className="text-xs text-muted-foreground">
                      {t('settings.cloudRuns.sandboxGated')}
                    </span>
                  </SettingsRow>
                </SettingsCard>
              </SettingsSection>
            </>
          )}
        </div>
        </ScrollArea>
      </div>
    </div>
  )
}
