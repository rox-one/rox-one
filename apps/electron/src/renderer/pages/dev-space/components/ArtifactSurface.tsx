import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCode2, Loader2, Play, RefreshCw } from 'lucide-react'
import type { DevSpaceArtifactSummary, DevSpaceManifestEntryKind } from '@rox/shared/dev-space'
import { Markdown } from '@/components/markdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { devSpaceErrorKey } from './errors'

export interface ArtifactSurfaceProps {
  workspaceId: string
  /** Resolved project slug from `listArtifacts`; null until the list answers. */
  projectSlug: string | null
  kind: DevSpaceManifestEntryKind
  headingKey: string
  entries: readonly DevSpaceArtifactSummary[]
  stale: boolean
  /** A run is in flight; the empty-state action becomes progress, not a second start. */
  running: boolean
  onRun: () => void
}

interface ArtifactBodyProps {
  entry: DevSpaceArtifactSummary
  content: string
  encoding: 'utf8' | 'base64'
}

/** Render one artifact by its manifest format; text formats reuse the Notes markdown pipeline. */
function ArtifactBody({ entry, content, encoding }: ArtifactBodyProps) {
  if (entry.format === 'md' || entry.format === 'srt') {
    return <div className="dev-space-markdown text-sm" data-testid="dev-space-artifact-markdown"><Markdown mode="full">{content}</Markdown></div>
  }
  if (entry.format === 'svg' && encoding === 'utf8') {
    // Data-URL image keeps SVG scripts inert (no inline execution), unlike srcDoc HTML.
    return <img className="max-w-full" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`} alt={entry.path} data-testid="dev-space-artifact-svg" />
  }
  if (entry.format === 'json' && encoding === 'utf8') {
    let pretty = content
    try { pretty = JSON.stringify(JSON.parse(content), null, 2) } catch { /* keep raw body */ }
    return <pre className="max-h-[70vh] overflow-auto rounded-lg bg-surface-hover p-3 text-xs"><code data-testid="dev-space-artifact-json">{pretty}</code></pre>
  }
  return <pre className="max-h-[70vh] overflow-auto rounded-lg bg-surface-hover p-3 text-xs" data-testid="dev-space-artifact-binary"><code>{content}</code></pre>
}

/** One repo-workspace surface (§B.4–§B.8): artifact list, content, provenance and stale badge. */
export function ArtifactSurface({ workspaceId, projectSlug, kind, headingKey, entries, stale, running, onRun }: ArtifactSurfaceProps) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [content, setContent] = useState<{ id: string; content: string; encoding: 'utf8' | 'base64'; truncated: boolean; bytes: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const requestSeq = useRef(0)

  const effectiveId = selectedId && entries.some((entry) => entry.id === selectedId) ? selectedId : entries[0]?.id ?? null
  const selectedEntry = entries.find((entry) => entry.id === effectiveId) ?? null

  useEffect(() => {
    if (!workspaceId || !projectSlug || !effectiveId) { setContent(null); setErrorKey(null); setLoading(false); return }
    const seq = ++requestSeq.current
    setLoading(true); setErrorKey(null); setContent(null)
    void window.electronAPI.readDevSpaceArtifact({ workspaceId, projectSlug, artifactId: effectiveId })
      .then((result) => { if (requestSeq.current === seq) setContent({ id: result.artifact.id, content: result.content, encoding: result.encoding, truncated: result.truncated, bytes: result.byteLength }) })
      .catch((error) => { if (requestSeq.current === seq) setErrorKey(devSpaceErrorKey(error)) })
      .finally(() => { if (requestSeq.current === seq) setLoading(false) })
  }, [workspaceId, projectSlug, effectiveId, nonce])

  const headingId = `dev-space-surface-title-${kind}`
  return (
    <section className="space-y-4 rounded-[var(--radius-card)] border border-border-subtle p-5" data-testid={`dev-space-surface-${kind}`} aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 id={headingId} className="text-sm font-semibold">{t(headingKey)}</h2>
          {stale ? <Badge variant="outline" data-testid="dev-space-artifact-stale">{t('devSpace.repository.outdated')}</Badge> : null}
        </div>
        {entries.length > 1 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {t('devSpace.artifact.select')}
            <Select value={effectiveId ?? ''} onValueChange={(value) => setSelectedId(value)}>
              <SelectTrigger className="h-auto w-fit rounded-md border-border-subtle bg-background px-2 py-1 text-xs" aria-label={t('devSpace.artifact.select')} data-testid={`dev-space-artifact-select-${kind}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {entries.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.path}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-start gap-3" data-testid={`dev-space-surface-empty-${kind}`}>
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><FileCode2 className="icon-caption" aria-hidden />{t('devSpace.artifact.emptyTitle')}</div>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('devSpace.artifact.emptyDescription')}</p>
          <Button type="button" size="sm" disabled={running} onClick={onRun} data-testid={`dev-space-surface-run-${kind}`}>
            {running ? <Loader2 className="icon-caption animate-spin motion-reduce:animate-none" aria-hidden /> : <Play className="icon-caption" aria-hidden />}
            {running ? t('devSpace.repo.running') : t('devSpace.artifact.emptyAction')}
          </Button>
        </div>
      ) : loading ? (
        <div className="space-y-2" aria-busy="true" role="status" data-testid={`dev-space-surface-loading-${kind}`}>
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="icon-caption animate-spin motion-reduce:animate-none" aria-hidden />{t('devSpace.artifact.loading')}</p>
          <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-surface-hover motion-reduce:animate-none" />
        </div>
      ) : errorKey || !selectedEntry || !content || content.id !== selectedEntry.id ? (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-sm text-destructive">{t(errorKey ?? 'devSpace.artifact.error')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setNonce((value) => value + 1)} data-testid={`dev-space-surface-retry-${kind}`}><RefreshCw className="icon-caption" aria-hidden />{t('devSpace.artifact.retry')}</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="break-all font-mono">{selectedEntry.path}</span>
            <Badge variant="secondary">{selectedEntry.format}</Badge>
            <span data-testid={`dev-space-artifact-provenance-${kind}`}>{t('devSpace.artifact.provenance', { provider: selectedEntry.producedBy.providerId, version: selectedEntry.producedBy.version })}</span>
            {selectedEntry.sourceRevision ? <span className="font-mono">{selectedEntry.sourceRevision.slice(0, 12)}</span> : null}
          </div>
          {content.truncated ? <p className="text-xs text-muted-foreground" role="status" data-testid={`dev-space-artifact-truncated-${kind}`}>{t('devSpace.artifact.truncated', { bytes: content.bytes })}</p> : null}
          <ArtifactBody entry={selectedEntry} content={content.content} encoding={content.encoding} />
        </div>
      )}
    </section>
  )
}