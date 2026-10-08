/**
 * GarbageCollector — PRD §14 Job 6 (memory-garbage-collection).
 *
 * Rules: low use · low effectiveness · old · contradicted · superseded →
 * ARCHIVE. Never delete: PRD §14 requires `ACTIVE → ARCHIVED` with a reversible
 * restore, so this module only ever produces *recommendations* and (through the
 * optional injected `archive` port) flips a lesson's `disabled` flag — the same
 * reversible mechanism the Memory screen already uses. `LearningTargetStores`
 * (frozen) has no archive member, so the archive port is declared here and
 * injected by the composition layer; without it the collector still returns the
 * recommendations (the service audits and counts them).
 *
 * Pure and deterministic: the caller supplies lessons, effectiveness reports,
 * usage counters and the clock value.
 */
import type { EffectivenessReport } from './learning-types'

export type GarbageTargetType = 'skill' | 'lesson' | 'policy'

export type GarbageReason =
  | 'low_effectiveness'
  | 'low_use'
  | 'stale'
  | 'contradicted'
  | 'superseded'

export interface GarbageLessonRow {
  rule: string
  scope: 'global' | 'workspace'
  /** ISO ts of the lesson's last update. */
  ts: string
  usageCount?: number
  lastUsedAt?: string
  /** Conflict events recorded against the lesson (PRD §14 contradicted). */
  conflicts?: number
  createdByLearning?: boolean
}

export interface GarbageSkillRow {
  slug: string
  /** Uses from the S4 ledger. */
  uses: number
  lastUsedAt: string
  /** Live skill (installed) rather than a pending candidate. */
  approved: boolean
}

export interface GarbageInput {
  lessons?: GarbageLessonRow[]
  skills?: GarbageSkillRow[]
  /** Effectiveness reports keyed by `${targetType}:${targetId}`. */
  effectiveness?: Map<string, EffectivenessReport>
  /** Policy ids proposed for archive (e.g. rolled_back policies). */
  policies?: Array<{ id: string; updatedAt: string }>
  /** Injected "now" (epoch ms); defaults to the collector clock. */
  now?: number
}

export interface GarbageRecommendation {
  targetType: GarbageTargetType
  targetId: string
  /** Scope for lesson targets; absent otherwise. */
  scope?: 'global' | 'workspace'
  reason: GarbageReason
  detail: string
}

export interface GarbageThresholds {
  /** Effectiveness below this (with enough samples) → archive. */
  minEffectiveness: number
  /** Minimum sample size before low effectiveness may archive. */
  minSampleSize: number
  /** Unused for longer than this many days → archive. */
  staleDays: number
  /** Minimum uses below which a long-unused target is "low use". */
  lowUseLimit: number
}

export const DEFAULT_GARBAGE_THRESHOLDS: GarbageThresholds = {
  minEffectiveness: 0.35,
  minSampleSize: 3,
  staleDays: 90,
  lowUseLimit: 1,
}

/** Reversible archive sink owned by the composition layer (never deletes). */
export interface GarbageArchivePort {
  /** Flip the lesson's `disabled` flag (Memory screen archive). false = not found. */
  archiveLesson(input: { rule: string; scope: 'global' | 'workspace' }): boolean
  /** Archive an unused skill by moving it aside (S4 `skills/.archive/`). */
  archiveSkill?(slug: string): boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

export interface GarbageCollectorDeps {
  clock?: () => number
  thresholds?: Partial<GarbageThresholds>
}

export class GarbageCollector {
  private readonly clock: () => number
  readonly thresholds: GarbageThresholds

  constructor(deps: GarbageCollectorDeps = {}) {
    this.clock = deps.clock ?? (() => Date.now())
    this.thresholds = { ...DEFAULT_GARBAGE_THRESHOLDS, ...deps.thresholds }
  }

