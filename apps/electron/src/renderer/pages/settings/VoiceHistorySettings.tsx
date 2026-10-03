import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsCard, SettingsSection } from '@/components/settings'
import { createDesktopSettingsSession } from './desktop-settings-session'
import { readVoiceAudio, voiceHistoryDetail, type VoiceHistoryDetail } from './voice-history-session'

type Page = { page: Array<{ id: string; favorite: boolean; state: string }>; continueCursor: string | null; isDone: boolean }

export function VoiceHistorySettings() {
  const { t } = useTranslation()
  const [page, setPage] = useState<Page | null>(null)
  const [detail, setDetail] = useState<VoiceHistoryDetail | null>(null)
  const [search, setSearch] = useState('')
  const searchRef = useRef(search)
  searchRef.current = search
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [text, setText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const selected = useRef<string | null>(null)
  const lifecycle = useRef<ReturnType<typeof createDesktopSettingsSession<void>> | null>(null)
  const listLifecycle = useRef<ReturnType<typeof createDesktopSettingsSession<void>> | null>(null)
  const stopAudio = () => {
    audioRef.current?.pause()
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
    setAudioUrl(null)
  }
  const loadPage = (cursor?: string) => {
    setLoading(true); setError(false)
    void listLifecycle.current?.run(async isCurrent => {
      const next = await window.electronAPI.listVoiceHistory({ search: searchRef.current, cursor, limit: 20 })
      if (!isCurrent()) return
      if (!next || !Array.isArray(next.page) || next.page.some(item => !item || typeof item !== 'object' || typeof (item as { id?: unknown }).id !== 'string' || typeof (item as { favorite?: unknown }).favorite !== 'boolean' || typeof (item as { state?: unknown }).state !== 'string')) throw new Error('Invalid history page')
      setPage(next as Page); setLoading(false)
    })
  }
  useEffect(() => {
    const unavailable = () => { setError(true); setLoading(false); setBusy(false) }
    const own = createDesktopSettingsSession<void>(window.electronAPI, () => {}, unavailable)
    const lists = createDesktopSettingsSession<void>(window.electronAPI, () => {}, unavailable)
    lifecycle.current = own; listLifecycle.current = lists
    lists.subscribe(onChange => window.electronAPI.onVoiceJob?.(() => onChange()), () => loadPage())
    return () => {
      selected.current = null; own.dispose(); lists.dispose()
      audioRef.current?.pause()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      lifecycle.current = null; listLifecycle.current = null
    }
  }, [])
  useEffect(() => { loadPage() }, [search])
  const open = (id: string) => {
    selected.current = id; stopAudio(); setDetail(null); setConfirmDelete(false); setBusy(true); setError(false)
    void lifecycle.current?.run(async isCurrent => {
      const next = voiceHistoryDetail(await window.electronAPI.getVoiceHistoryItem({ id }), id)
      if (!isCurrent() || selected.current !== id) return
      setDetail(next)
      setText(next.revisions.find(item => item.id === next.recording.selectedRevisionId)?.text ?? '')
      setBusy(false)
    })
  }
  const mutate = (operation: () => Promise<unknown>) => {
    const id = selected.current
    if (!id || busy) return
    setBusy(true); setError(false)
    void lifecycle.current?.run(async isCurrent => {
      await operation()
      if (!isCurrent() || selected.current !== id) return
      const next = voiceHistoryDetail(await window.electronAPI.getVoiceHistoryItem({ id }), id)
      if (!isCurrent() || selected.current !== id) return
      setDetail(next); setText(next.revisions.find(item => item.id === next.recording.selectedRevisionId)?.text ?? ''); setBusy(false)
      loadPage()
    })
  }
  const remove = () => {
    const id = selected.current
    if (!id || busy) return
    setBusy(true); stopAudio(); setError(false)
    void lifecycle.current?.run(async isCurrent => {
      await window.electronAPI.deleteVoiceRecording({ id })
      if (!isCurrent() || selected.current !== id) return
      selected.current = null; setDetail(null); setBusy(false); setConfirmDelete(false); loadPage()
    })
  }
  const play = () => {
    const id = selected.current
    if (!id || busy) return
    setBusy(true); setError(false); stopAudio()
    void lifecycle.current?.run(async isCurrent => {
      const blob = await readVoiceAudio(window.electronAPI, id, () => isCurrent() && selected.current === id)
      if (!blob || !isCurrent() || selected.current !== id) return
      const url = URL.createObjectURL(blob); urlRef.current = url; setAudioUrl(url); setBusy(false)
    })
  }
  const exportText = (format: 'txt' | 'json' | 'srt') => {
    const id = selected.current
    if (!id || busy) return
    setBusy(true); setError(false)
    void lifecycle.current?.run(async isCurrent => {
      const result = await window.electronAPI.exportVoiceRecording({ id, format })
      if (!isCurrent() || selected.current !== id) return
      if (typeof result.text !== 'string') throw new Error('Invalid voice export')
      const url = URL.createObjectURL(new Blob([result.text], { type: format === 'json' ? 'application/json' : 'text/plain;charset=utf-8' }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `voice-${id}.${format}`; anchor.click()
      URL.revokeObjectURL(url); setBusy(false)
    })
  }
  const copy = () => {
    const id = selected.current
    if (!id || busy || !text.trim()) return
    setBusy(true); setError(false)
    void lifecycle.current?.run(async isCurrent => {
      await window.electronAPI.copyVoiceText({ text })
      if (isCurrent() && selected.current === id) setBusy(false)
    })
  }
  const revisionId = detail?.recording.selectedRevisionId
  const hasTimestamps = Boolean(detail?.revisions.find(item => item.id === revisionId)?.segments.length)
  return <SettingsSection title={t('settings.input.voiceGroupHistory')} description={t('settings.input.voiceHistoryDesc')}>
    <SettingsCard>
      <div className="space-y-3 px-4 py-3">
        <label className="block text-sm">{t('voice.history.search')}<input aria-label={t('voice.history.search')} className="mt-1 w-full rounded border bg-transparent px-2 py-1" value={search} onChange={event => setSearch(event.target.value)} /></label>
        {error && <p role="alert">{t('common.errorLoadingContent')} <button type="button" onClick={() => selected.current ? open(selected.current) : loadPage()}>{t('voice.history.reload')}</button></p>}
        {loading && <p role="status">{t('common.loading')}</p>}
        {!loading && page?.page.length === 0 && <p>{t('settings.input.voiceHistoryEmpty')}</p>}
        {page?.page.map(item => <div key={item.id} className="flex items-center justify-between gap-2 text-sm">
          <button type="button" aria-pressed={selected.current === item.id} onClick={() => open(item.id)} className="truncate">{item.id}</button>
          <button type="button" disabled={busy} onClick={() => { selected.current = item.id; stopAudio(); setDetail(null); setConfirmDelete(false); mutate(() => window.electronAPI.favoriteVoiceRecording({ id: item.id, favorite: !item.favorite })) }}>{t(item.favorite ? 'voice.history.unfavorite' : 'voice.history.favorite')}</button>
        </div>)}
        {page && !page.isDone && page.continueCursor && <button type="button" disabled={loading} onClick={() => loadPage(page.continueCursor!)}>{t('voice.history.next')}</button>}
        {detail && <div className="space-y-3 border-t pt-3" aria-label={t('voice.history.detail')}>
          <label>{t('voice.history.revision')}<select aria-label={t('voice.history.revision')} value={revisionId ?? ''} disabled={busy} onChange={event => { const chosenRevisionId = event.target.value; mutate(() => window.electronAPI.selectVoiceTranscript({ id: detail.recording.id, expectedRevisionId: revisionId!, revisionId: chosenRevisionId })) }}>
            {detail.revisions.map(revision => <option key={revision.id} value={revision.id}>{revision.kind} · {new Date(revision.createdAt).toLocaleString()}</option>)}
          </select></label>
          <textarea aria-label={t('voice.history.transcript')} value={text} onChange={event => setText(event.target.value)} className="min-h-32 w-full rounded border bg-transparent p-2" disabled={busy} />
          <div className="flex flex-wrap gap-3 text-sm">
            <button type="button" disabled={busy || !revisionId || !text.trim()} onClick={() => mutate(() => window.electronAPI.editVoiceTranscript({ id: detail.recording.id, expectedRevisionId: revisionId!, text }))}>{t('voice.history.saveRevision')}</button>
            <button type="button" disabled={busy || !text.trim()} onClick={copy}>{t('voice.history.copy')}</button>
            <button type="button" disabled={busy} onClick={play}>{t('voice.history.play')}</button>
            {(['txt', 'json', 'srt'] as const).map(format => <button type="button" key={format} disabled={busy || (format === 'srt' && !hasTimestamps)} onClick={() => exportText(format)}>{t('voice.history.export')} {format.toUpperCase()}</button>)}
            <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>{t('voice.history.delete')}</button>
          </div>
          {!hasTimestamps && <p className="text-xs text-muted-foreground">{t('voice.history.noTimestamps')}</p>}
          {audioUrl && <audio ref={audioRef} src={audioUrl} controls autoPlay onError={() => { stopAudio(); setError(true) }} />}
          {confirmDelete && <div role="alert"><p>{t('voice.history.confirmDelete')}</p><button type="button" disabled={busy} onClick={remove}>{t('voice.history.delete')}</button> <button type="button" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button></div>}
        </div>}
      </div>
    </SettingsCard>
  </SettingsSection>
}
