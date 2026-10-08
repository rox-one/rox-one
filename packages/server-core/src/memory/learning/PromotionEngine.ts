/**
 * PromotionEngine — the single path from a validated LearningCandidate to live
 * knowledge (PRD §17 approval levels, §39 promotion policy, §40 mutations).
 *
 * Guarantees:
 * - Refuses unless the candidate is in a promotable status and its deterministic
 *   validation (`validation.promotable`, §37-39) passed. Refusals touch nothing.
 * - PRD §17 approval gate: autonomous promotion is limited to non-global scopes
 *   and the lesson/skill/preference types; `scope: 'global'` and `type: 'policy'`
 *   always require `approval: 'user'`.
 * - Every promotion writes exactly one durable target plus one LearningMutation
 *   row (`status: 'applied'`, `rollbackAvailable: true`) and only then flips the
 *   candidate to `'active'`.
 * - If any write fails mid-flight, already-applied target changes are undone
 *   best-effort (narrow duplicated revert logic — WP-104 allows this to keep
 *   PromotionEngine independent of RollbackManager) and the candidate keeps its
 *   pre-promotion status, so no candidate is ever left active without a
 *   matching target change.
 *
 * Payload shapes (WP-103 candidates): lesson/preference `{ rule?, category?,
 * negative? }`, skill `{ slug, description, body, supersedes? }`, policy
 * `{ taskClass, preferredModel?, preferredSkills?, verification?, delegation?,
 * toolOrder? }`.
 */
import { randomUUID } from 'crypto'
import type {
  LearningCandidate,
  LearningMutation,
  LearningPolicy,
  LearningPromotionThresholds,
} from '@rox/shared/memory/learning'
import { DEFAULT_LEARNING_THRESHOLDS } from '@rox/shared/memory/learning'
import type { LearningTargetStores, PromotionResult } from './learning-types'
import type { CandidateStore } from './CandidateStore'
import type { EvidenceStore } from './EvidenceStore'
import type { LearningAudit } from './LearningAudit'
import type { MutationStore } from './MutationStore'

export interface PromotionEngineDeps {
  targets: LearningTargetStores
  mutationStore: MutationStore
  candidateStore: CandidateStore
  evidenceStore: EvidenceStore
  audit?: LearningAudit
  thresholds?: LearningPromotionThresholds
  clock?: () => number
  emit?: (evt: { workspaceId: string; kind: string; id: string }) => void
}

/** Statuses from which a promotion attempt is meaningful (state machine §34). */
const PROMOTABLE_STATUS: Record<LearningCandidate['status'], boolean> = {
  candidate: true,
  validating: true,
  approved: true,
  active: false,
  rejected: false,
  rolled_back: false,
}

export class PromotionEngine {
  /** Thresholds the engine runs with (defaults to the shared config; the actual
   * pre-check is `validation.promotable`, computed by CandidateValidator). */
  readonly thresholds: LearningPromotionThresholds
  private readonly deps: PromotionEngineDeps

  constructor(deps: PromotionEngineDeps) {
    this.deps = deps
    this.thresholds = deps.thresholds ?? DEFAULT_LEARNING_THRESHOLDS
  }

  async promote(
    candidate: LearningCandidate,
    opts: { approval: 'autonomous' | 'user'; workspaceId: string },
  ): Promise<PromotionResult> {
    const refuse = (reason: string): PromotionResult => ({
      promoted: false,
      status: candidate.status,
      mutations: [],
      reason,
    })

    if (!PROMOTABLE_STATUS[candidate.status]) {
      return refuse(`status '${candidate.status}' is not promotable`)
    }
    if (!candidate.validation || !candidate.validation.promotable) {
      return refuse('not validated')
    }
    if (opts.approval === 'autonomous' && (candidate.scope === 'global' || candidate.type === 'policy')) {
      return refuse('requires review')
    }

    const applied: LearningMutation[] = []
    try {
      const mutation = this.applyTarget(candidate)
      applied.push(mutation)
      this.deps.mutationStore.save(mutation)
      const active: LearningCandidate = { ...candidate, status: 'active', updatedAt: this.nowIso() }
      this.deps.candidateStore.save(active)
      this.deps.audit?.append({
        ts: this.nowIso(),
        actor: 'learning',
        action: 'promote',
        target: mutation.targetId,
        detail: `${candidate.type} ${candidate.id} scope=${candidate.scope} approval=${opts.approval} confidence=${candidate.confidence} evidence=${this.resolvedEvidenceCount(active)}/${active.evidence.length}`,
      })
      this.deps.emit?.({ workspaceId: opts.workspaceId, kind: 'promotion', id: active.id })
      return { promoted: true, status: 'active', mutations: [mutation] }
    } catch (error) {
      for (const mutation of applied) this.revertApplied(mutation)
      return refuse(error instanceof Error ? error.message : String(error))
    }
  }

