/**
 * c1.5 recall lanes + c1.6 standing intents — deterministic engine (shared).
 * Pure functions only: no I/O, no model calls. Adapted from OpenClaw
 * `active-memory/trigger-recall.ts`, `active-memory/escalation.ts` and
 * `memory-core/src/standing-intents-model.ts` (port-matrix rows c1.5/c1.6).
 */
import { describe, expect, it } from 'bun:test'
import type { MemoryOriginClass } from '../types'
import {
  RECALL_ESCALATION_MAX_RESULTS,
  RECALL_INJECTION_LIMIT,
  RECALL_STRONG_MATCH_SCORE,
  buildStandingIntentBlock,
  hasRecallIntent,
  intentTriggerMatches,
  isTimeOnlyIntent,
  matchStandingIntents,
  parseRecallEscalationReply,
  resolveRecallEscalationDecision,
  scoreLexicalRecall,
  selectLaneOneRecall,
  selectRecallMatches,
  tokenizeIntentText,
} from '../context-select'

const entry = (orderKey: string, text: string) => ({ item: orderKey, orderKey, text })

describe('c1.5 lane one — deterministic lexical trigger', () => {
  it('identical input yields identical output (repeat run equality)', () => {
    const entries = [
      entry('b', 'deploy previews through the vercel pipeline'),
      entry('a', 'billing ledger reconciliation runbook'),
      entry('c', 'unrelated note about fonts'),
    ]
    const first = selectLaneOneRecall('deploy previews vercel', entries)
    expect(first.map((s) => s.orderKey)).toEqual(['b'])
    const second = selectLaneOneRecall('deploy previews vercel', entries)
    expect(second).toEqual(first)
    // Input order must not influence the selection.
    const shuffled = selectLaneOneRecall('deploy previews vercel', [...entries].reverse())
    expect(shuffled).toEqual(first)
  })

  it('threshold boundary: 0.649 is rejected, 0.65 is admitted', () => {
    expect(RECALL_STRONG_MATCH_SCORE).toBe(0.65)
    const selected = selectRecallMatches<number>([
      { item: 1, orderKey: 'below', score: 0.649 },
      { item: 2, orderKey: 'at', score: 0.65 },
    ])
    expect(selected.map((s) => s.item)).toEqual([2])
  })

  it('caps the selection at top 3 and orders by score then stable key', () => {
    const entries = [
      entry('e', 'alpha alpha alpha alpha alpha'),
      entry('d', 'alpha alpha alpha alpha'),
      entry('c', 'alpha alpha alpha'),
      entry('b', 'alpha alpha'),
      entry('a', 'alpha'),
    ]
    const selected = selectLaneOneRecall('alpha', entries)
    // Every entry scores 0.85 (single-word query); ties break on orderKey asc.
    expect(selected.length).toBe(RECALL_INJECTION_LIMIT)
    expect(selected.map((s) => s.orderKey)).toEqual(['a', 'b', 'c'])
  })

  it('scores [0,1] and mirrors the upstream single-word weighting', () => {
    expect(scoreLexicalRecall('vercel', 'vercel deploy pipeline')).toBe(0.85)
    expect(scoreLexicalRecall('vercel', 'nothing here')).toBe(0)
    const multi = scoreLexicalRecall('deploy previews vercel', 'deploy previews through vercel')
    expect(multi).toBeGreaterThanOrEqual(RECALL_STRONG_MATCH_SCORE)
    expect(multi).toBeLessThanOrEqual(1)
    expect(scoreLexicalRecall('', 'anything')).toBe(0)
  })
})

