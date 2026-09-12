import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SettingsCard,
  SettingsMenuSelectRow,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'
import type { AudioRetention, SttEngine, TtsEngine, VoiceHealth, VoicePrefs } from '@craft-agent/shared/voice'

export function VoiceSettingsSection() {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<VoicePrefs | null>(null)
  const [health, setHealth] = useState<VoiceHealth | null>(null)

  const reload = useCallback(async () => {
    if (!window.electronAPI.getVoicePrefs) return
    const [nextPrefs, nextHealth] = await Promise.all([
      window.electronAPI.getVoicePrefs(),
      window.electronAPI.getVoiceHealth(),
    ])
    setPrefs(nextPrefs)
    setHealth(nextHealth)
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
    <SettingsSection title={t('settings.input.voice')} description={t('settings.input.voiceDesc')}>
      <SettingsCard>
        <SettingsMenuSelectRow
          label={t('settings.input.sttEngine')}
          description={t('settings.input.sttEngineDesc')}
          value={prefs.sttEngine}
          onValueChange={(value) => void save({ sttEngine: value as SttEngine })}
          options={[
            { value: 'local-whisper', label: t('settings.input.sttLocal'), description: t('settings.input.sttLocalDesc') },
            { value: 'cloud-rox', label: t('settings.input.sttCloudRox'), description: t('settings.input.sttCloudRoxDesc') },
            { value: 'cloud-deepgram', label: t('settings.input.sttCloudDeepgram'), description: t('settings.input.sttCloudDeepgramDesc') },
          ]}
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
            wakeWordEnabled: enabledAndConsent(prefs.wakeWordEnabled, alwaysListeningConsent),
          })}
        />
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          {healthLabel}
          {health?.offline ? ` · ${t('settings.input.voiceOffline')}` : ''}
          {health?.localBackend === 'whisper-large-v3-turbo-mlx'
            ? ' · MLX'
            : ' · CPU'}
        </p>
      </SettingsCard>
    </SettingsSection>
  )
}

function enabledAndConsent(enabled: boolean, consent: boolean): boolean {
  return enabled && consent
}