  /** Deterministic archive recommendations (PRD §14); same input ⇒ same output. */
  collect(input: GarbageInput): GarbageRecommendation[] {
    const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : this.clock()
    const effectiveness = input.effectiveness ?? new Map<string, EffectivenessReport>()
    const recommendations: GarbageRecommendation[] = []

    for (const lesson of input.lessons ?? []) {
      const report = effectiveness.get(`lesson:${lesson.rule}`)
      const lastTouched = Date.parse(lesson.lastUsedAt && lesson.lastUsedAt ? lesson.lastUsedAt : lesson.ts)
      const ageDays = Number.isFinite(lastTouched) ? (now - lastTouched) / DAY_MS : -1
      if ((lesson.conflicts ?? 0) > 0) {
        recommendations.push({
          targetType: 'lesson',
          targetId: lesson.rule,
          scope: lesson.scope,
          reason: 'contradicted',
          detail: `${lesson.conflicts} recorded conflict(s)`,
        })
        continue
      }
      if (report && report.sampleSize >= this.thresholds.minSampleSize && report.effectiveness < this.thresholds.minEffectiveness) {
        recommendations.push({
          targetType: 'lesson',
          targetId: lesson.rule,
          scope: lesson.scope,
          reason: 'low_effectiveness',
          detail: `effectiveness ${report.effectiveness.toFixed(2)} < ${this.thresholds.minEffectiveness} over ${report.sampleSize} samples`,
        })
        continue
      }
      if (ageDays >= this.thresholds.staleDays && (lesson.usageCount ?? 0) <= this.thresholds.lowUseLimit) {
        recommendations.push({
          targetType: 'lesson',
          targetId: lesson.rule,
          scope: lesson.scope,
          reason: 'stale',
          detail: `unused for ${Math.floor(ageDays)} days with ${lesson.usageCount ?? 0} use(s)`,
        })
      }
    }

    for (const skill of input.skills ?? []) {
      if (!skill.approved) continue
      const report = effectiveness.get(`skill:${skill.slug}`)
      if (report && report.sampleSize >= this.thresholds.minSampleSize && report.effectiveness < this.thresholds.minEffectiveness) {
        recommendations.push({
          targetType: 'skill',
          targetId: skill.slug,
          reason: 'low_effectiveness',
          detail: `effectiveness ${report.effectiveness.toFixed(2)} < ${this.thresholds.minEffectiveness} over ${report.sampleSize} samples`,
        })
        continue
      }
      const lastUsed = Date.parse(skill.lastUsedAt)
      const ageDays = Number.isFinite(lastUsed) ? (now - lastUsed) / DAY_MS : -1
      if (skill.uses <= this.thresholds.lowUseLimit && ageDays >= this.thresholds.staleDays) {
        recommendations.push({
          targetType: 'skill',
          targetId: skill.slug,
          reason: 'low_use',
          detail: `${skill.uses} use(s) and unused for ${Math.floor(ageDays)} days`,
        })
      }
    }

    for (const policy of input.policies ?? []) {
      recommendations.push({
        targetType: 'policy',
        targetId: policy.id,
        reason: 'low_effectiveness',
        detail: 'policy is no longer active after rollback',
      })
    }

    return recommendations.sort((a, b) => {
      const byType = a.targetType.localeCompare(b.targetType)
      if (byType !== 0) return byType
      const byId = a.targetId.localeCompare(b.targetId)
      return byId !== 0 ? byId : a.reason.localeCompare(b.reason)
    })
  }

  /**
   * Apply recommendations through the injected archive port. Returns how many
   * targets were actually archived (a missing port archives nothing; the caller
   * still observes the recommendations). Never throws.
   */
  apply(recommendations: GarbageRecommendation[], archive?: GarbageArchivePort): number {
    if (!archive) return 0
    let archived = 0
    for (const recommendation of recommendations) {
      try {
        if (recommendation.targetType === 'lesson') {
          if (archive.archiveLesson({ rule: recommendation.targetId, scope: recommendation.scope ?? 'workspace' })) archived += 1
        } else if (recommendation.targetType === 'skill' && archive.archiveSkill) {
          if (archive.archiveSkill(recommendation.targetId)) archived += 1
        }
      } catch {
        // best-effort: a failing sink never breaks the job
      }
    }
    return archived
  }
}