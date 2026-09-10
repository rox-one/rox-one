/**
 * Idle prompt history for the chat input (H2).
 *
 * Consecutive duplicates are skipped. Navigation does not wrap: ArrowDown past
 * the newest entry restores the in-progress draft. Index `null` means the live
 * draft, not a recalled prompt.
 */

export interface PromptHistory {
  entries: string[]
  index: number | null
  draft: string
}

export const EMPTY_PROMPT_HISTORY: PromptHistory = {
  entries: [],
  index: null,
  draft: '',
}

const MAX_ENTRIES = 50

export function recordPrompt(history: PromptHistory, prompt: string): PromptHistory {
  const text = prompt.trim()
  if (!text) {
    return { entries: history.entries, index: null, draft: '' }
  }
  const last = history.entries[history.entries.length - 1]
  const entries = last === text
    ? history.entries
    : [...history.entries.slice(-(MAX_ENTRIES - 1)), text]
  return { entries, index: null, draft: '' }
}

export function navigatePromptHistory(
  history: PromptHistory,
  direction: 'up' | 'down',
  currentInput: string,
): { history: PromptHistory; value: string | null } {
  if (history.entries.length === 0) {
    return { history, value: null }
  }

  if (direction === 'up') {
    if (history.index === null) {
      const index = history.entries.length - 1
      return {
        history: { ...history, index, draft: currentInput },
        value: history.entries[index] ?? null,
      }
    }
    if (history.index === 0) {
      return { history, value: null }
    }
    const index = history.index - 1
    return {
      history: { ...history, index },
      value: history.entries[index] ?? null,
    }
  }

  if (history.index === null) {
    return { history, value: null }
  }
  if (history.index >= history.entries.length - 1) {
    return {
      history: { ...history, index: null },
      value: history.draft,
    }
  }
  const index = history.index + 1
  return {
    history: { ...history, index },
    value: history.entries[index] ?? null,
  }
}

export function isBrowsingPromptHistory(history: PromptHistory): boolean {
  return history.index !== null
}
