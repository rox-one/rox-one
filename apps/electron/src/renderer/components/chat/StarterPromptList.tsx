import { useTranslation } from 'react-i18next'
import { BookOpen, Code2, ListTodo, X, Zap } from 'lucide-react'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import type { LoadedSource } from '../../../shared/types'
import type { StarterPrompt } from '@/lib/starter-prompts'
import { CHAT_LAYOUT } from '@/config/layout'
import { cn } from '@/lib/utils'
const ICONS = { plan: ListTodo, knowledge: BookOpen, code: Code2, skill: Zap }
export function StarterPromptList({ prompts, sources, workspaceId, onSelect, onDismiss }: {
  prompts: StarterPrompt[]
  sources: LoadedSource[]
  workspaceId: string
  onSelect: (prompt: StarterPrompt) => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  if (!prompts.length) return null
  return <div className={cn(CHAT_LAYOUT.maxWidth, 'mx-auto mb-4 w-full shrink-0 px-3 @xs/panel:px-4')} data-testid="starter-prompt-list" aria-label={t('starterPrompts.suggestions')}>
    <div className="flex items-center justify-end"><button type="button" onClick={onDismiss} aria-label={t('starterPrompts.dismiss')} className="rounded p-1 text-muted-foreground/50 hover:bg-foreground/5 hover:text-muted-foreground"><X className="size-3" /></button></div>
    <div className="space-y-0.5">{prompts.map(prompt => {
      const Icon = ICONS[prompt.icon]
      return <button type="button" key={prompt.id} onClick={() => onSelect(prompt)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.025] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="starter-prompt">
        <Icon className="size-3.5 shrink-0 opacity-70" /><span className="min-w-0 flex-1 break-words">{t(prompt.labelKey, prompt.values)}</span>
        <span className="flex shrink-0 items-center gap-1" aria-label={t('starterPrompts.dependencies')}>{prompt.dependencies.slice(0, 3).map(dependency => {
          const source = sources.find(source => source.config.slug === dependency.id && source.workspaceId === workspaceId)
          return <span key={`${dependency.kind}:${dependency.scope}:${dependency.id}`} className="opacity-60" title={dependency.label}>{dependency.kind === 'skill' && prompt.skill ? <SkillAvatar skill={prompt.skill} size="xs" workspaceId={workspaceId} /> : source ? <SourceAvatar source={source} size="xs" /> : <Zap className="size-3" />}</span>
        })}</span>
      </button>
    })}</div>
  </div>
}
