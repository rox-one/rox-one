/**
 * Решения — persistence, agent-memory sync and extraction runs.
 * Accepted decisions are written to WORKSPACE memory lessons (already injected
 * into every agent's system prompt): the decision as a rule, each rejected
 * option as a MUST NOT rule, so agents don't re-propose rejected options.
 */
import { extractJsonBlock, readAgentRun, startAgentRun } from '@/lib/extra-screens/agent-run'
import { loadWorkspaceJson, newLocalId, saveWorkspaceJson } from '@/lib/extra-screens/storage'
import {
  buildExtractionPrompt,
  diffLessonRules,
  lessonRulesFor,
  meetingTranscript,
  normalizeDecisionsData,
  parseDecisionCandidates,
  sessionTranscript,
  type Decision,
  type DecisionExtraction,
  type DecisionSource,
  type DecisionsData,
} from './decisions-model'

export const DECISIONS_NS = 'decisions'
export const DECISION_LESSON_CATEGORY = 'decision'

export function loadDecisions(workspaceId: string | null): DecisionsData {
  return loadWorkspaceJson(DECISIONS_NS, workspaceId, normalizeDecisionsData)
}

export function saveDecisions(workspaceId: string | null, data: DecisionsData): void {
  saveWorkspaceJson(DECISIONS_NS, workspaceId, data)
}

export function memoryApiAvailable(): boolean {
  const api = window.electronAPI
  return typeof api?.addMemoryLesson === 'function' && typeof api?.deleteMemoryLesson === 'function'
}

/** Bring workspace memory in line with the decision; returns the rule texts now synced. */
export async function syncDecisionLessons(workspaceId: string, decision: Decision): Promise<string[]> {
  if (!memoryApiAvailable()) return decision.syncedRules
  const api = window.electronAPI
  const { add, remove } = diffLessonRules(decision.syncedRules, lessonRulesFor(decision))
  const synced = new Set(decision.syncedRules)
  for (const rule of remove) {
    try {
      await api.deleteMemoryLesson(workspaceId, 'workspace', rule)
      synced.delete(rule)
    } catch (error) {
      console.warn('[decisions] delete lesson failed', error)
    }
  }
  for (const rule of add) {
    try {
      await api.addMemoryLesson(workspaceId, { rule: rule.rule, category: DECISION_LESSON_CATEGORY, negative: rule.negative, scope: 'workspace' })
      synced.add(rule.rule)
    } catch (error) {
      console.warn('[decisions] add lesson failed', error)
    }
  }
  return [...synced]
}

export async function removeDecisionLessons(workspaceId: string, decision: Decision): Promise<void> {
  if (!memoryApiAvailable()) return
  for (const rule of decision.syncedRules) {
    try {
      await window.electronAPI.deleteMemoryLesson(workspaceId, 'workspace', rule)
    } catch {
      // already gone
    }
  }
}

/** Rule texts actually present in workspace memory (to show honest sync status). */
export async function listWorkspaceLessonRules(workspaceId: string): Promise<Set<string> | null> {
  const api = window.electronAPI
  if (typeof api?.listMemoryLessons !== 'function') return null
  try {
    const lessons = await api.listMemoryLessons('workspace', workspaceId)
    return new Set(lessons.map((lesson) => lesson.rule))
  } catch {
    return null
  }
}

export async function loadSourceTranscript(workspaceId: string, source: DecisionSource): Promise<string> {
  const api = window.electronAPI
  if (source.kind === 'session' && source.id) {
    const session = (await api.getSessionMessages(source.id)) as { messages?: { role?: string; content?: string; isIntermediate?: boolean }[] } | null
    return sessionTranscript(session?.messages)
  }
  if (source.kind === 'meeting' && source.id && typeof api.getMeeting === 'function') {
    return meetingTranscript(await api.getMeeting(workspaceId, source.id))
  }
  return ''
}

export async function startExtraction(
  workspaceId: string,
  source: DecisionSource,
  language: 'ru' | 'en',
  sessionName: string,
): Promise<DecisionExtraction | { error: 'empty' }> {
  const transcript = await loadSourceTranscript(workspaceId, source)
  if (!transcript.trim()) return { error: 'empty' }
  const sessionId = await startAgentRun({ workspaceId, name: sessionName, prompt: buildExtractionPrompt(source, transcript, language) })
  const extraction: DecisionExtraction = { id: newLocalId('ext'), sessionId, source, startedAt: Date.now() }
  const fresh = loadDecisions(workspaceId)
  saveDecisions(workspaceId, { ...fresh, extractions: [extraction, ...fresh.extractions].slice(0, 30) })
  return extraction
}

/** Poll an extraction; when done, add its candidates. Returns true when finished. */
export async function syncExtraction(workspaceId: string, extractionId: string): Promise<boolean> {
  const data = loadDecisions(workspaceId)
  const extraction = data.extractions.find((e) => e.id === extractionId)
  if (!extraction || extraction.parsedAt) return true
  const run = await readAgentRun(extraction.sessionId)
  if (run.exists && (run.processing || !run.text)) return false
  const candidates = run.exists ? parseDecisionCandidates(extractJsonBlock(run.text), { extractionId, source: extraction.source }) : null
  const fresh = loadDecisions(workspaceId)
  saveDecisions(workspaceId, {
    ...fresh,
    candidates: [...(candidates ?? []), ...fresh.candidates.filter((c) => c.extractionId !== extractionId)],
    extractions: fresh.extractions.map((e) =>
      e.id === extractionId ? { ...e, parsedAt: Date.now(), failed: candidates == null || undefined, found: candidates?.length ?? 0 } : e,
    ),
  })
  return true
}
