import type { AIActionMode } from './NotesAIMenu'

/** Default free Rox parent model — never a missing SiYuan/CY model. */
export const NOTES_AI_MODEL = 'rox/standard'
export const NOTES_AI_PROMPTS_STORAGE_KEY = 'notes:ai-prompts'

export const NOTES_AI_PROMPT_KEYS: Record<AIActionMode, string> = {
  analyze: 'notes.ai.promptAnalyze',
  expand: 'notes.ai.promptExpand',
  summarize: 'notes.ai.promptSummarize',
  'extract-tasks': 'notes.ai.promptExtractTasks',
}

export const NOTES_AI_ACTIONS: AIActionMode[] = ['extract-tasks', 'analyze', 'expand', 'summarize']

export function parseNotesAiPrompts(raw: string | null): Partial<Record<AIActionMode, string>> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const next: Partial<Record<AIActionMode, string>> = {}
    for (const mode of NOTES_AI_ACTIONS) {
      const value = (parsed as Record<string, unknown>)[mode]
      if (typeof value === 'string' && value.trim()) next[mode] = value
    }
    return next
  } catch {
    return {}
  }
}

export function serializeNotesAiPrompts(prompts: Partial<Record<AIActionMode, string>>): string {
  const next: Partial<Record<AIActionMode, string>> = {}
  for (const mode of NOTES_AI_ACTIONS) {
    const value = prompts[mode]?.trim()
    if (value) next[mode] = value
  }
  return JSON.stringify(next)
}

export function resolveNotesAiInstruction(
  mode: AIActionMode,
  translate: (key: string) => string,
  stored: Partial<Record<AIActionMode, string>> = {},
): string {
  const custom = stored[mode]?.trim()
  return custom || translate(NOTES_AI_PROMPT_KEYS[mode])
}
