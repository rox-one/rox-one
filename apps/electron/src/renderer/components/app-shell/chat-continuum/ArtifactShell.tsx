/**
 * Inline artifact shell + derivation.
 *
 * An artifact inside the turn owns its header, its status and its actions, and
 * it may use the full column width — wider than the prose measure. Ported from
 * the G5 kit (`G5Artifact` / `G5ArtifactSkeleton` / `G5ArtifactEmpty`);
 * measured anatomy: header 36px (`min-h-9`), `--radius-card`.
 *
 * `ArtifactStack` maps real turn activities onto concrete artifacts. It never
 * invents data: a diff artifact appears only when a unified diff (or an
 * Edit/Write old→new pair) exists, a run artifact only when a tool exposed a
 * `command`, and a screenshot only for an actual `data:image/...` payload.
 */
import * as React from 'react'
import { LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ActivityItem, ActivityStatus } from '@rox/ui'
import { cn } from '@/lib/utils'
import { ContinuumBadge, type ContinuumTone } from './primitives'
import { DiffArtifact, type ContinuumDiffRow } from './DiffArtifact'
import { RunArtifact } from './RunArtifact'
import { ScreenshotArtifact } from './ScreenshotArtifact'

export function ArtifactShell({
  icon,
  title,
  subtitle,
  status,
  statusTone = 'neutral',
  actions,
  children,
  headerActions,
  labelledBy,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  status?: string
  statusTone?: ContinuumTone
  actions?: React.ReactNode
  children: React.ReactNode
  headerActions?: React.ReactNode
  labelledBy?: string
}) {
  return (
    <section
      data-g05-artifact
      aria-labelledby={labelledBy}
      className="my-3 w-full overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-elevated"
    >
      <header className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-subtle px-3 py-1.5">
        <span aria-hidden className="shrink-0 text-text-muted">
          {icon}
        </span>
        <h3 id={labelledBy} className="shrink-0 text-small font-medium text-text-primary">
          {title}
        </h3>
        {subtitle && (
          <code className="min-w-0 truncate font-mono text-caption text-text-secondary" title={subtitle}>{subtitle}</code>
        )}
        {status && <ContinuumBadge tone={statusTone}>{status}</ContinuumBadge>}
        <span className="flex-1" />
        {headerActions}
      </header>
      <div>{children}</div>
      {actions && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-3 py-1.5">
          {actions}
        </footer>
      )}
    </section>
  )
}

