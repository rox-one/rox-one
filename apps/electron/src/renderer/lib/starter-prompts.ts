import type { LoadedSkill, LoadedSource, Session } from '../../shared/types'
import type { CapabilityRef } from '@rox/core/runtime-trace'
import { normalizeSuggestionHistory, type SuggestionHistory } from './contextual-suggestions'
import { sourceCatalogStatus, sourceCategories } from './capability-catalog'

export interface StarterPrompt {
  id: string
  labelKey: string
  promptKey: string
  icon: 'plan' | 'knowledge' | 'code' | 'skill'
  dependencies: CapabilityRef[]
  skill?: LoadedSkill
  values?: Record<string, string>
}
export function canShowStarterPrompts(options: { session: Session | null; active: boolean; hasPendingRequest: boolean }): boolean {
  return Boolean(options.session && !options.session.hidden && options.active && !options.hasPendingRequest
    && !options.session.isProcessing && options.session.messages.length === 0)
}
export function starterHistoryId(session: Pick<Session, 'workspaceId' | 'id'>, promptId: string): string {
  return `starter:${session.workspaceId}:${session.id}:${promptId}`
}
export function selectStarterPrompts(options: {
  session: Session | null
  skills: LoadedSkill[]
  sources: LoadedSource[]
  active: boolean
  hasPendingRequest: boolean
  history?: SuggestionHistory
  now: number
}): StarterPrompt[] {
  if (!canShowStarterPrompts(options) || !options.session) return []
  const history = normalizeSuggestionHistory(options.history, options.now)
  const sources = options.sources.filter(source => source.workspaceId === options.session!.workspaceId && sourceCatalogStatus(source) === 'connected')
  const candidate: StarterPrompt[] = []
  const skill = options.skills.find(skill => !skill.shadowedByCraft && /^[\w-]+$/.test(skill.slug)
    && (skill.metadata.requiredSources ?? []).every(slug => sources.some(source => source.config.slug === slug)))
  if (skill) candidate.push({ id: `skill:${skill.source}:${skill.slug}`, icon: 'skill', labelKey: 'starterPrompts.useSkill', promptKey: 'starterPrompts.skillPrompt', values: { name: skill.metadata.name }, skill,
    dependencies: [{ kind: 'skill', id: skill.slug, scope: skill.source, label: skill.metadata.name }, ...sources.filter(source => skill.metadata.requiredSources?.includes(source.config.slug)).map(source => ({ kind: 'source' as const, id: source.config.slug, scope: 'workspace' as const, label: source.config.name }))] })
  const knowledge = sources.find(source => sourceCategories(source).includes('knowledge'))
  if (knowledge) candidate.push({ id: `summary:${knowledge.config.slug}`, icon: 'knowledge', labelKey: 'starterPrompts.summarize', promptKey: 'starterPrompts.summaryPrompt', values: { name: knowledge.config.name }, dependencies: [{ kind: 'source', id: knowledge.config.slug, scope: 'workspace', label: knowledge.config.name }] })
  const code = sources.find(source => sourceCategories(source).includes('code'))
  if (code) candidate.push({ id: `review:${code.config.slug}`, icon: 'code', labelKey: 'starterPrompts.review', promptKey: 'starterPrompts.reviewPrompt', values: { name: code.config.name }, dependencies: [{ kind: 'source', id: code.config.slug, scope: 'workspace', label: code.config.name }] })
  candidate.push(
    { id: 'plan', icon: 'plan', labelKey: 'starterPrompts.plan', promptKey: 'starterPrompts.planPrompt', dependencies: [] },
    { id: 'structure', icon: 'knowledge', labelKey: 'starterPrompts.structure', promptKey: 'starterPrompts.structurePrompt', dependencies: [] },
    { id: 'process', icon: 'plan', labelKey: 'starterPrompts.process', promptKey: 'starterPrompts.processPrompt', dependencies: [] },
  )
  return candidate.filter(prompt => history.seen[starterHistoryId(options.session!, prompt.id)] === undefined).slice(0, 4)
}
/** Preserve every existing character and attachments owned by the composer. */
export function appendStarterPrompt(draft: string, prompt: string): string {
  if (!prompt.trim() || draft.includes(prompt)) return draft
  return draft ? `${draft}${draft.endsWith('\n\n') ? '' : '\n\n'}${prompt}` : prompt
}
