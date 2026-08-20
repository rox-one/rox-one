import * as React from 'react'
import { GitBranch, GitCommit } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  extractSessionVariables,
  projectSessionScenes,
  type SceneMessage,
} from '@craft-agent/core/mindmap'

export type RelatedBranch = { id: string; name: string }

export type SessionGitOutlineProps = {
  sessionId: string
  messages: SceneMessage[]
  relatedBranches?: RelatedBranch[]
  onCheckoutMessage?: (messageId: string) => void
  onFork?: (messageId: string) => void
  onOpenSession?: (sessionId: string) => void
  onInsertVariable?: (name: string, value?: string) => void
}

export function SessionGitOutline({
  sessionId,
  messages,
  relatedBranches = [],
  onCheckoutMessage,
  onFork,
  onOpenSession,
  onInsertVariable,
}: SessionGitOutlineProps) {
  const { t } = useTranslation()
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
      <ul>
        {graph.scenes.map((scene) => {
          const isFork =
            scene.childSceneIds.length > 1 || incomingForkIds.has(scene.id)
          const hash = scene.id.slice(-7)
          return (
            <li
              key={scene.id}
              className="border-l border-border/60 py-2 pl-3"
            >
              <div className="flex items-start gap-2">
                <GitCommit className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {hash}
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
                  {scene.tools.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-0.5">
                      {scene.tools.map((tool) => (
                        <span
                          key={tool.toolCallId}
                          className="rounded bg-foreground/5 px-1 font-mono text-[10px] text-muted-foreground"
                        >
                          {tool.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <button
                      type="button"
                      className={cn(
                        'rounded border border-border px-2 py-0.5 text-[11px]',
                        'hover:bg-foreground/5',
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
                        'inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px]',
                        'hover:bg-foreground/5',
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

      <div className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('entityView.outlineBranches')}
      </div>
      {relatedBranches.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('entityView.outlineNoBranches')}
        </p>
      ) : (
        <ul className="space-y-1">
          {relatedBranches.map((branch) => (
            <li key={branch.id}>
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-foreground/5"
                onClick={() => onOpenSession?.(branch.id)}
              >
                <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{branch.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('entityView.outlineVariables')}
      </div>
      {variables.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('entityView.outlineNoVariables')}
        </p>
      ) : (
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
                className="shrink-0 rounded border border-border px-2 py-0.5 text-[11px] hover:bg-foreground/5"
                onClick={() =>
                  onInsertVariable?.(variable.name, variable.value)
                }
              >
                {t('entityView.outlineInject')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
