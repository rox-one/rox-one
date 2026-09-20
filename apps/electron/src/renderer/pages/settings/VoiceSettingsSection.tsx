import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SettingsCard,
  SettingsMenuSelectRow,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'
import type {
  AudioRetention,
  EnhancementMode,
  HotkeyMode,
  OverlayPosition,
  SttEngine,
  TtsEngine,
  VoiceHealth,
  VoicePrefs,
} from '@craft-agent/shared/voice'

export function VoiceSettingsSection() {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<VoicePrefs | null>(null)
  const [health, setHealth] = useState<VoiceHealth | null>(null)
  const [history, setHistory] = useState<Array<{ id: string; favorite: boolean; state: string }>>([])
  const [brand, setBrand] = useState('rocks transcription (rocks t1)')

  const reload = useCallback(async () => {
    if (!window.electronAPI.getVoicePrefs) return
    const [nextPrefs, nextHealth] = await Promise.all([
      window.electronAPI.getVoicePrefs(),
      window.electronAPI.getVoiceHealth(),
    ])
    setPrefs(nextPrefs)
    setHealth(nextHealth)
    const caps = await window.electronAPI.getVoiceCapabilities?.().catch(() => null)
    if (caps?.displayName) setBrand(caps.displayName)
    const listed = await window.electronAPI.listVoiceHistory?.({ limit: 20 }).catch(() => null)
    if (listed?.page) setHistory(listed.page as Array<{ id: string; favorite: boolean; state: string }>)
  }, [])

  useEffect(() => {
    void reload()
    const off = window.electronAPI.onVoiceChanged?.(() => {
      void reload()
    })
    return () => off?.()
  }, [reload])

  const save = useCallback(async (patch: Partial<VoicePrefs>) => {
    const next = await window.electronAPI.saveVoicePrefs(patch)
    setPrefs(next)
  }, [])

  if (!prefs) return null

  const healthLabel = (() => {
    switch (health?.whisper) {
      case 'ready': return t('settings.input.voiceHealthReady')
      case 'downloading': return t('settings.input.voiceHealthDownloading')
      case 'error': return t('settings.input.voiceHealthError')
      case 'unsupported': return t('settings.input.voiceHealthUnsupported')
      default: return t('settings.input.voiceHealthMissing')
    }
  })()

  return (
    <>
      {prefs.privacyMigrationPending && (
        <p className="px-4 pb-2 text-xs text-amber-600">{t('settings.input.voiceMigrationPending')}</p>
      )}
      <SettingsSection title={t('settings.input.voiceGroupGeneral')} description={t('settings.input.voiceDesc')}>
        <SettingsCard>
          <SettingsMenuSelectRow
            label={t('settings.input.sttEngine')}
            description={`${t('settings.input.sttEngineDesc')} · ${brand}`}
            value={prefs.sttEngine}
            onValueChange={(value) => void save({ sttEngine: value as SttEngine, cloudAsrConsent: value !== 'local-whisper' })}
            options={[
              { value: 'local-whisper', label: t('settings.input.sttLocal'), description: t('settings.input.sttLocalDesc') },
              { value: 'cloud-rox', label: t('settings.input.voiceRocksT1'), description: t('settings.input.sttCloudRoxDesc') },
              { value: 'cloud-deepgram', label: t('settings.input.sttCloudDeepgram'), description: t('settings.input.sttCloudDeepgramDesc') },
            ]}
          />
          <SettingsMenuSelectRow
            label={t('settings.input.voiceLanguage')}
            value={prefs.recognitionLanguage}
            onValueChange={(value) => void save({ recognitionLanguage: value as VoicePrefs['recognitionLanguage'] })}
            options={[
              { value: 'auto', label: t('settings.input.voiceLanguageAuto') },
              { value: 'en', label: 'English' },
              { value: 'ru', label: 'Русский' },
            ]}
          />
          <SettingsMenuSelectRow
            label={t('settings.input.voiceHotkeyMode')}
            value={prefs.hotkeyMode}
            onValueChange={(value) => void save({ hotkeyMode: value as HotkeyMode })}
            options={[
              { value: 'toggle', label: t('settings.input.voiceHotkeyToggle') },
              { value: 'ptt', label: t('settings.input.voiceHotkeyPtt') },
            ]}
          />
          <SettingsMenuSelectRow
            label={t('settings.input.voiceOverlayPosition')}
            value={prefs.overlayPosition}
            onValueChange={(value) => void save({ overlayPosition: value as OverlayPosition })}
            options={[
              { value: 'bottom', label: t('settings.input.voiceOverlayBottom') },
              { value: 'top', label: t('settings.input.voiceOverlayTop') },
            ]}
          />
          <SettingsToggle
            label={t('settings.input.voiceAsrConsent')}
            description={t('settings.input.voiceAsrConsentDesc')}
            checked={prefs.cloudAsrConsent}
            onCheckedChange={(cloudAsrConsent) => void save({ cloudAsrConsent })}
          />
          <SettingsToggle
            label={t('settings.input.voiceAutoSubmit')}
            description={t('settings.input.voiceAutoSubmitDesc')}
            checked={prefs.autoSubmit}
            onCheckedChange={(checked) => void save({ autoSubmit: checked })}
          />
          <SettingsMenuSelectRow
            label={t('settings.input.ttsEngine')}
            description={t('settings.input.ttsEngineDesc')}
            value={prefs.ttsEngine}
            onValueChange={(value) => void save({ ttsEngine: value as TtsEngine })}
            options={[
              { value: 'edge', label: t('settings.input.ttsEdge'), description: t('settings.input.ttsEdgeDesc') },
              { value: 'fish-speech', label: t('settings.input.ttsFishSpeech'), description: t('settings.input.ttsFishSpeechDesc') },
            ]}
          />
          <SettingsMenuSelectRow
            label={t('settings.input.audioRetention')}
            description={t('settings.input.audioRetentionDesc')}
            value={prefs.sttEngine === 'local-whisper' ? 'none' : prefs.audioRetention}
            onValueChange={(value) => void save({ audioRetention: value as AudioRetention })}
            options={[
              { value: 'none', label: t('settings.input.audioRetentionNone'), description: t('settings.input.audioRetentionNoneDesc') },
              { value: 'session', label: t('settings.input.audioRetentionSession') },
              { value: 'cloud-policy', label: t('settings.input.audioRetentionCloud'), description: t('settings.input.audioRetentionCloudDesc') },
            ]}
          />
          <SettingsToggle
            label={t('settings.input.wakeWord')}
            description={t('settings.input.wakeWordDesc', { phrase: prefs.wakePhrase })}
            checked={prefs.wakeWordEnabled}
            onCheckedChange={(enabled) => void save({
              wakeWordEnabled: enabled,
              alwaysListeningConsent: enabled ? prefs.alwaysListeningConsent : false,
            })}
          />
          <SettingsToggle
            label={t('settings.input.wakeWordConsent')}
            description={t('settings.input.wakeWordConsentDesc')}
            checked={prefs.alwaysListeningConsent}
            onCheckedChange={(alwaysListeningConsent) => void save({
              alwaysListeningConsent,
              wakeWordEnabled: prefs.wakeWordEnabled && alwaysListeningConsent,
            })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('settings.input.voiceGroupModels')} description={healthLabel}>
        <SettingsCard>
          <p className="px-4 py-3 text-xs text-muted-foreground">{t('settings.input.voiceModelsHint')}</p>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('settings.input.voiceGroupHistory')} description={t('settings.input.voiceHistoryDesc')}>
        <SettingsCard>
          {history.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">{t('settings.input.voiceHistoryEmpty')}</p>
          ) : history.map((item) => (
            <div key={item.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="truncate">{item.id}</span>
              <button
                type="button"
                className="text-xs text-muted-foreground"
                onClick={() => void window.electronAPI.favoriteVoiceRecording?.({ id: item.id, favorite: !item.favorite }).then(() => reload())}
              >
                {item.favorite ? t('voice.history.unfavorite') : t('voice.history.favorite')}
              </button>
            </div>
          ))}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('settings.input.voiceGroupProcessing')}>
        <SettingsCard>
          <SettingsToggle
            label={t('settings.input.voiceEnhancementConsent')}
            description={t('settings.input.voiceEnhancementConsentDesc')}
            checked={prefs.cloudEnhancementConsent}
            onCheckedChange={(cloudEnhancementConsent) => void save({ cloudEnhancementConsent })}
          />
          <SettingsToggle
            label={t('settings.input.voiceWebEnrichment')}
            description={t('settings.input.voiceWebEnrichmentDesc')}
            checked={prefs.webEnrichmentConsent}
            onCheckedChange={(webEnrichmentConsent) => void save({ webEnrichmentConsent })}
          />
          <SettingsMenuSelectRow
            label={t('settings.input.voiceEnhancementMode')}
            value={prefs.enhancementMode}
            onValueChange={(value) => void save({ enhancementMode: value as EnhancementMode })}
            options={[
              { value: 'verbatim', label: t('settings.input.voiceModeVerbatim') },
              { value: 'clean', label: t('settings.input.voiceModeClean') },
              { value: 'improve-prompt', label: t('settings.input.voiceModeImprove') },
            ]}
          />
        </SettingsCard>
      </SettingsSection>
    </>
  )
}
