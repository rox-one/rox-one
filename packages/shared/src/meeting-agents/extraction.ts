/**
 * Meeting candidate extraction with provenance and safety filters (issue #364).
 * Invalid JSON: one bounded repair, then a visible failure. Free text never replaces the schema.
 */

export const EXTRACTION_CANDIDATE_KINDS = [
  'task',
  'decision',
  'question',
  'requirement',
  'risk',
  'blocker',
  'commitment',
] as const

export type ExtractionCandidateKind = (typeof EXTRACTION_CANDIDATE_KINDS)[number]

export type RelativeDue = {
  phrase: string
  referenceInstant: string
  timeZone: string
  date?: string
  unresolved?: boolean
}

export type MeetingCandidate = {
  kind: ExtractionCandidateKind
  text: string
  executable: boolean
  ownerResolution: 'unique-member' | 'unresolved' | 'none'
  ownerName?: string
  due?: RelativeDue
  evidence: { segmentId: string; segmentRevision: number; quote: string }
  stale?: boolean
  conditionRequired?: boolean
}

export type ExtractionResult =
  | { ok: true; candidates: MeetingCandidate[] }
  | { ok: false; code: 'invalid-json' | 'repair-failed'; message: string }

export type ExtractionAdapter = {
  extract(input: { text: string; promptVersion: number }): Promise<unknown>
  repair?(input: { text: string; invalid: unknown }): Promise<unknown>
}

export type ExtractionContext = {
  text: string
  participants: readonly string[]
  referenceInstant: string
  timeZone: string
  segmentId: string
  segmentRevision: number
  promptVersion?: number
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  воскресенье: 0,
  понедельник: 1,
  вторник: 2,
  сред: 3,
  четверг: 4,
  пятниц: 5,
  суббот: 6,
}

export function extractMeetingCandidates(
  context: ExtractionContext,
  adapter: ExtractionAdapter,
): Promise<ExtractionResult> {
  return runExtract(context, adapter)
}

async function runExtract(context: ExtractionContext, adapter: ExtractionAdapter): Promise<ExtractionResult> {
  const promptVersion = context.promptVersion ?? 1
  let raw: unknown
  try {
    raw = await adapter.extract({ text: context.text, promptVersion })
  } catch (error) {
    return { ok: false, code: 'invalid-json', message: error instanceof Error ? error.message : 'extract failed' }
  }
  const parsed = parseCandidates(raw)
  if (!parsed.ok) {
    if (adapter.repair) {
      try {
        const repaired = await adapter.repair({ text: context.text, invalid: raw })
        const second = parseCandidates(repaired)
        if (!parsedIsCandidates(second)) {
          return { ok: false, code: 'repair-failed', message: 'Repair did not produce a valid candidate list' }
        }
        return { ok: true, candidates: safetyFilter(second, context) }
      } catch {
        return { ok: false, code: 'repair-failed', message: 'Repair failed' }
      }
    }
    return { ok: false, code: 'invalid-json', message: 'Candidate payload is not valid JSON schema' }
  }
  return { ok: true, candidates: safetyFilter(parsed.candidates, context) }
}

function parsedIsCandidates(value: { ok: true; candidates: MeetingCandidate[] } | { ok: false }): value is { ok: true; candidates: MeetingCandidate[] } {
  return value.ok
}

function parseCandidates(raw: unknown): { ok: true; candidates: MeetingCandidate[] } | { ok: false } {
  if (!raw || typeof raw !== 'object') return { ok: false }
  const obj = raw as Record<string, unknown>
  const list = Array.isArray(obj.candidates) ? obj.candidates : Array.isArray(raw) ? raw : null
  if (!list) return { ok: false }
  const candidates: MeetingCandidate[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') return { ok: false }
    const row = item as Record<string, unknown>
    if (typeof row.kind !== 'string' || !(EXTRACTION_CANDIDATE_KINDS as readonly string[]).includes(row.kind)) {
      return { ok: false }
    }
    if (typeof row.text !== 'string') return { ok: false }
    candidates.push({
      kind: row.kind as ExtractionCandidateKind,
      text: row.text,
      executable: row.executable === true,
      ownerResolution: 'none',
      evidence: {
        segmentId: typeof row.segmentId === 'string' ? row.segmentId : 'unknown',
        segmentRevision: typeof row.segmentRevision === 'number' ? row.segmentRevision : 0,
        quote: row.text,
      },
    })
  }
  return { ok: true, candidates }
}

