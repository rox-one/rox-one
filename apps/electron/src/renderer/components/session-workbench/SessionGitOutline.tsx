import * as React from 'react'
import { GitBranch, GitCommit } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  extractSessionVariables,
  projectSessionScenes,
  type SceneMessage,
} from '@craft-agent/core/mindmap'

export type RelatedBranch = { id: string; name: string; fromMessageId?: string }

export type SessionGitOutlineProps = {
  sessionId: string
  messages: SceneMessage[]
  loading?: boolean
  relatedBranches?: RelatedBranch[]
  onCheckoutMessage?: (messageId: string) => void
  onFork?: (messageId: string) => void
  onOpenSession?: (sessionId: string) => void
  onInsertVariable?: (name: string, value?: string) => void
  /** Message id → creation time (ms), for «Ход N · 14:32» labels. */
  messageTimes?: ReadonlyMap<string, number>
}

/** Collapse a tool chain into «12× read, 4× bash» (first-seen order). */
export function summarizeSceneTools(tools: ReadonlyArray<{ name: string }>): string {
  const counts = new Map<string, number>()
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1)
  return [...counts.entries()].map(([name, n]) => `${n}× ${name}`).join(', ')
}

export function SessionGitOutline({
  sessionId,
  messages,
  loading = false,
  relatedBranches = [],
  onCheckoutMessage,
  onFork,
  onOpenSession,
  onInsertVariable,
  messageTimes,
}: SessionGitOutlineProps) {
  const { t, i18n } = useTranslation()
  const timeFormat = React.useMemo(
    () => new Intl.DateTimeFormat(i18n.language || undefined, { hour: '2-digit', minute: '2-digit' }),
    [i18n.language],
  )
  const graph = React.useMemo(
    () => projectSessionScenes(sessionId, messages),
    [sessionId, messages],
  )
  const variables = React.useMemo(
    () =>
      extractSessionVariables(
        messages.map((m) => ({ id: m.id, content: m.content ?? '' })),
      ),
    [messages],
  )
  const incomingForkIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const edge of graph.edges) {
      if (edge.kind === 'fork') ids.add(edge.to)
    }
    return ids
  }, [graph.edges])

  return (
    <div className="h-full min-h-0 flex-1 overflow-auto px-4 py-3 text-sm">
      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('entityView.outlineLog')}
      </div>
      {graph.scenes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {loading ? t('mindmap.loading') : t('entityView.workbenchNoScenes')}
        </p>
      ) : (
      <ul>
        {graph.scenes.map((scene, index) => {
          const isFork =
            scene.childSceneIds.length > 1 || incomingForkIds.has(scene.id)
          const time = messageTimes?.get(scene.triggerMessageId)
          const turnLabel = time
            ? `${t('entityView.outlineTurn', { n: index + 1 })} · ${timeFormat.format(new Date(time))}`
            : t('entityView.outlineTurn', { n: index + 1 })
          const toolSummary = summarizeSceneTools(scene.tools)
          return (
            <li
              key={scene.id}
              className="py-2"
            >
              <div className="flex items-start gap-2">
                <GitCommit className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground" title={scene.id}>
                      {turnLabel}
                    </span>
                    {isFork ? (
                      <span className="inline-flex items-center gap-0.5 rounded bg-violet-500/10 px-1 py-0.5 text-[10px] uppercase tracking-wide text-violet-500">
                        <GitBranch className="h-2.5 w-2.5" />
                        {t('entityView.outlineFork')}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate">
                    {scene.triggerPreview || scene.id}
                  </div>
                  {toolSummary ? (
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={toolSummary}>
                      {toolSummary}
                    </div>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <button
                      type="button"
                      className={cn(
                        'rounded bg-foreground/[0.04] px-2 py-0.5 text-[11px]',
                        'hover:bg-foreground/[0.08]',
                      )}
                      onClick={() =>
                        onCheckoutMessage?.(scene.triggerMessageId)
                      }
                    >
                      {t('entityView.outlineCheckout')}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1 rounded bg-foreground/[0.04] px-2 py-0.5 text-[11px]',
                        'hover:bg-foreground/[0.08]',
                      )}
                      onClick={() => onFork?.(scene.triggerMessageId)}
                    >
                      <GitBranch className="h-3 w-3" />
                      {t('entityView.workbenchFork')}
                    </button>
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      )}

      {relatedBranches.length > 0 ? (
        <>
      <div className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('entityView.outlineBranches')}
      </div>
        <ul className="space-y-1">
          {relatedBranches.map((branch) => (
            <li key={branch.id}>
              <button
                type="button"
                className="flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-foreground/5"
                title={branch.fromMessageId}
                onClick={() => onOpenSession?.(branch.id)}
              >
                <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{branch.name}</span>
              </button>
            </li>
          ))}
        </ul>
        </>
      ) : null}

      {variables.length > 0 ? (
        <>
      <div className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('entityView.outlineVariables')}
      </div>
        <ul className="space-y-1">
          {variables.map((variable) => (
            <li
              key={variable.name}
              className="flex items-center justify-between gap-2 rounded px-2 py-1"
            >
              <span className="min-w-0 truncate font-mono text-xs">
                {variable.name}
                {variable.value ? (
                  <span className="text-muted-foreground">
                    {' '}
                    = {variable.value}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                className="shrink-0 rounded bg-foreground/[0.04] px-2 py-0.5 text-[11px] hover:bg-foreground/[0.08]"
                onClick={() =>
                  onInsertVariable?.(variable.name, variable.value)
                }
              >
                {t('entityView.outlineInject')}
              </button>
            </li>
          ))}
        </ul>
        </>
      ) : null}
    </div>
  )
}
