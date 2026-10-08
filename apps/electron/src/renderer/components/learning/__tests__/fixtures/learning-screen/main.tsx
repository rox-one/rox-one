// Real-Chromium visual fixture for the production LearningScreen.
// The component, i18n and tailwind styles are real; only the Electron bridge
// (`window.electronAPI.learning*`) and the AppShell context are stubbed.
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { setupI18n } from '@rox/shared/i18n/setupI18n'
import { initReactI18next } from 'react-i18next'
import { LearningScreen } from '../../../LearningScreen'
import '../../../../../index.css'

const i18n = setupI18n([initReactI18next])
await i18n.changeLanguage('en')

const at = (day: number, minute: number) => new Date(Date.UTC(2026, 9, day, 12, minute)).toISOString()

const skillPending = {
  id: 'cand-skill-1',
  fingerprint: 'fp-skill-1',
  type: 'skill',
  scope: 'workspace',
  hypothesis: 'Prefer bun add over editing package.json by hand',
  payload: { slug: 'bun-add-first' },
  evidence: [
    { evidenceId: 'ev-session-1', type: 'session', ref: 'session-stub-1', weight: 0.8 },
    { evidenceId: 'ev-test-1', type: 'test_result', ref: 'test-stub-1', weight: 0.6 },
  ],
  confidence: 0.82,
  confidenceComponents: { recurrence: 0.8, evidenceQuality: 0.7, userSignal: 0.9, repositorySupport: 0.75, outcomeSupport: 0.8, consistency: 0.85 },
  status: 'candidate',
  validation: {
    passes: [{ pass: 'evidence_count', ok: true }, { pass: 'scope', ok: true }, { pass: 'sensitive', ok: false, detail: 'Stub pass detail: review requested' }],
    promotable: true,
    judged: { verdict: 'support', rationale: 'Stub judge rationale for the fixture' },
    checkedAt: at(4, 5),
  },
  createdAt: at(1, 0),
  updatedAt: at(6, 30),
}

const skillApproved = {
  id: 'cand-skill-2',
  fingerprint: 'fp-skill-2',
  type: 'skill',
  scope: 'project',
  hypothesis: 'Verify migrations against a shadow database before shipping',
  payload: { slug: 'db-migrations-verification' },
  evidence: [{ evidenceId: 'ev-session-2', type: 'session', ref: 'session-stub-2', weight: 0.7 }],
  confidence: 0.74,
  confidenceComponents: { recurrence: 0.6, evidenceQuality: 0.7, userSignal: 0.8, repositorySupport: 0.6, outcomeSupport: 0.7, consistency: 0.7 },
  status: 'approved',
  validation: { passes: [{ pass: 'evidence_count', ok: true }], promotable: true, checkedAt: at(3, 10) },
  createdAt: at(2, 0),
  updatedAt: at(5, 15),
}

const lessonRejected = {
  id: 'cand-lesson-1',
  fingerprint: 'fp-lesson-1',
  type: 'lesson',
  scope: 'global',
  hypothesis: 'Never run destructive git clean inside shared checkouts',
  payload: { rule: 'Never run destructive git clean inside shared checkouts', category: 'safety' },
  evidence: [{ evidenceId: 'ev-session-3', type: 'session', ref: 'session-stub-3', weight: 0.5 }],
  confidence: 0.41,
  confidenceComponents: { recurrence: 0.3, evidenceQuality: 0.4, userSignal: 0.5, repositorySupport: 0.4, outcomeSupport: 0.4, consistency: 0.5 },
  status: 'rejected',
  rejectedReason: 'Contradicted an existing global lesson',
  validation: { passes: [{ pass: 'evidence_count', ok: false, detail: 'Only 1 independent session' }], promotable: false, checkedAt: at(3, 20) },
  createdAt: at(1, 30),
  updatedAt: at(4, 45),
}

const stats = { observations: 42, candidates: 3, activeCandidates: 1, rejectedCandidates: 1, outcomes: 17, mutations: 5, revertedMutations: 1, policies: 3 }

