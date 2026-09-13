export const IMPROVE_MODULES = [
  'plan', 'prd', 'interview', 'skills', 'tasks', 'acceptance',
  'scope_context', 'assumptions_unknowns', 'output_contract', 'constraints_budgets',
  'dependencies_sequence', 'tests_edge_cases', 'risks_security_rollback', 'sources_fact_check',
] as const
export type ImproveModuleId = (typeof IMPROVE_MODULES)[number]
export type EnhancementMode = 'verbatim' | 'clean' | 'improve-prompt'
export const PROMPT_VERSION = 'voice-process-v1'
export const MODULE_ORDER: readonly ImproveModuleId[] = IMPROVE_MODULES
export const MODULE_INSTRUCTIONS: Record<ImproveModuleId, string> = {
  plan: 'Outline a concrete plan of steps. Do not execute them.',
  prd: 'Turn the request into a PRD with goals, non-goals, and requirements.',
  interview: 'Ask clarifying questions first. Mark unknowns instead of inventing answers.',
  skills: 'Suggest relevant installed skills by id/name only. Do not execute skill code.',
  tasks: 'Break the request into tasks and subtasks.',
  acceptance: 'Write measurable acceptance criteria.',
  scope_context: 'State context and boundaries.',
  assumptions_unknowns: 'List assumptions and unknowns explicitly.',
  output_contract: 'Specify expected artifact format.',
  constraints_budgets: 'Capture constraints, budgets, and hard limits.',
  dependencies_sequence: 'Order dependencies without skipping blockers.',
  tests_edge_cases: 'List tests and edge cases.',
  risks_security_rollback: 'Call out risks, security, and rollback.',
  sources_fact_check: 'Require sources for added facts; otherwise mark as assumption.',
}
export function canonicalizeModules(selected: readonly string[]): ImproveModuleId[] {
  const wanted = new Set(selected.filter((id): id is ImproveModuleId => (IMPROVE_MODULES as readonly string[]).includes(id)))
  return MODULE_ORDER.filter((id) => wanted.has(id))
}
export function conflictNote(modules: readonly ImproveModuleId[]): string | undefined {
  if (modules.includes('interview') && modules.includes('prd')) {
    return 'Interview questions come first; the PRD must mark unknowns instead of inventing answers.'
  }
  return undefined
}
