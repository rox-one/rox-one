/**
 * Internal one-shot prompts Rox sends to a backend on its own behalf (memory
 * distillation, memory proposals). They are not user conversations: when a
 * CLI backend persisted such a run as a session (omp `-p` before
 * `--no-session`), the foreign importer must skip it and Лента must not show
 * it among «Действия агентов».
 */
export const INTERNAL_PROMPT_PREFIXES: readonly string[] = [
  // packages/server-core/src/memory/MemoryService.ts buildDistillPrompt
  'You are the memory distiller for a coding agent.',
  // packages/shared/src/memory/proposals.ts
  'You extract durable memory from a chat between a user and an AI assistant.',
]

/** True when the first user message of a session is a Rox-internal prompt. */
export function isInternalAgentPrompt(text: string | null | undefined): boolean {
  if (!text) return false
  const head = text.trimStart()
  return INTERNAL_PROMPT_PREFIXES.some((prefix) => head.startsWith(prefix))
}
