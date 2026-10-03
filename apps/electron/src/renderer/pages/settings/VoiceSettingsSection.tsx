import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SettingsCard,
  SettingsMenuSelectRow,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'
import {
  DEEPGRAM_TRANSCRIPTION_MODEL,
  DEEPGRAM_TRANSCRIPTION_NAME,
  type AudioRetention,
  type EnhancementMode,
  type HotkeyMode,
  type OverlayPosition,
  type SttEngine,
  type TtsEngine,
  type VoiceHealth,
  type VoicePrefs,
} from '@rox/shared/voice'
import { createDesktopSettingsSession, readVoiceSettingsSnapshot, readVoiceSettingsHistory, type VoiceSettingsSnapshot, type VoiceSettingsHistory } from './desktop-settings-session'

export function VoiceSettingsSection() {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<VoicePrefs | null>(null)
  const [health, setHealth] = useState<VoiceHealth | null>(null)
  const [history, setHistory] = useState<VoiceSettingsHistory>(null)
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading')
  const session = useRef<ReturnType<typeof createDesktopSettingsSession<VoiceSettingsSnapshot>> | null>(null)
  const historySession = useRef<ReturnType<typeof createDesktopSettingsSession<VoiceSettingsHistory>> | null>(null)

  useEffect(() => {
    const current = createDesktopSettingsSession<VoiceSettingsSnapshot>(window.electronAPI,
      value => { setPrefs(value.prefs); setHealth(value.health); setState('ready') },
      error => { setState(error ? 'error' : 'unavailable') })
    const currentHistory = createDesktopSettingsSession<VoiceSettingsHistory>(window.electronAPI,
      value => { setHistory(value); setHistoryState(value === null ? 'unavailable' : 'ready') },
      () => { setHistory(null); setHistoryState('unavailable') })
    session.current = current
    historySession.current = currentHistory
    const reload = () => {
      void current.run(() => readVoiceSettingsSnapshot(window.electronAPI))
      setHistoryState('loading')
      void currentHistory.run(() => readVoiceSettingsHistory(window.electronAPI))
    }
    reload()
    current.subscribe(onChange => window.electronAPI.onVoiceChanged?.(onChange), reload)
    return () => {
      current.dispose(); currentHistory.dispose()
      if (session.current === current) session.current = null
      if (historySession.current === currentHistory) historySession.current = null
    }
  }, [])

  const save = useCallback(async (patch: Partial<VoicePrefs>) => {
    if (state !== 'ready') return
    await session.current?.run(async () => ({ prefs: await window.electronAPI.saveVoicePrefs(patch), health: health! }))
  }, [state, health])

  const favorite = useCallback(async (id: string, value: boolean) => {
    if (state !== 'ready' || historyState !== 'ready' || !history) return
    await historySession.current?.run(async isCurrent => {
      await window.electronAPI.favoriteVoiceRecording({ id, favorite: value })
      if (!isCurrent()) return null
      return readVoiceSettingsHistory(window.electronAPI)
    })
  }, [state, historyState, history])

  if (state !== 'ready' || !prefs) return (
    <SettingsSection title={t('settings.input.voiceGroupGeneral')} description={t('settings.input.voiceDesc')}>
      <SettingsCard>
        <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
          {state === 'loading' ? t('common.loading') : state === 'error' ? t('common.errorLoadingContent') : t('common.unavailable')}
        </p>
      </SettingsCard>
    </SettingsSection>
  )

  const healthLabel = (() => {
    if (prefs.sttEngine === 'cloud-rox') return t('settings.input.voiceModelEvidenceDesc', { model: health?.asrModelId ?? DEEPGRAM_TRANSCRIPTION_MODEL })
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
            description={prefs.sttEngine === 'cloud-rox'
              ? `${t('settings.input.sttEngineDesc')} · ${t('settings.input.voiceModelEvidenceDesc', { model: health?.asrModelId ?? DEEPGRAM_TRANSCRIPTION_MODEL })}`
              : `${t('settings.input.sttEngineDesc')} · ${t('settings.input.voiceLocalModelEvidenceDesc', { model: prefs.asrModelId })}`}
            value={prefs.sttEngine}
            onValueChange={(value) => void save({ sttEngine: value as SttEngine })}
            options={[
              { value: 'local-whisper', label: t('settings.input.sttLocal'), description: t('settings.input.sttLocalDesc') },
              { value: 'cloud-rox', label: DEEPGRAM_TRANSCRIPTION_NAME, description: t('meetings.local.deepgramConsent') },
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
            description={t('meetings.local.deepgramConsent')}
            checked={prefs.cloudAsrConsent}
            onCheckedChange={(cloudAsrConsent) => void save({ cloudAsrConsent, privacyMigrationPending: false })}
          />
          <SettingsToggle
            label={t('settings.input.voiceAutoSubmit')}
            description={t('settings.input.voiceAutoSubmitDesc')}
            checked={prefs.autoSubmit}
            onCheckedChange={(checked) => void save({ autoSubmit: checked })}
          />
          <SettingsMenuSelectRow
            label={t('settings.input.ttsEngine')}
            description={t(prefs.ttsEngine === 'edge' ? 'settings.input.ttsEdgeDesc' : 'settings.input.ttsSystemDesc')}
            value={prefs.ttsEngine}
            onValueChange={(value) => void save({ ttsEngine: value as TtsEngine })}
            options={[
              { value: 'system', label: t('settings.input.ttsSystem'), description: t('settings.input.ttsSystemDesc') },
              { value: 'edge', label: t('settings.input.ttsEdge'), description: t('settings.input.ttsEdgeDesc') },
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
          <p className="px-4 py-3 text-xs text-muted-foreground">{t(prefs.sttEngine === 'cloud-rox' ? 'meetings.local.deepgramConsent' : 'settings.input.voiceModelsHint')}</p>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('settings.input.voiceGroupHistory')} description={t('settings.input.voiceHistoryDesc')}>
        <SettingsCard>
          {historyState === 'loading' ? (
            <p role="status" className="px-4 py-3 text-xs text-muted-foreground">{t('common.loading')}</p>
          ) : history === null ? (
            <p role="status" className="px-4 py-3 text-xs text-muted-foreground">{t('common.unavailable')}</p>
          ) : history.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">{t('settings.input.voiceHistoryEmpty')}</p>
          ) : history.map((item) => (
            <div key={item.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="truncate">{item.id}</span>
              <button
                type="button"
                className="text-xs text-muted-foreground"
                onClick={() => void favorite(item.id, !item.favorite)}
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
