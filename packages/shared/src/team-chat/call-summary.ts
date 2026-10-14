/**
 * AI summary of a finished call: OpenAI-compatible chat completion against the
 * user's Rox connection (default api.rox.one/v1). Rox R1 Max first, then
 * DeepSeek V4.1 Flash. The API key is passed in by the caller and never logged.
 */
import type { TeamCallTranscriptSegment } from './types.ts'

export const CALL_SUMMARY_MODELS = ['rox/r1-max', 'rox/deepseek-v4.1-flash'] as const
const TRANSCRIPT_PROMPT_MAX = 60_000

export interface CallSummaryInput {
  segments: TeamCallTranscriptSegment[]
  baseUrl: string
  apiKey: string
  models?: readonly string[]
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export function callSummaryPrompt(segments: TeamCallTranscriptSegment[]): string {
  return segments.map(s => `${s.speakerName || s.speakerId}: ${s.text}`).join('\n').slice(0, TRANSCRIPT_PROMPT_MAX)
}

/** Returns `{ model, text }` from the first model that answers, or null. */
export async function summarizeCall(input: CallSummaryInput): Promise<{ model: string; text: string } | null> {
  const transcript = callSummaryPrompt(input.segments)
  if (!transcript.trim() || !input.apiKey) return null
  const doFetch = input.fetchImpl ?? fetch
  const url = `${input.baseUrl.replace(/\/+$/, '')}/chat/completions`
  for (const model of input.models ?? CALL_SUMMARY_MODELS) {
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: 600,
          messages: [
            { role: 'system', content: 'Summarize this call transcript in the language of the call: 2–5 bullet points, then decisions and action items with owners. Use only what was said.' },
            { role: 'user', content: transcript },
          ],
        }),
        signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
      })
      if (!res.ok) continue
      const json = await res.json() as { choices?: Array<{ message?: { content?: unknown } }> }
      const text = json.choices?.[0]?.message?.content
      if (typeof text === 'string' && text.trim()) return { model, text: text.trim() }
    } catch {
      // try the next model
    }
  }
  return null
}
