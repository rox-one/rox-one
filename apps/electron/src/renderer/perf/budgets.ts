import { BUNDLE_TRACK, type BudgetRule, type BudgetViolation, type InteractionKind, type InteractionSample } from './types'

export const INTERACTION_BUDGETS: Record<InteractionKind, BudgetRule> = {
  'cached-session-switch': {
    kind: 'cached-session-switch',
    p95Ms: 120,
    maxCollectionReloads: 0,
    maxGetSessions: 0,
    maxPermissionFanout: 0,
  },
  'cold-ready': {
    kind: 'cold-ready',
    p95Ms: 2500,
    maxCollectionReloads: 1,
    maxGetSessions: 1,
    maxPermissionFanout: 0,
  },
  'view-switch': {
    kind: 'view-switch',
    p95Ms: 50,
    maxCollectionReloads: 0,
    maxGetSessions: 0,
    maxPermissionFanout: 0,
  },
  'notes-open': {
    kind: 'notes-open',
    p95Ms: 200,
    maxCollectionReloads: 0,
    maxGetSessions: 0,
    maxPermissionFanout: 0,
  },
  'browser-chrome': {
    kind: 'browser-chrome',
    p95Ms: 200,
    maxCollectionReloads: 0,
    maxGetSessions: 0,
    maxPermissionFanout: 0,
  },
  'dropdown-open': {
    kind: 'dropdown-open',
    p95Ms: 80,
    maxCollectionReloads: 0,
    maxGetSessions: 0,
    maxPermissionFanout: 0,
  },
  'canvas-layout': {
    kind: 'canvas-layout',
    p95Ms: 200,
    maxCollectionReloads: 0,
    maxGetSessions: 0,
    maxPermissionFanout: 0,
  },
}

/** Bundle/minify is a separate track — never mixed into interaction p95. */
export const BUNDLE_BUDGET_MS = 30_000

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index] ?? 0
}

export function evaluateSamples(samples: InteractionSample[]): BudgetViolation[] {
  const byKind = new Map<InteractionKind, InteractionSample[]>()
  for (const sample of samples) {
    const list = byKind.get(sample.kind) ?? []
    list.push(sample)
    byKind.set(sample.kind, list)
  }

  const violations: BudgetViolation[] = []
  for (const [kind, list] of byKind) {
    const rule = INTERACTION_BUDGETS[kind]
    const durations = list.map((s) => s.durationMs)
    const p95 = percentile(durations, 95)
    if (rule.p95Ms != null && p95 > rule.p95Ms) {
      violations.push({
        rule: `${kind}.p95Ms`,
        actual: p95,
        budget: rule.p95Ms,
        message: `${kind} p95 ${p95.toFixed(1)}ms exceeds ${rule.p95Ms}ms`,
      })
    }

    const reloads = list.filter((s) => s.collectionReload).length
    if (reloads > rule.maxCollectionReloads) {
      violations.push({
        rule: `${kind}.collectionReload`,
        actual: reloads,
        budget: rule.maxCollectionReloads,
        message: `${kind} performed ${reloads} collection reload(s)`,
      })
    }

    const getSessions = list.reduce((sum, s) => sum + (s.ipc['sessions:get']?.count ?? 0), 0)
    if (getSessions > rule.maxGetSessions * Math.max(1, list.length)) {
      violations.push({
        rule: `${kind}.sessions:get`,
        actual: getSessions,
        budget: rule.maxGetSessions,
        message: `${kind} invoked sessions:get ${getSessions} time(s)`,
      })
    }

    const permission = list.reduce((sum, s) => sum + (s.ipc['sessions:getPermissionModeState']?.count ?? 0), 0)
    if (permission > rule.maxPermissionFanout) {
      violations.push({
        rule: `${kind}.permissionFanout`,
        actual: permission,
        budget: rule.maxPermissionFanout,
        message: `${kind} permission-mode IPC fan-out ${permission}`,
      })
    }

    for (const sample of list) {
      for (const finding of sample.nPlusOne) {
        violations.push({
          rule: `${kind}.n+1.${finding.kind}`,
          actual: finding.fanout,
          budget: 0,
          message: `${kind} ${finding.kind} on ${finding.channel} (${finding.fanout}/${finding.sessionCount})`,
        })
      }
    }
  }

  return violations
}

export function evaluateBundle(durationMs: number, hung: boolean): BudgetViolation[] {
  if (!hung && durationMs <= BUNDLE_BUDGET_MS) return []
  return [{
    rule: `${BUNDLE_TRACK}.durationMs`,
    actual: durationMs,
    budget: BUNDLE_BUDGET_MS,
    message: hung
      ? `bundle/minify marked hung after ${durationMs.toFixed(0)}ms`
      : `bundle/minify ${durationMs.toFixed(0)}ms exceeds ${BUNDLE_BUDGET_MS}ms`,
  }]
}
