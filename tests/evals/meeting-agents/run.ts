/**
 * I030 eval runner. Fixture holdout is in-repo semantic cases.
 * Live api.rox.one remains not_run unless MEETING_EVAL_LIVE=1 is set
 * with an already-permitted route (this runner never invents a live call).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractMeetingCandidates, type ExtractionAdapter } from '@craft-agent/shared/meeting-agents'
import { conversationMetrics } from '../../../packages/server-core/src/meetings/observability.ts'

const here = dirname(fileURLToPath(import.meta.url))

type Thresholds = {
  schemaVersion: number
  status: string
  taskPrecisionMin: number
  falsePositiveMax: number
  taskRecallMin: number
  abstainRateMax: number
  citationValidityMin: number
}

type SemanticFixture = {
  schemaVersion: number
  referenceInstant: string
  timeZone: string
  cases: Array<{
    id: string
    text: string
    participants?: string[]
    expected: {
      taskCount?: number
      executableTaskCount?: number
      dueDate?: string
      ownerResolution?: string
      conditionRequired?: boolean
      prototypeProposal?: string
      externalWrites?: number
      policyBypass?: boolean
      deleteProposals?: number
    }
  }>
}

const thresholds = JSON.parse(readFileSync(join(here, 'thresholds.json'), 'utf8')) as Thresholds
const fixture = JSON.parse(
  readFileSync(join(here, '../../fixtures/meeting-agents/semantic-cases.json'), 'utf8'),
) as SemanticFixture

const naive: ExtractionAdapter = {
  async extract({ text }) {
    return { candidates: [{ kind: 'task', text, executable: true }] }
  },
}

function expectedExecutable(item: SemanticFixture['cases'][number]): number {
  if (item.expected.executableTaskCount !== undefined) return item.expected.executableTaskCount
  if (item.expected.taskCount !== undefined) return item.expected.taskCount
  if (item.expected.externalWrites === 0) return 0
  return 0
}

async function scoreFixture() {
  let truePositive = 0
  let falsePositive = 0
  let falseNegative = 0
  let abstain = 0
  let resolvedOwner = 0
  let resolvedOwnerCorrect = 0
  let resolvedDate = 0
  let resolvedDateCorrect = 0
  let citationsValid = 0
  let citationsTotal = 0
  const latenciesMs: number[] = []

  for (const item of fixture.cases) {
    const started = Date.now()
    const result = await extractMeetingCandidates({
      text: item.text,
      participants: item.participants ?? ['Иван'],
      referenceInstant: fixture.referenceInstant,
      timeZone: fixture.timeZone,
      segmentId: item.id,
      segmentRevision: 1,
    }, naive)
    latenciesMs.push(Date.now() - started)
    if (!result.ok) {
      falseNegative += 1
      continue
    }
    const executable = result.candidates.filter((candidate) => candidate.executable && candidate.kind === 'task')
    const want = expectedExecutable(item)
    if (want === 0 && executable.length === 0) truePositive += 1
    else if (want > 0 && executable.length === want) truePositive += 1
    else if (executable.length > want) falsePositive += 1
    else falseNegative += 1

    if (item.expected.ownerResolution === 'unresolved') {
      abstain += result.candidates.some((candidate) => candidate.ownerResolution === 'unresolved') ? 1 : 0
    }
    for (const candidate of result.candidates) {
      if (candidate.evidence?.quote) {
        citationsTotal += 1
        if (item.text.includes(candidate.evidence.quote) || candidate.evidence.quote.includes(item.text.slice(0, 8))) {
          citationsValid += 1
        }
      }
      if (candidate.ownerResolution === 'unique-member' || candidate.ownerResolution === 'unresolved') {
        resolvedOwner += 1
        if (item.expected.ownerResolution && candidate.ownerResolution === item.expected.ownerResolution) {
          resolvedOwnerCorrect += 1
        }
      }
      if (candidate.due?.date) {
        resolvedDate += 1
        if (item.expected.dueDate && candidate.due.date === item.expected.dueDate) resolvedDateCorrect += 1
      }
    }
  }

  return conversationMetrics({
    truePositive,
    falsePositive,
    falseNegative,
    abstain,
    resolvedOwner,
    resolvedOwnerCorrect,
    resolvedDate,
    resolvedDateCorrect,
    citationsValid,
    citationsTotal,
    latenciesMs,
  })
}

const metrics = await scoreFixture()
const liveRequested = process.env.MEETING_EVAL_LIVE === '1'
const live = {
  result: 'not_run' as const,
  level: 'L4',
  blocker: liveRequested
    ? 'MEETING_EVAL_LIVE is set but this runner does not call api.rox.one from this slice'
    : 'Live api.rox.one holdout is out of scope until a permitted live route is attached',
}

const failed = metrics.taskPrecision < thresholds.taskPrecisionMin
  || metrics.falsePositiveRate > thresholds.falsePositiveMax
  || metrics.taskRecall < thresholds.taskRecallMin
  || metrics.abstainRate > thresholds.abstainRateMax

const report = {
  caseId: 'E30',
  result: failed ? 'failed' : 'passed',
  level: 'U1',
  live,
  thresholds,
  metrics,
  formulas: {
    taskPrecision: 'tp / (tp + fp)',
    taskRecall: 'tp / (tp + fn)',
    abstainRate: 'abstain / (tp + fp + fn + abstain)',
    p95Ms: 'ascending latency percentile 0.95',
  },
  corpusHash: 'semantic-cases.json#schemaVersion=1',
  modelRoute: 'fixture-extractor',
}

const evidenceDir = join(here, '../../../.scratch/meeting-agents-eval')
mkdirSync(evidenceDir, { recursive: true })
const evidencePath = join(evidenceDir, 'e30.json')
writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ ...report, evidencePath }))
if (failed) process.exit(1)