export function ArtifactSkeleton({ title, subtitle }: { title: string; subtitle: string }) {
  const { t } = useTranslation()
  return (
    <section
      data-g05-artifact="loading"
      aria-busy="true"
      className="my-3 w-full overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-elevated"
    >
      <header className="flex min-h-9 items-center gap-2 border-b border-border-subtle px-3 py-1.5">
        <LoaderCircle
          aria-hidden
          className="icon-toolbar text-text-muted motion-safe:animate-spin motion-reduce:animate-none"
        />
        <span className="text-small font-medium text-text-primary">{title}</span>
        <code className="min-w-0 truncate font-mono text-caption text-text-secondary" title={subtitle}>{subtitle}</code>
        <span className="flex-1" />
        <ContinuumBadge tone="running">
          {t('chat.continuum.artifact.running', { defaultValue: 'выполняется' })}
        </ContinuumBadge>
      </header>
      <div className="space-y-2 px-3 py-3" aria-hidden>
        {[92, 76, 58].map((width, index) => (
          <span
            key={index}
            className="block h-3 rounded-[var(--radius-xs)] bg-foreground-5"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
    </section>
  )
}

export function ArtifactEmpty({ title, hint }: { title: string; hint: string }) {
  return (
    <section
      data-g05-artifact="empty"
      className="my-3 w-full rounded-[var(--radius-card)] border border-dashed border-border-subtle px-3 py-4"
    >
      <p className="text-small font-medium text-text-secondary">{title}</p>
      <p className="mt-0.5 text-caption text-text-secondary">{hint}</p>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Derivation                                                                  */
/* -------------------------------------------------------------------------- */

export interface DerivedDiffArtifact {
  id: string
  path: string
  added: number
  removed: number
  rows: ContinuumDiffRow[]
}

export interface DerivedRunArtifact {
  id: string
  command: string
  output: string
  status: ActivityStatus
}

export interface DerivedScreenshotArtifact {
  id: string
  src: string
  caption?: string
}

export interface ContinuumArtifactsModel {
  diffs: DerivedDiffArtifact[]
  runs: DerivedRunArtifact[]
  screenshots: DerivedScreenshotArtifact[]
}

/** Upper bound on rendered diff rows, so a huge change cannot stall the turn. */
const MAX_DIFF_ROWS = 400

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Parse a unified diff body into continuum rows. */
export function unifiedDiffToRows(diff: string): ContinuumDiffRow[] {
  const rows: ContinuumDiffRow[] = []
  let oldLine = 0
  let newLine = 0
  for (const raw of diff.split('\n')) {
    if (rows.length >= MAX_DIFF_ROWS) break
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('\\ No newline')) continue
    const hunk = HUNK_HEADER.exec(raw)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      rows.push({ kind: 'hunk', text: raw })
      continue
    }
    if (raw.startsWith('+')) {
      rows.push({ kind: 'add', newLine, text: raw.slice(1) })
      newLine += 1
    } else if (raw.startsWith('-')) {
      rows.push({ kind: 'remove', oldLine, text: raw.slice(1) })
      oldLine += 1
    } else if (raw.length > 0) {
      rows.push({ kind: 'context', oldLine, newLine, text: raw.startsWith(' ') ? raw.slice(1) : raw })
      oldLine += 1
      newLine += 1
    }
  }
  return rows
}

function countKind(rows: ContinuumDiffRow[], kind: ContinuumDiffRow['kind']): number {
  return rows.reduce((total, row) => (row.kind === kind ? total + 1 : total), 0)
}

/** Synthesize rows for an Edit old→new pair (Claude Code tool format). */
function editPairToRows(oldString: string, newString: string): ContinuumDiffRow[] {
  const rows: ContinuumDiffRow[] = [{ kind: 'hunk', text: '@@' }]
  const removed = oldString.length > 0 ? oldString.split('\n') : []
  const added = newString.length > 0 ? newString.split('\n') : []
  let oldLine = 1
  let newLine = 1
  for (const text of removed) {
    if (rows.length >= MAX_DIFF_ROWS) return rows
    rows.push({ kind: 'remove', oldLine: oldLine++, text })
  }
  for (const text of added) {
    if (rows.length >= MAX_DIFF_ROWS) return rows
    rows.push({ kind: 'add', newLine: newLine++, text })
  }
  return rows
}

function writeContentToRows(content: string): ContinuumDiffRow[] {
  const rows: ContinuumDiffRow[] = [{ kind: 'hunk', text: '@@' }]
  const lines = content.length > 0 ? content.split('\n') : []
  lines.forEach((text, index) => {
    if (rows.length >= MAX_DIFF_ROWS) return
    rows.push({ kind: 'add', newLine: index + 1, text })
  })
  return rows
}

function diffArtifactFromActivity(activity: ActivityItem): DerivedDiffArtifact[] {
  const input = activity.toolInput as Record<string, unknown> | undefined
  if (!input || !activity.toolName) return []

  // Codex format: { changes: [{ path, diff }] } — real unified diffs.
  if (Array.isArray(input.changes)) {
    const artifacts: DerivedDiffArtifact[] = []
    ;(input.changes as Array<{ path?: string; diff?: string }>).forEach((change, index) => {
      if (!change?.diff) return
      const rows = unifiedDiffToRows(change.diff)
      if (rows.length === 0) return
      artifacts.push({
        id: `${activity.id}:change:${index}`,
        path: change.path ?? '',
        added: countKind(rows, 'add'),
        removed: countKind(rows, 'remove'),
        rows,
      })
    })
    if (artifacts.length > 0) return artifacts
  }

  if (activity.toolName === 'Edit') {
    const oldString = typeof input.old_string === 'string' ? input.old_string : ''
    const newString = typeof input.new_string === 'string' ? input.new_string : ''
    if (!oldString && !newString) return []
    const rows = editPairToRows(oldString, newString)
    return [{
      id: activity.id,
      path: typeof input.file_path === 'string' ? input.file_path : '',
      added: countKind(rows, 'add'),
      removed: countKind(rows, 'remove'),
      rows,
    }]
  }

  if (activity.toolName === 'Write') {
    const content = typeof input.content === 'string' ? input.content : ''
    if (!content) return []
    const rows = writeContentToRows(content)
    return [{
      id: activity.id,
      path: typeof input.file_path === 'string' ? input.file_path : '',
      added: countKind(rows, 'add'),
      removed: 0,
      rows,
    }]
  }

  return []
}

const DATA_IMAGE = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/

function findDataImage(activity: ActivityItem): string | undefined {
  if (activity.content) {
    const match = DATA_IMAGE.exec(activity.content)
    if (match) return match[0]
  }
  if (activity.toolInput) {
    try {
      const match = DATA_IMAGE.exec(JSON.stringify(activity.toolInput))
      if (match) return match[0]
    } catch {
      // Circular tool input — nothing to extract.
    }
  }
  return undefined
}

/**
 * Derive the artifact model for a turn from its real activities. Pure and
 * side-effect free so the shell can memoise it per turn.
 */
export function deriveArtifacts(activities: ActivityItem[]): ContinuumArtifactsModel {
  const diffs: DerivedDiffArtifact[] = []
  const runs: DerivedRunArtifact[] = []
  const screenshots: DerivedScreenshotArtifact[] = []

  for (const activity of activities) {
    if (activity.type !== 'tool' || !activity.toolName) continue

    diffs.push(...diffArtifactFromActivity(activity))

    const input = activity.toolInput as Record<string, unknown> | undefined
    const command = typeof input?.command === 'string' ? input.command : undefined
    if (command) {
      runs.push({
        id: activity.id,
        command,
        output: activity.content ?? '',
        status: activity.status,
      })
    }

    const src = findDataImage(activity)
    if (src) {
      screenshots.push({
        id: activity.id,
        src,
        caption: typeof input?.file_path === 'string' ? input.file_path : undefined,
      })
    }
  }

  return { diffs, runs, screenshots }
}

/** Renders the derived artifacts for one turn, in a stable order. */
export const ArtifactStack = React.memo(function ArtifactStack({ activities }: { activities: ActivityItem[] }) {
  const model = React.useMemo(() => deriveArtifacts(activities), [activities])
  if (model.diffs.length === 0 && model.runs.length === 0 && model.screenshots.length === 0) {
    return null
  }
  return (
    <div data-g05-artifact-stack className={cn('mt-2', 'select-text')}>
      {model.diffs.map((artifact) => (
        <DiffArtifact
          key={artifact.id}
          path={artifact.path}
          added={artifact.added}
          removed={artifact.removed}
          rows={artifact.rows}
        />
      ))}
      {model.runs.map((artifact) => (
        <RunArtifact
          key={artifact.id}
          command={artifact.command}
          output={artifact.output}
          status={artifact.status}
        />
      ))}
      {model.screenshots.map((artifact) => (
        <ScreenshotArtifact key={artifact.id} src={artifact.src} caption={artifact.caption} />
      ))}
    </div>
  )
})