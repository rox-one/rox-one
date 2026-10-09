/**
 * С-15 cell editor (04-UI-SPEC B.15): one pipeline cell — kind, kind-specific
 * body (script command+args / agent prompt / artifact id), ordering controls,
 * run, and the last result. Script cells are executable + args (never a shell
 * string, §3.8), so the server can spawn them with `shell: false`.
 *
 * Keyboard: Shift+Enter runs the cell (notebook convention); ArrowUp/Down move
 * focus between cells (handled by the page's list container).
 */
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Loader2, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CellOutput } from './CellOutput'
import type { CodebookCell, CodebookCellKind, CodebookStepResult } from '../codebook-client'

const KINDS: readonly CodebookCellKind[] = ['script', 'agent', 'artifact']

export interface CellEditorProps {
  cell: CodebookCell
  index: number
  total: number
  result?: CodebookStepResult
  workspaceId: string | null
  projectSlug?: string
  running: boolean
  onChange: (patch: Partial<CodebookCell>) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
  onRun: () => void
}

export function CellEditor({ cell, index, total, result, workspaceId, projectSlug, running, onChange, onMove, onRemove, onRun }: CellEditorProps) {
  const { t } = useTranslation()
  const busy = running || result?.status === 'running'

  return (
    <li
      className="min-w-0 rounded-[var(--radius-card)] border border-border-subtle p-3"
      data-testid={`playbooks-codebook-cell-${cell.id}`}
      data-codebook-cell={index}
      tabIndex={-1}
    >
      <div className="flex items-center gap-2">
        <span className="text-caption tabular-nums text-muted-foreground" aria-hidden>{index + 1}</span>
        <Select value={cell.kind} onValueChange={(value) => onChange({ kind: value as CodebookCellKind })} disabled={busy}>
          <SelectTrigger className="h-7 w-32 text-xs" aria-label={t('playbooks.codebook.kindLabel')} data-testid={`playbooks-codebook-kind-${cell.id}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>{t(`playbooks.codebook.kind.${kind}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={cell.title ?? ''}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder={t('playbooks.codebook.titlePlaceholder')}
          className="h-7 flex-1 text-xs"
          aria-label={t('playbooks.codebook.titleLabel')}
          disabled={busy}
        />
        <div className="flex items-center gap-0.5">
          <Button type="button" variant="ghost" size="sm" disabled={busy || index === 0} aria-label={t('playbooks.codebook.moveUp')} onClick={() => onMove(-1)} data-testid={`playbooks-codebook-up-${cell.id}`}>
            <ArrowUp className="icon-caption" aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy || index === total - 1} aria-label={t('playbooks.codebook.moveDown')} onClick={() => onMove(1)} data-testid={`playbooks-codebook-down-${cell.id}`}>
            <ArrowDown className="icon-caption" aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} aria-label={t('playbooks.codebook.removeCell')} onClick={onRemove} data-testid={`playbooks-codebook-remove-${cell.id}`}>
            <Trash2 className="icon-caption" aria-hidden />
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={onRun} data-testid={`playbooks-codebook-run-cell-${cell.id}`}>
            {busy ? <Loader2 className="icon-caption animate-spin motion-reduce:animate-none" aria-hidden /> : <Play className="icon-caption" aria-hidden />}
            {t('playbooks.codebook.runCell')}
          </Button>
        </div>
      </div>

      <div
        className="mt-2 space-y-2"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.shiftKey) {
            event.preventDefault()
            if (!busy) onRun()
          }
        }}
      >
        {cell.kind === 'script' ? (
          <>
            <div className="space-y-1">
              <Label htmlFor={`cell-command-${cell.id}`} className="text-caption">{t('playbooks.codebook.commandLabel')}</Label>
              <Input
                id={`cell-command-${cell.id}`}
                value={cell.command ?? ''}
                onChange={(event) => onChange({ command: event.target.value })}
                placeholder={t('playbooks.codebook.commandPlaceholder')}
                className="h-8 font-mono text-xs"
                disabled={busy}
                data-testid={`playbooks-codebook-command-${cell.id}`}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`cell-args-${cell.id}`} className="text-caption">{t('playbooks.codebook.argsLabel')}</Label>
              <Textarea
                id={`cell-args-${cell.id}`}
                value={(cell.args ?? []).join('\n')}
                onChange={(event) => onChange({ args: event.target.value.split('\n').filter((arg) => arg.length > 0) })}
                placeholder={t('playbooks.codebook.argsPlaceholder')}
                className="min-h-[56px] font-mono text-xs"
                disabled={busy}
              />
            </div>
          </>
        ) : null}

        {cell.kind === 'agent' ? (
          <div className="space-y-1">
            <Label htmlFor={`cell-prompt-${cell.id}`} className="text-caption">{t('playbooks.codebook.promptLabel')}</Label>
            <Textarea
              id={`cell-prompt-${cell.id}`}
              value={cell.prompt ?? ''}
              onChange={(event) => onChange({ prompt: event.target.value })}
              placeholder={t('playbooks.codebook.promptPlaceholder')}
              className="min-h-[72px] text-xs"
              disabled={busy}
              data-testid={`playbooks-codebook-prompt-${cell.id}`}
            />
          </div>
        ) : null}

        {cell.kind === 'artifact' ? (
          <div className="space-y-1">
            <Label htmlFor={`cell-artifact-${cell.id}`} className="text-caption">{t('playbooks.codebook.artifactIdLabel')}</Label>
            <Input
              id={`cell-artifact-${cell.id}`}
              value={cell.artifactId ?? ''}
              onChange={(event) => onChange({ artifactId: event.target.value })}
              placeholder={t('playbooks.codebook.artifactIdPlaceholder')}
              className="h-8 font-mono text-xs"
              disabled={busy}
              data-testid={`playbooks-codebook-artifact-id-${cell.id}`}
            />
          </div>
        ) : null}
      </div>

      {result ? <CellOutput result={result} workspaceId={workspaceId} {...(projectSlug ? { projectSlug } : {})} /> : null}
    </li>
  )
}