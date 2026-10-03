import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, FileCode2, FolderGit2, Loader2, RefreshCw, X } from 'lucide-react'
import type { FileSpan, RepositoryFreshness, RepositoryConnectionInspection, RepositoryPreviewInput, RepositoryPreview, RepositoryProjectInput, RepositorySnapshotSummary } from '@rox/shared/code-intelligence'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface RepositorySnapshotPanelProps {
  workspaceId: string
  projectId: string
  /** Display/availability only. The native handler resolves the saved project directory. */
  workingDirectory?: string
}
type Operation = 'preview' | 'list' | 'bind' | 'capture' | 'freshness' | 'span'
interface ActiveRequest { input: RepositoryProjectInput; scopeKey: string; operation: Operation }
const EMPTY: RepositoryConnectionInspection = { binding: null, snapshots: [], connection: null, historicalSnapshots: [] }
const INITIAL_DRAFT = { branch: '', includes: '**', excludes: '.env\n.env.*\n**/.env\n**/.env.*\n**/*.pem\n**/*.key\n**/.codegraph/**', maxFileBytes: '262144', maxBytes: '16777216', maxFiles: '10000' }
const SELECT_CLASS = 'w-full rounded-md border border-foreground/10 bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

/** Convert transport errors to localized categories without exposing raw host paths or error text. */
export function repositoryErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/AUTH_FAILED|accessDenied|scope-denied/.test(message)) return 'codeIntelligence.repository.accessDenied'
  if (/project-directory-missing/.test(message)) return 'codeIntelligence.repository.directoryRequired'
  if (/git-unavailable-or-invalid-repository|not-a-git-repository|invalid-git-identity/.test(message)) return 'codeIntelligence.repository.gitRequired'
  if (/root-missing|allowed-root-missing|workspace-missing|project-missing|ENOENT/.test(message)) return 'codeIntelligence.repository.unavailable'
  if (/repository-not-bound|preview-required/.test(message)) return 'codeIntelligence.repository.approvalRequired'
  if (/invalid-connection-configuration|invalid-includes|invalid-exclusion|invalid-branch/.test(message)) return 'codeIntelligence.repository.invalidConfiguration'
  if (/project-directory-changed|root-changed|snapshot-policy-changed|source-changed-during-capture|repository-policy-changed|repository-preview-stale|repository-branch-changed/.test(message)) return 'codeIntelligence.repository.changed'
  if (/invalid-limit|line-range-missing|excerpt-byte-limit/.test(message)) return 'codeIntelligence.repository.invalidRange'
  if (/snapshot-history-limit|file-count-limit|record-byte-limit|request-limit/.test(message)) return 'codeIntelligence.repository.limitReached'
  if (/path-excluded|snapshot-file-missing|invalid-path|metadata-path-denied|path-escape|root-denied/.test(message)) return 'codeIntelligence.repository.pathDenied'
  if (/request-cancelled/.test(message)) return 'codeIntelligence.repository.cancelled'
  return 'codeIntelligence.repository.failed'
}

