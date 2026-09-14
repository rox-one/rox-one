/** One request belongs to one composer; a later request or scope change expires it. */
export function createDictationRequestGuard() {
  let generation = 0
  let scope: string | undefined
  return {
    begin(sessionId: string | undefined) {
      scope = sessionId
      return ++generation
    },
    isCurrent(request: number, sessionId: string | undefined) {
      return request === generation && scope === sessionId
    },
    cancel() { generation += 1 },
  }
}

/** Append to the draft that exists when transcription finishes, preserving its whitespace. */
export function appendDictationTranscript(draft: string, transcript: string): string {
  const text = transcript.trim()
  if (!text) return draft
  return draft ? `${draft}${/\s$/.test(draft) ? '' : ' '}${text}` : text
}