export function safetyFilter(candidates: MeetingCandidate[], context: ExtractionContext): MeetingCandidate[] {
  const text = context.text
  const negation = /не (создавайте|делайте)|не делаем|только идея|выполнять это не нужно|отменяем/i.test(text)
  const quoted = /привёл пример:|пример:|said:|quoted/i.test(text)
  const injection = /игнорируй правила|ignore (all )?rules|attacker@/i.test(text)
  const conditional = /^если |if /i.test(text.trim())
  const retraction = /отменяем|cancel(ling)? that|never mind/i.test(text)

  return candidates.map((candidate) => {
    const next: MeetingCandidate = {
      ...candidate,
      evidence: {
        segmentId: context.segmentId,
        segmentRevision: context.segmentRevision,
        quote: context.text,
      },
    }
    if (injection || quoted || (negation && candidate.kind === 'task')) {
      next.executable = false
      next.kind = candidate.kind === 'task' ? 'question' : candidate.kind
    }
    if (conditional) {
      next.executable = false
      next.conditionRequired = true
    }
    if (retraction) {
      next.stale = true
      next.executable = false
    }
    if (next.kind === 'task' && next.executable) {
      const owner = resolveOwner(text, context.participants)
      next.ownerResolution = owner.resolution
      next.ownerName = owner.name
      next.due = resolveRelativeDue(text, context.referenceInstant, context.timeZone)
    } else {
      next.ownerResolution = 'none'
    }
    if (next.ownerResolution === 'unresolved') next.executable = false
    if (next.due?.unresolved) next.executable = false
    return next
  }).filter((candidate) => {
    if (injection) return candidate.kind !== 'task' || !candidate.executable
    return true
  })
}

export function resolveOwner(
  text: string,
  participants: readonly string[],
): { resolution: MeetingCandidate['ownerResolution']; name?: string } {
  const mentioned = participants.filter((name) => {
    const first = name.split(/\s+/)[0] ?? ''
    return first.length > 1 && text.includes(first)
  })
  if (mentioned.length === 1) return { resolution: 'unique-member', name: mentioned[0] }
  if (mentioned.length > 1) return { resolution: 'unresolved' }
  return { resolution: 'none' }
}

export function resolveRelativeDue(text: string, referenceInstant: string, timeZone: string): RelativeDue {
  const phraseMatch = text.match(/к ([а-яё]+)|by (\w+)|on (\w+)/i)
  const phrase = phraseMatch?.[0] ?? text
  const due: RelativeDue = { phrase, referenceInstant, timeZone }
  const lower = text.toLowerCase()
  let weekday: number | undefined
  for (const [token, day] of Object.entries(WEEKDAYS)) {
    if (lower.includes(token)) weekday = day
  }
  if (weekday === undefined) {
    due.unresolved = true
    return due
  }
  const date = nextWeekdayDate(referenceInstant, timeZone, weekday)
  due.date = date
  return due
}

function nextWeekdayDate(referenceInstant: string, timeZone: string, weekday: number): string {
  const instant = new Date(referenceInstant)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(instant)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const day = Number(parts.find((part) => part.type === 'day')?.value)
  const utc = Date.UTC(year, month - 1, day)
  const current = new Date(utc).getUTCDay()
  let delta = weekday - current
  if (delta <= 0) delta += 7
  const target = new Date(utc)
  target.setUTCDate(target.getUTCDate() + delta)
  const y = target.getUTCFullYear()
  const m = String(target.getUTCMonth() + 1).padStart(2, '0')
  const d = String(target.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