  /** Write the durable target change for the candidate's type and return the mutation describing it. */
  private applyTarget(candidate: LearningCandidate): LearningMutation {
    const payload = asRecord(candidate.payload)
    switch (candidate.type) {
      case 'skill': {
        const slug = typeof payload?.slug === 'string' ? payload.slug.trim() : ''
        if (!slug) throw new Error('skill payload requires a slug')
        const description = typeof payload?.description === 'string' ? payload.description : candidate.hypothesis
        const body = typeof payload?.body === 'string' ? payload.body : ''
        const supersedes = typeof payload?.supersedes === 'string' ? payload.supersedes : undefined
        const queued = this.deps.targets.enqueueSkill({ slug, description, body, ...(supersedes === undefined ? {} : { supersedes }) })
        if (!queued) throw new Error(`skill '${slug}' already queued`)
        return this.mutation(candidate, 'skill', slug, { slug, description, ...(supersedes === undefined ? {} : { supersedes }) })
      }
      case 'policy': {
        const taskClass = typeof payload?.taskClass === 'string' ? payload.taskClass.trim() : ''
        if (!taskClass) throw new Error('policy payload requires taskClass')
        const preferredModel = typeof payload?.preferredModel === 'string' ? payload.preferredModel : undefined
        const toolOrder = strings(payload?.toolOrder)
        const delegation =
          payload?.delegation === 'prefer' || payload?.delegation === 'avoid' || payload?.delegation === 'neutral'
            ? payload.delegation
            : 'neutral'
        const policy: LearningPolicy = {
          id: `pol_${candidate.fingerprint.slice(0, 24)}`,
          fingerprint: candidate.fingerprint,
          taskClass,
          preferredSkills: strings(payload?.preferredSkills) ?? [],
          verification: strings(payload?.verification) ?? [],
          delegation,
          confidence: candidate.confidence,
          evidence: candidate.evidence,
          status: 'active',
          createdAt: candidate.createdAt,
          updatedAt: this.nowIso(),
          ...(preferredModel === undefined ? {} : { preferredModel }),
          ...(toolOrder === undefined ? {} : { toolOrder }),
          ...(candidate.owner === undefined ? {} : { owner: candidate.owner }),
        }
        this.deps.targets.savePolicy(policy)
        return this.mutation(candidate, 'policy', policy.id, { id: policy.id, fingerprint: policy.fingerprint, taskClass })
      }
      case 'preference':
      case 'lesson': {
        const rule = typeof payload?.rule === 'string' && payload.rule.trim() ? payload.rule : candidate.hypothesis
        const category =
          candidate.type === 'preference'
            ? 'preference'
            : typeof payload?.category === 'string' && payload.category.trim()
              ? payload.category
              : 'knowledge'
        // LearningTargetStores only knows global/workspace; project/session lessons live in the workspace.
        const scope = candidate.scope === 'global' ? ('global' as const) : ('workspace' as const)
        const negative = payload?.negative === true ? true : undefined
        this.deps.targets.addLesson({
          rule,
          category,
          scope,
          trigger: 'distillation',
          ...(negative === undefined ? {} : { negative }),
        })
        return this.mutation(candidate, 'lesson', rule, { rule, scope })
      }
    }
  }

  private mutation(
    candidate: LearningCandidate,
    targetType: LearningMutation['targetType'],
    targetId: string,
    after: unknown,
  ): LearningMutation {
    return {
      id: `mut_${randomUUID()}`,
      candidateId: candidate.id,
      targetType,
      targetId,
      before: null,
      after,
      rollbackAvailable: true,
      status: 'applied',
      ts: this.nowIso(),
      ...(candidate.owner === undefined ? {} : { owner: candidate.owner }),
    }
  }

  /** Best-effort undo of a target whose promotion failed mid-flight. */
  private revertApplied(mutation: LearningMutation): void {
    try {
      const after = asRecord(mutation.after)
      if (mutation.targetType === 'lesson') {
        const rule = typeof after?.rule === 'string' && after.rule ? after.rule : mutation.targetId
        this.deps.targets.removeLesson(rule, after?.scope === 'global' ? 'global' : 'workspace')
      } else if (mutation.targetType === 'skill') {
        this.deps.targets.removeQueuedSkill(typeof after?.slug === 'string' ? after.slug : mutation.targetId)
      } else if (mutation.targetType === 'policy') {
        this.deps.targets.removePolicy(typeof after?.id === 'string' ? after.id : mutation.targetId)
      }
    } catch {
      // best-effort: the original error is the one worth reporting
    }
    try {
      if (this.deps.mutationStore.get(mutation.id)) {
        this.deps.mutationStore.markReverted(mutation.id, this.nowIso(), 'promotion failed')
      }
    } catch {
      // best-effort
    }
  }

  /** Evidence rows actually present in the store (traceability breadcrumb for the audit line). */
  private resolvedEvidenceCount(candidate: LearningCandidate): number {
    try {
      return this.deps.evidenceStore.listByIds(candidate.evidence.map((ref) => ref.evidenceId)).length
    } catch {
      return 0
    }
  }

  private nowIso(): string {
    return new Date(this.deps.clock ? this.deps.clock() : Date.now()).toISOString()
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
}