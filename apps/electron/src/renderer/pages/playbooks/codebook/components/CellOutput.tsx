/**
 * С-15 cell result pane (04-UI-SPEC B.15): renders one `CodebookStepResult` —
 * status, bounded stdout/stderr, typed error, and references to the produced
 * artifacts/session. Artifact preview reuses the optional В2 dev-space reader;
 * without it the pane still shows the artifact id (no invented content).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, FileCode, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { readCellArtifact, type CodebookStepResult } from '../codebook-client'

export interface CellOutputProps {
  result: CodebookStepResult
  workspaceId: string | null
  projectSlug?: string
}

export function CellOutput({ result, workspaceId, projectSlug }: CellOutputProps) {
  const { t } = useTranslation()
  const [artifactText, setArtifactText] = useState<string | null>(null)
  const [artifactError, setArtifactError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const artifactId = result.output?.artifactId
  const exitCode = result.output?.exitCode

  const showArtifact = async () => {
    if (!workspaceId || !artifactId) return
    setLoading(true)
    setArtifactError(null)
    try {
      const text = await readCellArtifact({ workspaceId, ...(projectSlug ? { projectSlug } : {}), artifactId })
      if (text === null) setArtifactError(t('playbooks.codebook.output.artifactUnavailable'))
      else setArtifactText(text)
    } catch (err) {
      setArtifactError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-2 space-y-2 border-t border-border-subtle pt-2 text-xs" data-testid={`playbooks-codebook-output-${result.cellId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground" data-testid={`playbooks-codebook-step-state-${result.cellId}`}>
          {t(`playbooks.codebook.stepState.${result.status}`)}
        </span>
        {typeof exitCode === 'number' ? (
          <span className="tabular-nums text-muted-foreground">{t('playbooks.codebook.output.exit', { code: exitCode })}</span>
        ) : null}
      </div>

      {result.output?.text ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-[var(--radius-control)] bg-surface-pressed p-2 font-mono text-caption">{result.output.text}</pre>
      ) : null}

      {result.output?.stderr ? (
        <div>
          <span className="text-caption uppercase tracking-wide text-muted-foreground">{t('playbooks.codebook.output.stderr')}</span>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-[var(--radius-control)] bg-surface-pressed p-2 font-mono text-caption text-destructive">{result.output.stderr}</pre>
        </div>
      ) : null}

      {result.error ? (
        <p className="flex items-center gap-1 text-destructive" role="alert" data-testid={`playbooks-codebook-step-error-${result.cellId}`}>
          <AlertCircle className="icon-caption" aria-hidden />
          {t('playbooks.codebook.output.error', { code: result.error.code, detail: result.error.detail ?? '' })}
        </p>
      ) : null}

      {artifactId ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-muted-foreground">
            <FileCode className="icon-caption" aria-hidden />
            {t('playbooks.codebook.output.artifact', { id: artifactId })}
          </span>
          <Button type="button" variant="outline" size="sm" disabled={!workspaceId || loading} onClick={() => void showArtifact()} data-testid={`playbooks-codebook-artifact-${result.cellId}`}>
            {t('playbooks.codebook.output.showArtifact')}
          </Button>
        </div>
      ) : null}

      {artifactError ? <p className="text-destructive" role="alert">{artifactError}</p> : null}
      {artifactText ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-[var(--radius-control)] bg-surface-pressed p-2 font-mono text-caption" data-testid={`playbooks-codebook-artifact-text-${result.cellId}`}>{artifactText}</pre>
      ) : null}

      {result.output?.sessionId ? (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Link2 className="icon-caption" aria-hidden />
          {t('playbooks.codebook.output.session', { id: result.output.sessionId })}
        </span>
      ) : null}

      {result.status === 'succeeded' && !result.output?.text && !result.output?.stderr && !artifactId && !result.output?.sessionId ? (
        <p className="text-muted-foreground">{t('playbooks.codebook.output.empty')}</p>
      ) : null}
    </div>
  )
}