describe('c1.5 lane two — escalation decision', () => {
  const base = { message: 'what did we decide about vercel last week', hasStrongLaneOneHit: false, eligibleCandidateCount: 2 }

  it('never escalates when the mode is off', () => {
    expect(resolveRecallEscalationDecision({ ...base, mode: 'off' })).toBe('mode-off')
  })

  it('does not escalate when lane one already had a strong hit', () => {
    expect(resolveRecallEscalationDecision({ ...base, mode: 'auto', hasStrongLaneOneHit: true })).toBe('strong-lane-one-hit')
  })

  it('does not escalate without recall intent or without eligible candidates', () => {
    expect(resolveRecallEscalationDecision({ ...base, mode: 'auto', message: 'add a button to the header' })).toBe('no-recall-intent')
    expect(resolveRecallEscalationDecision({ ...base, mode: 'auto', eligibleCandidateCount: 0 })).toBe('no-eligible-candidates')
  })

  it('escalates when lane one is inconclusive and the message shows recall intent', () => {
    expect(resolveRecallEscalationDecision({ ...base, mode: 'auto' })).toBe('recall')
    expect(hasRecallIntent(base.message)).toBe(true)
    expect(resolveRecallEscalationDecision({ ...base, mode: 'always', message: 'add a button' })).toBe('recall')
  })

  it('validates the sub-agent reply against the offered ids, deduplicated and capped', () => {
    const allowed = ['a', 'b', 'c', 'd', 'e']
    expect(parseRecallEscalationReply('{"ids":["a","a","x","b"]}', allowed)).toEqual(['a', 'b'])
    expect(parseRecallEscalationReply('```json\n{"ids":["e","d","c","b"]}\n```', allowed)).toEqual(['e', 'd', 'c'])
    expect(parseRecallEscalationReply('not json', allowed)).toEqual([])
    expect(parseRecallEscalationReply('{"ids":"a"}', allowed)).toEqual([])
    expect(RECALL_ESCALATION_MAX_RESULTS).toBe(3)
  })
})

describe('c1.6 standing intents — matching engine', () => {
  const intent = (over: Partial<{ id: string; trigger: string; text: string; status: string; originClass: MemoryOriginClass }> = {}) => ({
    id: over.id ?? 'i1',
    trigger: over.trigger ?? 'billing ledger',
    text: over.text ?? 'When touching billing, run the ledger reconciliation tests.',
    status: over.status ?? 'armed',
    provenance: { originClass: over.originClass ?? 'owner' },
  })

  it('tokenizes triggers and requires every trigger token in the prompt', () => {
    expect(tokenizeIntentText('Billing ledger')).toEqual(['billing', 'ledger'])
    expect(intentTriggerMatches('billing ledger', new Set(['billing', 'ledger', 'flow']))).toBe(true)
    expect(intentTriggerMatches('billing ledger', new Set(['billing']))).toBe(false)
  })

  it('rejects time-only reminders (cron owns scheduling)', () => {
    expect(isTimeOnlyIntent('remind me tomorrow at 9')).toBe(true)
    expect(isTimeOnlyIntent('in 2 hours ping the team')).toBe(true)
    expect(isTimeOnlyIntent('what did we decide yesterday')).toBe(true)
    expect(isTimeOnlyIntent('when editing the billing module, remind me to run ledger tests')).toBe(false)
  })

  it('matches armed, injectable, event-conditioned intents once and deduplicated', () => {
    const intents = [
      intent(),
      intent({ id: 'i1' }), // duplicate id must not double-inject
      intent({ id: 'i2', status: 'done' }),
      intent({ id: 'i3', originClass: 'untrusted' }),
      intent({ id: 'i4', text: 'remind me tomorrow at 9' }),
      intent({ id: 'i5', trigger: 'unrelated' }),
    ]
    const matched = matchStandingIntents(intents, 'please refactor the billing ledger module')
    expect(matched.map((m) => m.id)).toEqual(['i1'])
    expect(buildStandingIntentBlock(matched)).toContain('ledger reconciliation')
    expect(buildStandingIntentBlock([])).toBeUndefined()
  })

  it('caps the number of intents injected per turn', () => {
    const intents = Array.from({ length: 5 }, (_, i) => intent({ id: `i${i}`, text: `rule ${i}` }))
    expect(matchStandingIntents(intents, 'billing ledger').length).toBe(3)
  })
})