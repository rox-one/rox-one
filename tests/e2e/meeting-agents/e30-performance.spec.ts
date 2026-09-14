import { test, expect } from '@playwright/test'
import {
  MeetingBackpressureQueue,
  MeetingBudgetLedger,
  conversationMetrics,
} from '../../../packages/server-core/src/meetings/observability.ts'
import { evidenceRow, writeEvidence } from './harness.ts'
import { isElectronAppBuilt } from './electron-factory.ts'

test('E30 budgets, backpressure, and conversation metrics (U1/C2)', async () => {
  const ledger = new MeetingBudgetLedger(10)
  expect(ledger.reserve('a', 6).ok).toBe(true)
  expect(ledger.reserve('b', 6).ok).toBe(false)
  ledger.markUnknown('a')
  expect(() => ledger.settle('a', 0)).toThrow('unknown-budget-must-reconcile')
  const queue = new MeetingBackpressureQueue({ maxConcurrent: 2, maxQueue: 2, maxBytes: 20 })
  queue.note429(1)
  expect(conversationMetrics({
    truePositive: 1,
    falsePositive: 0,
    falseNegative: 0,
    abstain: 0,
    resolvedOwner: 1,
    resolvedOwnerCorrect: 1,
    resolvedDate: 1,
    resolvedDateCorrect: 1,
    citationsValid: 1,
    citationsTotal: 1,
    latenciesMs: [12, 40, 80],
  }).p95Ms).toBe(80)

  if (!isElectronAppBuilt()) {
    writeEvidence(evidenceRow('E3', 'not_run', {
      caseId: 'E30',
      command: 'bun run test:meetings:eval',
      blocker: 'apps/electron dist/main.cjs or renderer is not built; U1/C2 budgets passed',
    }))
    return
  }
  writeEvidence(evidenceRow('E3', 'not_run', {
    caseId: 'E30',
    command: 'bun run test:meetings:e2e',
    blocker: 'Packaged 60min native capture is N5/L4 and is not claimed from this C2 slice',
  }))
})
