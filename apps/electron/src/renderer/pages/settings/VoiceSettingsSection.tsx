import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SettingsCard,
  SettingsMenuSelectRow,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'
import type {
  AudioRetention,
  SttEngine,
  TtsEngine,
  VoiceDelivery,
  VoiceExportFormat,
  VoiceHealth,
  VoiceOverlayPosition,
  VoicePrefs,
  VoiceRecognitionLanguage,
  VoiceRecording,
} from '@craft-agent/shared/voice'

function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return ''
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function decodeAudio(base64: string, mimeType: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: mimeType || 'audio/webm' }))
}

export function VoiceSettingsSection() {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<VoicePrefs | null>(null)
  const [health, setHealth] = useState<VoiceHealth | null>(null)
  const [recordings, setRecordings] = useState<VoiceRecording[]>([])
  const [devices, setDevices] = useState<Array<{ id: string; label: string }>>([])
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  const reload = useCallback(async () => {
    if (!window.electronAPI.getVoicePrefs) return
    const [nextPrefs, nextHealth, listed] = await Promise.all([
      window.electronAPI.getVoicePrefs(),
      window.electronAPI.getVoiceHealth(),
      window.electronAPI.listVoiceRecordings?.() ?? Promise.resolve([]),
    ])
    setPrefs(nextPrefs)
    setHealth(nextHealth)
    setRecordings(listed ?? [])
  }, [])

  useEffect(() => {
    void reload()
    const off = window.electronAPI.onVoiceChanged?.(() => {
      void reload()
    })
    const offCapture = window.electronAPI.onVoiceCaptureChanged?.(() => {
      void window.electronAPI.listVoiceRecordings?.().then(setRecordings)
    })
    return () => {
      off?.()
      offCapture?.()
    }
  }, [reload])

  useEffect(() => {
    const loadDevices = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return
      const listed = await navigator.mediaDevices.enumerateDevices()
      setDevices(
        listed
          .filter((device) => device.kind === 'audioinput')
          .map((device) => ({ id: device.deviceId, label: device.label || device.deviceId })),
      )
    }
    void loadDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', loadDevices)
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', loadDevices)
    }
  }, [])

  useEffect(() => () => {
    audioRef.current?.pause()
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  const save = useCallback(async (patch: Partial<VoicePrefs>) => {
    const next = await window.electronAPI.saveVoicePrefs(patch)
    setPrefs(next)
    void window.electronAPI.rebindVoiceHotkeys?.()
  }, [])

  const playRecording = useCallback(async (id: string) => {
    if (!window.electronAPI.getVoiceRecordingAudio) return
    if (playingId === id) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }
    const payload = await window.electronAPI.getVoiceRecordingAudio({ id })
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const url = decodeAudio(payload.audioBase64, payload.mimeType)
    objectUrlRef.current = url
    audioRef.current?.pause()
    const audio = new Audio(url)
    audioRef.current = audio
    setPlayingId(id)
    audio.onended = () => setPlayingId(null)
    await audio.play()
  }, [playingId])

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
    <SettingsSection title={t('settings.input.voice')} description={t('settings.input.voiceDesc')}>
      <SettingsCard>
        <SettingsMenuSelectRow
          label={t('settings.input.sttEngine')}
          description={t('settings.input.sttEngineDesc')}
          value={prefs.sttEngine}
          onValueChange={(value) => void save({ sttEngine: value as SttEngine })}
          options={[
            { value: 'local-whisper', label: t('settings.input.sttLocal'), description: t('settings.input.sttLocalDesc') },
            { value: 'cloud-rox', label: health?.cloudDisplayName || t('settings.input.sttCloudRox'), description: t('settings.input.sttCloudRoxDesc') },
            { value: 'cloud-deepgram', label: t('settings.input.sttCloudDeepgram'), description: t('settings.input.sttCloudDeepgramDesc') },
          ]}
        />
        <SettingsMenuSelectRow
          label={t('settings.input.voiceDevice')}
          description={t('settings.input.voiceDeviceDesc')}
          value={prefs.selectedInputDeviceId || '__default__'}
          onValueChange={(value) => void save({ selectedInputDeviceId: value === '__default__' ? null : value })}
          options={[
            { value: '__default__', label: t('settings.input.voiceDeviceDefault') },
            ...devices.map((device) => ({ value: device.id, label: device.label })),
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
          value={prefs.audioRetention}
          onValueChange={(value) => void save({ audioRetention: value as AudioRetention })}
          options={[
            { value: 'none', label: t('settings.input.audioRetentionNone'), description: t('settings.input.audioRetentionNoneDesc') },
            { value: 'session', label: t('settings.input.audioRetentionSession'), description: t('settings.input.audioRetentionSessionDesc') },
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
        <SettingsToggle
          label={t('settings.input.voiceOverlay')}
          description={t('settings.input.voiceOverlayDesc')}
          checked={prefs.overlayEnabled}
          onCheckedChange={(overlayEnabled) => void save({ overlayEnabled })}
        />
        <SettingsMenuSelectRow
          label={t('settings.input.voiceOverlayPosition')}
          value={prefs.overlayPosition}
          onValueChange={(value) => void save({ overlayPosition: value as VoiceOverlayPosition })}
          options={[
            { value: 'top', label: t('settings.input.voiceOverlayTop') },
            { value: 'bottom', label: t('settings.input.voiceOverlayBottom') },
          ]}
        />
        <SettingsMenuSelectRow
          label={t('settings.input.voiceLanguage')}
          value={prefs.recognitionLanguage}
          onValueChange={(value) => void save({ recognitionLanguage: value as VoiceRecognitionLanguage })}
          options={[
            { value: 'auto', label: t('settings.input.voiceLanguageAuto') },
            { value: 'en', label: t('settings.input.voiceLanguageEn') },
            { value: 'ru', label: t('settings.input.voiceLanguageRu') },
          ]}
        />
        <SettingsMenuSelectRow
          label={t('settings.input.voiceDelivery')}
          value={prefs.delivery}
          onValueChange={(value) => void save({ delivery: value as VoiceDelivery })}
          options={[
            { value: 'draft', label: t('settings.input.voiceDeliveryDraft') },
            { value: 'clipboard', label: t('settings.input.voiceDeliveryClipboard') },
          ]}
        />
        <SettingsToggle
          label={t('settings.input.voiceTrailingSpace')}
          checked={prefs.trailingSpace}
          onCheckedChange={(trailingSpace) => void save({ trailingSpace })}
        />
        <SettingsMenuSelectRow
          label={t('settings.input.voiceHotkeyPtt')}
          description={t('settings.input.voicePttHint')}
          value={prefs.pttModifier}
          onValueChange={(value) => void save({ pttModifier: value as VoicePrefs['pttModifier'] })}
          options={[
            { value: 'AltRight', label: t('settings.input.voicePttAltRight') },
            { value: 'ControlRight', label: t('settings.input.voicePttControlRight') },
            { value: 'none', label: t('settings.input.voicePttNone') },
          ]}
        />
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          {t('settings.input.voiceHotkeyToggle')}: ⌘⇧D
          {' · '}
          {t('settings.input.voiceHotkeyCancel')}: ⌘⇧Esc
          {' · '}
          {health?.cloudDisplayName ? `${health.cloudDisplayName} · ` : ''}
          {health?.languageLabel ? `${health.languageLabel} · ` : ''}
          {healthLabel}
          {health?.offline ? ` · ${t('settings.input.voiceOffline')}` : ''}
          {health?.localBackend === 'whisper-large-v3-turbo-mlx'
            ? ' · MLX'
            : ' · CPU'}
        </p>
      </SettingsCard>
    </SettingsSection>
    <SettingsSection title={t('settings.input.voiceHistory')} description={t('settings.input.voiceHistoryDesc')}>
      <SettingsCard>
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('settings.input.voiceHistorySearch')}
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
          <button
            type="button"
            className="shrink-0 text-xs text-muted-foreground underline"
            onClick={() => {
              void window.electronAPI.getVoiceArchiveDir?.().then((dir) => {
                if (dir?.path) void window.electronAPI.showInFolder(dir.path)
              })
            }}
          >
            {t('settings.input.voiceArchiveOpen')}
          </button>
        </div>
        {recordings.length === 0 ? (
          <p className="px-4 pb-3 text-xs text-muted-foreground">{t('settings.input.voiceHistoryEmpty')}</p>
        ) : recordings.filter((item) => {
          const haystack = `${item.result?.text ?? ''} ${(item.revisions ?? []).map((revision) => revision.text).join(' ')} ${item.status}`.toLowerCase()
          return haystack.includes(query.trim().toLowerCase())
        }).map((item) => (
          <div key={item.id} className="flex items-start justify-between gap-3 border-t px-4 py-3 text-sm">
            <div className="min-w-0">
              {editingId === item.id ? (
                <textarea
                  className="w-full resize-y bg-transparent text-sm outline-none"
                  value={editText}
                  onChange={(event) => setEditText(event.target.value)}
                  rows={2}
                />
              ) : (
                <p className="truncate">{item.favorite ? '★ ' : ''}{item.result?.text || item.status}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {item.createdAt}
                {item.durationMs ? ` · ${formatDuration(item.durationMs)}` : ''}
                {` · ${item.status}`}
                {item.revisions && item.revisions.length > 1 ? ` · ${item.revisions.length}` : ''}
              </p>
              {item.revisions && item.revisions.length > 1 ? (
                <select
                  className="mt-1 max-w-full bg-transparent text-xs"
                  value={item.selectedRevisionId}
                  onChange={(event) => {
                    void window.electronAPI.selectVoiceRevision?.({ id: item.id, revisionId: event.target.value })
                      .then(() => window.electronAPI.listVoiceRecordings?.().then(setRecordings))
                  }}
                >
                  {item.revisions.map((revision, index) => (
                    <option key={revision.id} value={revision.id}>
                      {t('settings.input.voiceHistoryRevision')} {index + 1}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2 text-xs">
              {item.audioAvailable ? (
                <button type="button" onClick={() => void playRecording(item.id)}>
                  {playingId === item.id ? t('settings.input.voiceHistoryPause') : t('settings.input.voiceHistoryPlay')}
                </button>
              ) : null}
              <button type="button" onClick={() => {
                const text = item.result?.text
                if (text) void navigator.clipboard.writeText(text)
              }}>{t('settings.input.voiceHistoryCopy')}</button>
              {editingId === item.id ? (
                <button type="button" onClick={() => {
                  void window.electronAPI.editVoiceTranscript?.({ id: item.id, text: editText })
                    .then(() => {
                      setEditingId(null)
                      return window.electronAPI.listVoiceRecordings?.().then(setRecordings)
                    })
                }}>{t('settings.input.voiceHistorySave')}</button>
              ) : (
                <button type="button" onClick={() => {
                  setEditingId(item.id)
                  setEditText(item.result?.text ?? '')
                }}>{t('settings.input.voiceHistoryEdit')}</button>
              )}
              {item.audioAvailable ? (
                <button type="button" onClick={() => {
                  void window.electronAPI.retranscribeVoiceRecording?.({ id: item.id })
                    .then(() => window.electronAPI.listVoiceRecordings?.().then(setRecordings))
                }}>{t('settings.input.voiceHistoryRetranscribe')}</button>
              ) : null}
              {(['txt', 'json', 'srt'] as VoiceExportFormat[]).map((format) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => {
                    void window.electronAPI.exportVoiceRecording?.({ id: item.id, format })
                      .then((exported) => {
                        if (exported?.path) void window.electronAPI.showInFolder(exported.path)
                      })
                  }}
                >
                  {format === 'txt'
                    ? t('settings.input.voiceHistoryExportTxt')
                    : format === 'json'
                      ? t('settings.input.voiceHistoryExportJson')
                      : t('settings.input.voiceHistoryExportSrt')}
                </button>
              ))}
              <button type="button" onClick={() => {
                void window.electronAPI.favoriteVoiceRecording?.({ id: item.id, favorite: !item.favorite })
                  .then(() => window.electronAPI.listVoiceRecordings?.().then(setRecordings))
              }}>{t('settings.input.voiceHistoryFavorite')}</button>
              <button type="button" onClick={() => {
                void window.electronAPI.deleteVoiceRecording?.({ id: item.id })
                  .then(() => window.electronAPI.listVoiceRecordings?.().then(setRecordings))
              }}>{t('settings.input.voiceHistoryDelete')}</button>
            </div>
          </div>
        ))}
      </SettingsCard>
    </SettingsSection>
    </>
  )
}

function enabledAndConsent(enabled: boolean, consent: boolean): boolean {
  return enabled && consent
}