const timeline = [
  { ts: at(6, 30), kind: 'candidate', id: 'tl-candidate', summary: 'Reflection proposed a skill candidate', detail: 'Stub reflection detail', sessionId: 'session-stub-1' },
  { ts: at(6, 10), kind: 'observation', id: 'tl-observation', summary: 'Observation recorded from stub session' },
  { ts: at(5, 50), kind: 'mutation', id: 'tl-mutation', summary: 'Skill patch applied to bun-add-first' },
  { ts: at(5, 20), kind: 'outcome', id: 'tl-outcome', summary: 'Outcome evaluated as success' },
]

const policy = {
  id: 'policy-1',
  fingerprint: 'fp-policy-1',
  taskClass: 'dependency-management',
  preferredSkills: ['bun-add-first'],
  verification: ['bun test'],
  delegation: 'prefer',
  confidence: 0.66,
  evidence: [{ evidenceId: 'ev-session-1', type: 'session', ref: 'session-stub-1', weight: 0.8 }],
  status: 'active',
  createdAt: at(2, 20),
  updatedAt: at(6, 0),
}

const promotion = {
  promoted: true,
  status: 'approved',
  mutations: [{ id: 'mut-1', candidateId: 'cand-skill-1', targetType: 'skill', targetId: 'bun-add-first', before: null, after: { slug: 'bun-add-first' }, rollbackAvailable: true, status: 'applied', ts: at(6, 40) }],
}
const rollback = { reverted: true, mutationIds: ['mut-1'], reason: 'Stub rollback reason' }
const effectiveness = {
  targetType: 'skill',
  targetId: 'cand-skill-2',
  components: { successRate: 0.8, reuseRate: 0.6, confidence: 0.74, correctionRate: 0.1, conflictRate: 0.05 },
  effectiveness: 0.77,
  sampleSize: 9,
  computedAt: at(6, 45),
}

interface FixtureWindow {
  __learningCalls: Array<{ method: string; args: unknown[] }>
  __learningFailList?: boolean
  electronAPI: Record<string, (...args: unknown[]) => Promise<unknown>>
}
// The renderer preload bridge is only declared on the real Electron window; this
// fixture supplies the same surface by re-typing the DOM window.
const fixtureWindow = window as unknown as FixtureWindow

const calls: Array<{ method: string; args: unknown[] }> = []
fixtureWindow.__learningCalls = calls
const recorded = <T,>(method: string, result: (args: unknown[]) => T) => (...args: unknown[]) => {
  calls.push({ method, args })
  return Promise.resolve(result(args))
}
fixtureWindow.electronAPI = {
  listLearningCandidates: (...args: unknown[]) => {
    calls.push({ method: 'listLearningCandidates', args })
    if (fixtureWindow.__learningFailList) return Promise.reject(new Error('simulated learning load failure'))
    return Promise.resolve([skillPending, skillApproved, lessonRejected])
  },
  getLearningStats: recorded('getLearningStats', () => stats),
  getLearningTimeline: recorded('getLearningTimeline', () => timeline),
  getLearningPolicy: recorded('getLearningPolicy', () => [policy]),
  approveLearningCandidate: recorded('approveLearningCandidate', () => promotion),
  rejectLearningCandidate: recorded('rejectLearningCandidate', () => null),
  rollbackLearningCandidate: recorded('rollbackLearningCandidate', () => rollback),
  revalidateLearningCandidate: recorded('revalidateLearningCandidate', () => skillPending),
  forceLearningReflect: recorded('forceLearningReflect', () => ({ candidates: [] })),
  runLearningConsolidation: recorded('runLearningConsolidation', () => ({ candidates: [] })),
  curateLearningSkills: recorded('curateLearningSkills', () => ({ items: [{ slug: 'bun-add-first', action: 'improve' }] })),
  runPolicyLearning: recorded('runPolicyLearning', () => ({ policies: [policy] })),
  getLearningSkillEffectiveness: recorded('getLearningSkillEffectiveness', () => effectiveness),
}

createRoot(document.getElementById('root')!).render(<LearningScreen workspaceId="fixture-workspace" />)