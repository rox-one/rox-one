import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const cloudRunsSettingsPath = join(__dirname, '../CloudRunsSettingsPage.tsx')
const source = readFileSync(cloudRunsSettingsPath, 'utf8')

const longCyrillicDescription = 'Фоновое выполнение облачных задач продолжает работать после закрытия приложения и должно оставаться полностью читаемым'

describe('CloudRunsSettingsPage compact layout and recovery', () => {
  it('uses shared PanelHeader chrome and one ScrollArea body', () => {
    expect(source).toContain('h-full min-h-0 flex-col')
    expect(source).toContain('<PanelHeader')
    expect(source).toContain('mask-fade-y')
    expect(source).toContain('<ScrollArea')
    expect(source).not.toContain('<header className="flex shrink-0')
    expect(source).not.toContain('<footer className="shrink-0')
    expect(source).not.toContain('100dvh')
  })

  it('keeps long Cyrillic settings labels and descriptions readable', () => {
    expect(longCyrillicDescription.length).toBeGreaterThan(80)
    expect(source).toContain('function SettingText')
    expect(source).toContain('min-w-0 whitespace-normal break-words')
    expect(source).toContain('<SettingsRow label={<SettingText')
    expect(source).toContain("label={<SettingText label={t('settings.cloudRuns.enable')}")
  })

  it('keeps unavailable load and failed-save states visible and retryable', () => {
    expect(source).toContain('setLoadError')
    expect(source).toContain('setSaveError')
    expect(source).toContain('setFailedPatch(nextPatch)')
    expect(source).toContain('role="alert"')
    expect(source).toContain('onClick={() => void load()}')
    expect(source).toContain('onClick={() => patch(failedPatch)}')
    expect(source).toContain("t('common.retry')")
    expect(source).toContain('translateCloudRunsError')
  })

  it('names the refresh operation and exposes enabled or disabled status', () => {
    expect(source).toContain("t('common.refresh')")
    expect(source).toContain("t('automations.statusActive')")
    expect(source).toContain("t('automations.statusDisabled')")
  })

  it('uses i18n placeholders instead of English example strings', () => {
    expect(source).toContain("t('settings.cloudRuns.webhookPlaceholder')")
    expect(source).toContain("t('settings.cloudRuns.cheapModelPlaceholder')")
    expect(source).not.toContain('https://example.com/cloud-runs-hook')
    expect(source).not.toContain('kimi-lite / gpt-4o-mini')
  })

  it('rebinds webhook, limits, cheap-model, and Daytona sandbox fields after a successful load', () => {
    expect(source).toContain('setDraft(draftFromConfig(next))')
    expect(source).toContain('value={draft.notifyWebhookUrl}')
    expect(source).toContain('value={draft.maxWallClockSec}')
    expect(source).toContain('value={draft.maxLlmTokens}')
    expect(source).toContain('value={draft.maxArtifactsBytes}')
    expect(source).toContain('value={draft.cheapModelId}')
    expect(source).toContain('value={draft.daytonaProjectId}')
    expect(source).toContain('value={draft.daytonaSnapshot}')
    expect(source).toContain('value={draft.daytonaSandbox}')
    expect(source).toContain('value={draft.daytonaRegion}')
    expect(source).toContain('value={draft.daytonaImage}')
    expect(source).toContain('value={draft.defaultTtlSec}')
    expect(source).not.toContain('defaultValue=')
    expect(source).toContain('config.tokenConfigured')
    expect(source).not.toMatch(/type=["']password["']/)
    expect(source).not.toMatch(/BYOK|jwt|JWT|secret editor/i)
    expect(source).not.toContain('<select')
    expect(source).not.toContain('cloudflare')
    expect(source).not.toContain('modal')
  })

  it('exposes a Rox-native sandbox tab instead of embedding grok-bot UI', () => {
    expect(source).toContain("t('settings.cloudRuns.sectionSandbox')")
    expect(source).toContain("t('settings.cloudRuns.sectionRoxSandbox')")
    expect(source).toContain("t('settings.cloudRuns.sandboxTab')")
    expect(source).toContain("t('settings.cloudRuns.sandboxGated')")
    expect(source).not.toContain('grok-bot')
    expect(source).not.toContain('iframe')
  })

  it('closes the personas section before the sandbox tab section', () => {
    const personas = source.indexOf("t('settings.cloudRuns.sectionPersonas')")
    const sandboxTab = source.indexOf("t('settings.cloudRuns.sandboxTab')")
    expect(personas).toBeGreaterThan(-1)
    expect(sandboxTab).toBeGreaterThan(personas)
    expect(source.slice(personas, sandboxTab)).toContain('</SettingsSection>')
  })
})