export function RepositorySnapshotPanel({ workspaceId, projectId, workingDirectory }: RepositorySnapshotPanelProps) {
  const { t, i18n } = useTranslation()
  const scopeKey = JSON.stringify([workspaceId, projectId, workingDirectory ?? ''])
  const liveScope = useRef(scopeKey)
  liveScope.current = scopeKey
  const active = useRef<ActiveRequest | null>(null)
  const [inspection, setInspection] = useState<RepositoryConnectionInspection>(EMPTY)
  const [preview, setPreview] = useState<RepositoryPreview | null>(null)
  const [draft, setDraft] = useState(INITIAL_DRAFT)
  const [snapshotId, setSnapshotId] = useState('')
  const [path, setPath] = useState('')
  const [startLine, setStartLine] = useState('1')
  const [endLine, setEndLine] = useState('1')
  const [span, setSpan] = useState<FileSpan | null>(null)
  const [freshness, setFreshness] = useState<{ snapshotId: string; value: RepositoryFreshness } | null>(null)
  const [busy, setBusy] = useState<Operation | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const allSnapshots = [...inspection.snapshots, ...inspection.historicalSnapshots]
  const selected = allSnapshots.find(snapshot => snapshot.id === snapshotId)
  const selectedFile = selected?.files.find(file => file.path === path)
  const hasDirectory = Boolean(workingDirectory?.trim())
  const approved = inspection.connection
  const patterns = (value: string) => [...new Set(value.split('\n').map(pattern => pattern.trim()).filter(Boolean))].sort().join('\n')
  const approvedDraft = Boolean(approved && inspection.binding && draft.branch.trim() === approved.approvedBranch
    && patterns(draft.includes) === [...approved.includes].sort().join('\n') && patterns(draft.excludes) === [...approved.excludes].sort().join('\n')
    && Number(draft.maxFileBytes) === approved.maxFileBytes && Number(draft.maxBytes) === approved.maxBytes && Number(draft.maxFiles) === approved.maxFiles)

  const cancelActive = useCallback(() => {
    const request = active.current
    active.current = null
    if (request) void window.electronAPI.cancelProjectRepositoryRequest(request.input).catch(() => undefined)
  }, [])
  const request = useCallback(async <T,>(operation: Operation,
    invoke: (input: RepositoryProjectInput) => Promise<T>, apply: (result: T) => void) => {
    cancelActive()
    const current: ActiveRequest = { input: { workspaceId, projectId, requestId: crypto.randomUUID() }, scopeKey, operation }
    active.current = current
    setBusy(operation)
    setErrorKey(null)
    try {
      const result = await invoke(current.input)
      if (active.current === current && liveScope.current === current.scopeKey) apply(result)
    } catch (error) {
      if (active.current === current && liveScope.current === current.scopeKey) setErrorKey(repositoryErrorKey(error))
    } finally {
      if (active.current === current && liveScope.current === current.scopeKey) { active.current = null; setBusy(null) }
    }
  }, [cancelActive, workspaceId, projectId, scopeKey])
  const refresh = useCallback(() => request('list', input => window.electronAPI.listProjectRepositorySnapshots(input), result => {
    setInspection(result)
    if (result.connection) { const c = result.connection; setDraft({ branch: c.approvedBranch, includes: c.includes.join('\n'), excludes: c.excludes.join('\n'), maxFileBytes: String(c.maxFileBytes), maxBytes: String(c.maxBytes), maxFiles: String(c.maxFiles) }) }
    setSnapshotId(previous => [...result.snapshots, ...result.historicalSnapshots].some(snapshot => snapshot.id === previous) ? previous : result.snapshots[0]?.id ?? '')
    setFreshness(null)
    setSpan(null)
  }), [request])

  useEffect(() => {
    cancelActive()
    setInspection(EMPTY); setPreview(null); setDraft(INITIAL_DRAFT); setSnapshotId(''); setPath(''); setSpan(null); setFreshness(null)
    setStartLine('1'); setEndLine('1'); setErrorKey(null); setBusy(null)
    if (hasDirectory) void refresh()
    return cancelActive
  }, [scopeKey, hasDirectory, refresh, cancelActive])
  useEffect(() => {
    setPath(selected?.files[0]?.path ?? '')
    setSpan(null); setFreshness(null); setStartLine('1'); setEndLine('1')
  }, [snapshotId])

  const updateDraft = (key: keyof typeof draft, value: string) => { setDraft(previous => ({ ...previous, [key]: value })); setPreview(null) }
  const previewInventory = () => {
    const configuration: RepositoryPreviewInput['configuration'] = {
      ...(draft.branch.trim() ? { approvedBranch: draft.branch.trim() } : {}), includes: draft.includes.split('\n').map(value => value.trim()).filter(Boolean),
      excludes: draft.excludes.split('\n').map(value => value.trim()).filter(Boolean), maxFileBytes: Number(draft.maxFileBytes),
      maxBytes: Number(draft.maxBytes), maxFiles: Number(draft.maxFiles), readOnly: true, connectionRef: null,
    }
    setPreview(null)
    return request('preview', input => window.electronAPI.previewProjectRepository({ ...input, ...(configuration ? { configuration } : {}) }), value => {
      setPreview(value)
      const c = value.configuration
      setDraft({ branch: c.approvedBranch, includes: c.includes.join('\n'), excludes: c.excludes.join('\n'), maxFileBytes: String(c.maxFileBytes), maxBytes: String(c.maxBytes), maxFiles: String(c.maxFiles) })
    })
  }
  const bind = () => {
    if (!preview) { setErrorKey('codeIntelligence.repository.approvalRequired'); return }
    return request('bind', input => window.electronAPI.bindProjectRepository({ ...input, configuration: preview.configuration,
      previewFingerprint: preview.previewFingerprint, expectedPolicyFingerprint: preview.expectedPolicyFingerprint }), binding => {
      setInspection(previous => ({ ...previous, binding })); setPreview(null)
      queueMicrotask(() => { if (liveScope.current === scopeKey) void refresh() })
    })
  }
  const capture = () => request('capture', input => window.electronAPI.captureProjectRepository(input), snapshot => {
    // Read back the binding with an independent cancellable list request after the capture receipt arrives.
    setInspection(previous => ({ ...previous, snapshots: [snapshot, ...previous.snapshots.filter(item => item.id !== snapshot.id)] }))
    setSnapshotId(snapshot.id); setSpan(null); setFreshness(null)
    queueMicrotask(() => { if (liveScope.current === scopeKey) void refresh() })
  })
  const checkFreshness = () => {
    if (!selected || !inspection.snapshots.some(snapshot => snapshot.id === selected.id)) return
    const id = selected.id
    void request('freshness', input => window.electronAPI.checkProjectRepositoryFreshness({ ...input, snapshotId: id }), value => {
      setFreshness({ snapshotId: id, value })
    })
  }
  const readSpan = (event: FormEvent) => {
    event.preventDefault()
    if (!selected || !selectedFile) return
    const first = Number(startLine), last = Number(endLine)
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last - first > 499) {
      setErrorKey('codeIntelligence.repository.invalidRange'); return
    }
    setSpan(null)
    void request('span', input => window.electronAPI.readProjectRepositorySpan({ ...input, snapshotId: selected.id, policyHash: selected.policyHash, path, startLine: first, endLine: last }), setSpan)
  }
  const cancel = () => { cancelActive(); setBusy(null); setErrorKey('codeIntelligence.repository.cancelled') }
  const status = freshness && selected && freshness.snapshotId === selected.id ? freshness.value.state : 'unchecked'
  const formatTime = (time: number) => new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' }).format(time)

  return (
    <section className="space-y-4 rounded-xl border border-foreground/10 p-4" data-testid="repository-snapshot-panel" aria-labelledby="repository-snapshot-title" aria-busy={busy !== null}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 id="repository-snapshot-title" className="flex items-center gap-2 text-sm font-semibold"><FolderGit2 className="size-4" aria-hidden />{t('codeIntelligence.repository.title')}</h3>
          <p className="max-w-2xl text-xs text-muted-foreground">{t('codeIntelligence.repository.description')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={!hasDirectory || busy !== null}><RefreshCw className="size-3.5" aria-hidden />{t('codeIntelligence.repository.refresh')}</Button>
          <Button type="button" variant="outline" size="sm" data-testid="repository-bind-button" onClick={() => void bind()} disabled={!hasDirectory || !preview || busy !== null}>{t('codeIntelligence.repository.bind')}</Button>
          <Button type="button" size="sm" data-testid="repository-capture-button" onClick={() => void capture()} disabled={!hasDirectory || !approvedDraft || busy !== null}>{t('codeIntelligence.repository.capture')}</Button>
        </div>
      </div>
      {hasDirectory && <div className="space-y-3 border-t border-foreground/10 pt-3" data-testid="repository-connection-form">
        <p className="text-xs text-muted-foreground">{t('codeIntelligence.repository.localConnection')}</p>
        <label className="block space-y-1.5 text-xs font-medium"><span>{t('codeIntelligence.repository.approvedBranch')}</span><Input data-testid="repository-approved-branch" value={draft.branch} placeholder={t('codeIntelligence.repository.branchPlaceholder')} disabled={busy !== null} onChange={event => updateDraft('branch', event.target.value)} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-xs font-medium"><span className="block">{t('codeIntelligence.repository.includes')}</span><textarea className={SELECT_CLASS} data-testid="repository-includes" rows={3} value={draft.includes} disabled={busy !== null} onChange={event => updateDraft('includes', event.target.value)} /></label>
          <label className="space-y-1.5 text-xs font-medium"><span className="block">{t('codeIntelligence.repository.excludes')}</span><textarea className={SELECT_CLASS} data-testid="repository-excludes" rows={3} value={draft.excludes} disabled={busy !== null} onChange={event => updateDraft('excludes', event.target.value)} /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">{([
          ['maxFileBytes', 'max-file-bytes', 262144], ['maxBytes', 'max-bytes', 16777216], ['maxFiles', 'max-files', 10000],
        ] as const).map(([key, testId, max]) => <label key={key} className="space-y-1.5 text-xs font-medium"><span className="block">{t(`codeIntelligence.repository.${key}`)}</span><Input type="number" min={1} max={max} step={1} data-testid={`repository-${testId}`} value={draft[key]} disabled={busy !== null} onChange={event => updateDraft(key, event.target.value)} /></label>)}</div>
        <Button type="button" size="sm" variant="outline" data-testid="repository-preview-button" disabled={busy !== null} onClick={() => void previewInventory()}>{t('codeIntelligence.repository.preview')}</Button>
        {preview && <div className="space-y-2 rounded-md border border-foreground/10 p-3 text-xs" data-testid="repository-preview">
          <p className="break-all font-mono" data-testid="repository-preview-root">{preview.binding.canonicalRoot}</p>
          <SnapshotDetails snapshot={preview.inventory} />
          <p className="break-all">{t('codeIntelligence.repository.previewFingerprint')}: <span className="font-mono" data-testid="repository-preview-fingerprint">{preview.previewFingerprint}</span></p>
          <p className="break-all">{t('codeIntelligence.repository.policyFingerprint')}: <span className="font-mono">{preview.inventory.policyHash}</span></p>
          <details><summary>{t('codeIntelligence.repository.inventory')}</summary><ul className="mt-2 max-h-40 space-y-1 overflow-auto">{preview.inventory.files.map(file => <li key={file.id} className="break-all font-mono">{file.path} · {file.bytes} B</li>)}{preview.inventory.skipped.map(file => <li key={file.path} className="break-all font-mono">{file.path} · {t(`codeIntelligence.repository.skip.${file.reason}`)}</li>)}</ul></details>
        </div>}
      </div>}
      {hasDirectory && !approvedDraft && <p className="text-xs text-muted-foreground">{t('codeIntelligence.repository.approvalRequired')}</p>}
      {!hasDirectory && <p className="text-sm text-muted-foreground">{t('codeIntelligence.repository.directoryRequired')}</p>}
      {busy && <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="size-3.5 animate-spin" aria-hidden />{t(`codeIntelligence.repository.busy.${busy}`)}<Button type="button" variant="ghost" size="sm" onClick={cancel}><X className="size-3.5" aria-hidden />{t('codeIntelligence.repository.cancel')}</Button></div>}
      {errorKey && <p className="text-sm text-destructive" role="alert">{t(errorKey)}</p>}
      {inspection.binding && <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-muted-foreground">{t('codeIntelligence.repository.root')}</dt><dd className="break-all font-mono" data-testid="repository-root">{inspection.binding.canonicalRoot}</dd>
        <dt className="text-muted-foreground">{t('codeIntelligence.repository.repositoryId')}</dt><dd className="break-all font-mono">{inspection.binding.repositoryId}</dd>
        <dt className="text-muted-foreground">{t('codeIntelligence.repository.policyFingerprint')}</dt><dd className="break-all font-mono" data-testid="repository-policy-fingerprint">{inspection.connection?.policyFingerprint}</dd>
        <dt className="text-muted-foreground">{t('codeIntelligence.repository.projectId')}</dt><dd className="break-all font-mono">{projectId}</dd>
      </dl>}
      {hasDirectory && !busy && inspection.snapshots.length === 0 && <p className="text-sm text-muted-foreground">{t('codeIntelligence.repository.empty')}</p>}
      {allSnapshots.length > 0 && <div className="space-y-4">
        <label className="block space-y-1.5 text-xs font-medium"><span>{t('codeIntelligence.repository.snapshot')}</span>
          <select className={SELECT_CLASS} value={snapshotId} disabled={busy !== null} onChange={event => { cancelActive(); setSnapshotId(event.target.value) }} data-testid="repository-snapshot-select">
            {allSnapshots.map(snapshot => <option key={snapshot.id} value={snapshot.id}>{formatTime(snapshot.capturedAt)} · {t(snapshot.dirty ? 'codeIntelligence.repository.dirty' : 'codeIntelligence.repository.clean')} · {snapshot.id.slice(-12)}{!inspection.snapshots.some(current => current.id === snapshot.id) && ` · ${t('codeIntelligence.repository.historicalPolicy')}`}</option>)}
          </select>
        </label>
        {selected && <>
          <SnapshotDetails snapshot={selected} />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md bg-foreground/5 px-2 py-1" data-testid="repository-freshness">{t(`codeIntelligence.repository.freshness.${status}`)}</span>
            <Button type="button" variant="outline" size="sm" disabled={busy !== null || !inspection.snapshots.some(snapshot => snapshot.id === selected.id)} onClick={checkFreshness}><Check className="size-3.5" aria-hidden />{t('codeIntelligence.repository.checkFreshness')}</Button>
          </div>
          {selected.coverage.skippedCount > 0 && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">{t('codeIntelligence.repository.skipped', { count: selected.coverage.skippedCount })}</summary><ul className="mt-2 max-h-48 space-y-1 overflow-auto">
            {selected.skipped.map(file => <li key={file.path} className="flex justify-between gap-3"><span className="break-all font-mono">{file.path}</span><span className="shrink-0 text-muted-foreground">{t(`codeIntelligence.repository.skip.${file.reason}`)}</span></li>)}
          </ul></details>}
          {selected.files.length > 0 && <form className="space-y-3 border-t border-foreground/10 pt-4" onSubmit={readSpan}>
            <label className="block space-y-1.5 text-xs font-medium"><span className="flex items-center gap-1.5"><FileCode2 className="size-3.5" aria-hidden />{t('codeIntelligence.repository.file')}</span>
              <select className={SELECT_CLASS} value={path} disabled={busy !== null} onChange={event => { setPath(event.target.value); setSpan(null); setStartLine('1'); setEndLine('1') }} data-testid="repository-file-select">
                {selected.files.map(file => <option key={file.id} value={file.path}>{file.path}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1.5 text-xs font-medium"><span className="block">{t('codeIntelligence.repository.startLine')}</span><Input type="number" className="w-24" min="1" max="1000000" step="1" value={startLine} disabled={busy !== null} onChange={event => { setStartLine(event.target.value); setSpan(null) }} /></label>
              <label className="space-y-1.5 text-xs font-medium"><span className="block">{t('codeIntelligence.repository.endLine')}</span><Input type="number" className="w-24" min="1" max="1000000" step="1" value={endLine} disabled={busy !== null} onChange={event => { setEndLine(event.target.value); setSpan(null) }} /></label>
              <Button type="submit" size="sm" variant="outline" disabled={!selectedFile || busy !== null}>{t('codeIntelligence.repository.readSpan')}</Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('codeIntelligence.repository.spanLimit')}</p>
            {span && <div className="space-y-2" data-testid="repository-span"><p className="break-all text-xs text-muted-foreground">{span.path}:{span.startLine}–{span.endLine} · {t(span.sourceVersion.kind === 'working-copy' ? 'codeIntelligence.repository.workingCopyEvidence' : 'codeIntelligence.repository.commitEvidence')} <span className="font-mono">{span.sourceVersion.value}</span></p><pre className="max-h-96 overflow-auto rounded-lg bg-foreground/5 p-3 text-xs"><code>{span.excerpt}</code></pre></div>}
          </form>}
        </>}
      </div>}
    </section>
  )
}

