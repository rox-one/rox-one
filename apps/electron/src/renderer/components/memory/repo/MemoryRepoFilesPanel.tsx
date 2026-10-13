/**
 * Память → Репозиторий → Файлы.
 *
 * Left: the flat materialized tree (`depth`-indented, `edited`/`dreamed`
 * badges). Right: the selected markdown file — frontmatter as a small table,
 * body through `@rox/ui` `Markdown` in `minimal` mode with `[[wikilinks]]`
 * turned into clickable repo links. Pure props: selection, file content and
 * loading all arrive from the shell (A5); this panel never calls the bridge.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, FolderClosed, TriangleAlert } from 'lucide-react'
import { Markdown } from '@rox/ui/markdown'
import type { MemoryRepoFile, MemoryRepoTreeNode } from '@rox/shared/memory/repo'
import { handleSidebarTreeKeyDown } from '@/components/app-shell/sidebar-keyboard'
import { cn } from '@/lib/utils'

export interface MemoryRepoFilesPanelProps {
  bankId: string
  tree: MemoryRepoTreeNode[]
  selectedPath: string | null
  onSelect(path: string): void
  file: MemoryRepoFile | null
  loading: boolean
  /**
   * True while the shell is reading the selected file. Per-selection loading:
   * lets the viewer distinguish "read in flight" from "file genuinely missing"
   * without painting the previous selection's content or a false not-found.
   */
  fileLoading?: boolean
}

export interface FrontmatterEntry {
  key: string
  value: string
}

/** `[[target]]` / `[[target|label]]` outside fenced code, not preceded by `!`. */
const WIKILINK_RE = /(?<!!)\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g
/** A code fence we must not rewrite inside. */
const FENCE_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/

/** Turn `[[lessons/x|label]]` into `[label](lessons/x)` so Markdown routes the click. */
export function linkifyWikilinks(markdown: string): string {
  return markdown
    .split(FENCE_RE)
    .map((part, index) => {
      if (index % 2 === 1) return part
      return part.replace(WIKILINK_RE, (_match, rawTarget: string, rawLabel?: string) => {
        const target = rawTarget.trim()
        if (!target) return _match
        const label = (rawLabel ?? '').trim() || target
        return `[${label}](${target})`
      })
    })
    .join('')
}

/**
 * Map a wikilink target to the repo file path the tree selects. Materialized
 * links carry no extension (`[[lessons/workflow/slug--id8]]`), while tree nodes
 * are `.md` files, so a bare path gets `.md` appended. Anchors are dropped.
 */
