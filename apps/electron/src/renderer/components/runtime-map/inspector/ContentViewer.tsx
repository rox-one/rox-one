import * as React from 'react'
import { Check, Copy, ChevronDown, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RuntimeContent, RuntimePayloadPage, RuntimePayloadQuery } from '@rox/core/runtime-trace'
import { measurementText, safeDisplayText } from '../measurements'

export type ReadRuntimePayload = (query: RuntimePayloadQuery) => Promise<RuntimePayloadPage>
export interface RuntimeContentScope { workspaceId: string; sessionId: string; rootRunId: string }
export function ContentViewer({ label, content, scope, readPayload }: { label: string; content?: RuntimeContent; scope: RuntimeContentScope; readPayload?: ReadRuntimePayload }) {
  const { t } = useTranslation()
  const [loaded, setLoaded] = React.useState('')
  const [nextOffset, setNextOffset] = React.useState<number | undefined>(0)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const generation = React.useRef(0)
  React.useEffect(() => {
    generation.current++
    setLoaded(''); setNextOffset(0); setLoading(false); setError(false); setCopied(false); setExpanded(false)
    return () => { generation.current++ }
  }, [content?.payloadRef, scope.workspaceId, scope.sessionId, scope.rootRunId])
  const inline = safeDisplayText(content?.text)
  const text = loaded || inline
  const tokens = measurementText(content?.tokens, value => value.toLocaleString())
  async function loadPage() {
    if (!content?.payloadRef || !readPayload || loading || nextOffset === undefined || loaded.length >= 262_144) return
    const currentGeneration = generation.current
    setLoading(true); setError(false)
    try {
      const page = await readPayload({ ...scope, payloadRef: content.payloadRef, offset: nextOffset, limit: 32_768 })
      if (generation.current !== currentGeneration) return
      setLoaded(previous => safeDisplayText(previous + page.text))
      setNextOffset(page.nextOffset)
      setExpanded(true)
    } catch { if (generation.current === currentGeneration) setError(true) }
    finally { if (generation.current === currentGeneration) setLoading(false) }
  }
  async function copyText() {
    try { await navigator.clipboard.writeText(safeDisplayText(text)); setCopied(true) } catch { setCopied(false) }
  }
  return <section className="runtime-content-section">
    <header><h4>{label}</h4>{tokens && <small title={content?.tokens?.state === 'known' ? content.tokens.source : undefined}>{t('runtimeMap.tokens', { value: tokens })}</small>}{text && <button className="runtime-icon-button" type="button" title={t('runtimeMap.copy')} aria-label={t('runtimeMap.copy')} onClick={copyText}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>}</header>
    {content?.availability === 'redacted' ? <p className="runtime-muted">{t('runtimeMap.redacted')}</p> : !content || content.availability === 'not-recorded' || (!text && !content.payloadRef) ? <p className="runtime-muted">{t('runtimeMap.notRecorded')}</p> : <>
      {text && <pre className="runtime-payload" data-expanded={expanded} tabIndex={0}>{expanded ? text : text.slice(0, 3000)}</pre>}
      {text.length > 3000 && !expanded && <button className="runtime-text-button" type="button" onClick={() => setExpanded(true)}><ChevronDown size={13} />{t('runtimeMap.showMore')}</button>}
      {content.payloadRef && !readPayload && <p className="runtime-muted">{t('runtimeMap.payloadUnavailable')}</p>}
      {content.payloadRef && readPayload && nextOffset !== undefined && loaded.length < 262_144 && <button className="runtime-text-button" type="button" disabled={loading} onClick={loadPage}>{loading && <LoaderCircle size={13} />}{t(loaded ? 'runtimeMap.loadNext' : 'runtimeMap.loadContent')}</button>}
      {content.truncated && <small className="runtime-muted">{t('runtimeMap.truncated')}</small>}
      {loaded.length >= 262_144 && <p className="runtime-muted">{t('runtimeMap.viewerLimit')}</p>}
      {error && <p role="alert" className="runtime-warning">{t('runtimeMap.payloadError')}</p>}
    </>}
  </section>
}