function SnapshotDetails({ snapshot }: { snapshot: RepositorySnapshotSummary }) {
  const { t } = useTranslation()
  return <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
    <dt className="text-muted-foreground">{t('codeIntelligence.repository.parentCommit')}</dt><dd className="break-all font-mono">{snapshot.parentCommitSha}</dd>
    <dt className="text-muted-foreground">{t('codeIntelligence.repository.policyFingerprint')}</dt><dd className="break-all font-mono">{snapshot.policyHash}</dd>
    <dt className="text-muted-foreground">{t('codeIntelligence.repository.tree')}</dt><dd className="break-all font-mono">{snapshot.treeSha}</dd>
    <dt className="text-muted-foreground">{t('codeIntelligence.repository.sourceState')}</dt><dd>{t(snapshot.dirty ? 'codeIntelligence.repository.dirty' : 'codeIntelligence.repository.clean')}</dd>
    {snapshot.dirtyWorkingCopyDigest && <><dt className="text-muted-foreground">{t('codeIntelligence.repository.workingCopyDigest')}</dt><dd className="break-all font-mono">{snapshot.dirtyWorkingCopyDigest}</dd></>}
    <dt className="text-muted-foreground">{t('codeIntelligence.repository.coverage')}</dt><dd>{t('codeIntelligence.repository.coverageValue', { included: snapshot.coverage.includedCount, skipped: snapshot.coverage.skippedCount, total: snapshot.coverage.totalPaths })}{snapshot.coverage.truncated && <> · {t('codeIntelligence.repository.truncated')}</>}</dd>
  </dl>
}