export function repoPathFromWikilink(target: string): string {
  const clean = target
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/^\.\//, '')
    .split('#')[0]!
    .trim()
  if (!clean) return clean
  return /\.[a-z0-9]+$/i.test(clean) ? clean : `${clean}.md`
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** Flat `a.b: value` view of the otherwise tiny generated frontmatter. */
export function parseFrontmatter(content: string): { entries: FrontmatterEntry[]; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content)
  if (!match) return { entries: [], body: content }
  const body = content.slice(match[0].length)
  const entries: FrontmatterEntry[] = []
  const stack: Array<{ indent: number; key: string }> = []
  for (const raw of (match[1] ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop()
    const prefix = stack.map((entry) => entry.key).join('.')
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (!value) {
      stack.push({ indent, key })
      continue
    }
    entries.push({ key: fullKey, value: stripQuotes(value) })
  }
  return { entries, body }
}

function Badge({ label, tone }: { label: string; tone: 'edited' | 'dreamed' }) {
  return (
    <span
      data-testid={`memory-repo-badge-${tone}`}
      className={cn(
        'shrink-0 rounded-[var(--radius-control)] px-1.5 py-px text-caption',
        tone === 'edited' ? 'bg-status-warning/15 text-status-warning' : 'bg-accent/12 text-accent',
      )}
    >
      {label}
    </span>
  )
}

export function MemoryRepoFilesPanel({
  tree,
  selectedPath,
  onSelect,
  file,
  loading,
  fileLoading = false,
}: MemoryRepoFilesPanelProps) {
  const { t } = useTranslation()

  const handleBodyLink = React.useCallback(
    (target: string) => {
      // Repo-relative links only; leave external URLs/anchors alone.
      if (!target || target.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(target)) return
      const mapped = repoPathFromWikilink(target)
      if (mapped) onSelect(mapped)
    },
    [onSelect],
  )

  const parsed = React.useMemo(
    () => (file ? parseFrontmatter(file.content) : null),
    [file],
  )

  const treePane = (
    <div
      data-focus-zone="sidebar"
      data-testid="memory-repo-files-tree"
      onKeyDown={handleSidebarTreeKeyDown}
      className="flex min-h-0 w-[248px] shrink-0 flex-col overflow-y-auto border-r border-border-subtle bg-foreground-2 py-2"
    >
      {loading && tree.length === 0 ? (
        <div
          data-testid="memory-repo-tree-loading"
          className="px-4 py-4 text-body text-text-muted"
        >
          {t('memory.repo.state.loading')}
        </div>
      ) : tree.length === 0 ? (
        <div
          data-testid="memory-repo-files-empty"
          className="mx-3 mt-2 flex flex-col items-center gap-3 rounded-[var(--radius-control)] border border-dashed border-border-strong bg-background/60 px-4 py-8 text-center"
        >
          <span className="grid size-10 place-items-center rounded-[var(--radius-control)] bg-accent/10 text-accent">
            <FolderClosed aria-hidden="true" className="icon-rail" />
          </span>
          <p className="text-body font-medium">{t('memory.repo.state.empty')}</p>
          <p className="max-w-[220px] text-caption text-text-muted">
            {t('memory.repo.state.emptyHint')}
          </p>
        </div>
      ) : (
        <ul aria-label={t('memory.repo.tree.title')} className="flex flex-col gap-px px-1.5">
          {tree.map((node) => {
            const isFile = node.type === 'file'
            const selected = isFile && node.path === selectedPath
            const indent = { paddingLeft: `${8 + node.depth * 12}px` }
            if (!isFile) {
              return (
                <li key={node.path}>
                  <div
                    className="flex min-h-7 items-center gap-1.5 text-small font-medium text-text-secondary"
                    style={indent}
                  >
                    <FolderClosed aria-hidden="true" className="icon-caption shrink-0" />
                    <span className="truncate" title={node.name}>{node.name}</span>
                  </div>
                </li>
              )
            }
            return (
              <li key={node.path}>
                <button
                  type="button"
                  onClick={() => onSelect(node.path)}
                  aria-current={selected ? 'true' : undefined}
                  data-testid={`memory-repo-file-${node.path}`}
                  className={cn(
                    'flex min-h-7 w-full items-center gap-1.5 rounded-[var(--radius-control)] py-1 pr-1.5 text-left text-small outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    selected ? 'bg-accent/10 font-medium text-accent' : 'text-foreground-90 hover:bg-surface-hover',
                  )}
                  style={indent}
                >
                  <FileText aria-hidden="true" className="icon-caption shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate" title={node.name}>{node.name}</span>
                  {node.badges?.includes('edited') ? <Badge tone="edited" label={t('memory.repo.file.badgeEdited')} /> : null}
                  {node.badges?.includes('dreamed') ? <Badge tone="dreamed" label={t('memory.repo.file.badgeDreamed')} /> : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )

  const viewer = (() => {
    // Per-selection loading: the shell is reading the selection, or the `file`
    // prop still belongs to a previous selection. Show the loading branch — not
    // the stale file and not a false not-found.
    const pending = Boolean(selectedPath) && (fileLoading || (file !== null && file.path !== selectedPath))
    if (loading || pending) {
      return <div className="px-5 py-6 text-body text-text-muted" data-testid="memory-repo-files-loading">{t('memory.repo.state.loading')}</div>
    }
    if (!file) {
      if (selectedPath) {
        return (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center" data-testid="memory-repo-files-not-found" role="alert">
            <TriangleAlert aria-hidden="true" className="icon-rail text-status-warning" />
            <p className="text-body text-text-secondary">{t('memory.repo.state.fileNotFound')}</p>
          </div>
        )
      }
      return <div className="px-5 py-6 text-body text-text-muted" data-testid="memory-repo-files-no-selection">{t('memory.repo.file.selectFile')}</div>
    }
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-testid="memory-repo-file-viewer">
        <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-body font-medium" title={file.path}>{file.path}</span>
          {file.edited ? <Badge tone="edited" label={t('memory.repo.file.badgeEdited')} /> : null}
        </div>
        {file.edited ? (
          <div className="mb-3 rounded-[var(--radius-control)] border border-status-warning/25 bg-status-warning/10 px-3 py-2 text-small text-text-secondary" data-testid="memory-repo-files-edited-notice">
            {t('memory.repo.file.editedNotice')}
          </div>
        ) : null}
        {file.truncated ? (
          <div className="mb-3 rounded-[var(--radius-control)] border border-border-subtle bg-foreground-3 px-3 py-2 text-small text-text-muted" data-testid="memory-repo-files-truncated">
            {t('memory.repo.file.truncated')}
          </div>
        ) : null}
        {parsed && parsed.entries.length > 0 ? (
          <table className="mb-4 w-full table-fixed border-collapse overflow-hidden rounded-[var(--radius-control)] text-caption" data-testid="memory-repo-files-frontmatter">
            <caption className="pb-1 text-left text-caption font-medium uppercase caps-label text-text-muted/70">
              {t('memory.repo.file.frontmatter')}
            </caption>
            <tbody>
              {parsed.entries.map((entry) => (
                <tr key={entry.key} className="border-b border-border-subtle last:border-b-0">
                  <th scope="row" className="w-[38%] truncate px-2 py-1 text-left font-medium text-text-secondary" title={entry.key}>{entry.key}</th>
                  <td className="truncate px-2 py-1 text-foreground-90" title={entry.value}>{entry.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <div className="markdown-content text-body" data-testid="memory-repo-file-body">
          <Markdown mode="minimal" onFileClick={handleBodyLink} onUrlClick={handleBodyLink}>
            {parsed ? linkifyWikilinks(parsed.body) : ''}
          </Markdown>
        </div>
      </div>
    )
  })()

  return (
    <div className="flex min-h-0 flex-1" data-testid="memory-repo-files-panel">
      {treePane}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">{viewer}</section>
    </div>
  )
}
