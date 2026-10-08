/**
 * LearningHost — composition root for the continual-learning layer (WP-117).
 *
 * The `learning:*` RPC surface and the `LearningServicePorts` seam MemoryService
 * consumes are both satisfied by this class. It owns one `LearningService` +
 * `LearningWorker` + durable job queue per workspace (lazily built on first
 * touch), wires the PRD §8 session lifecycle bus into the service, and maps the
 * frozen `LearningTargetStores` onto the pre-existing durable stores
 * (`LessonStore`, `SkillPendingQueue`, `PolicyStore`).
 *
 * Fail-soft by construction: an unknown workspace degrades to `null`/`[]`/no-op,
 * a per-workspace initialization failure is logged and skipped, and a bus
 * listener failure never propagates back into the session pipeline.
 */
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { getSkillsLearningPolicyForWorkspace } from '@rox/shared/config'
import type {
  LearningCandidate,
  LearningCandidateStatus,
  LearningEvidence,
  LearningPolicy,
  LearningStatsDto,
  LearningTimelineEntryDto,
} from '@rox/shared/memory/learning'
import type { AuditActor, Lesson, LessonCategory, LessonScope } from '@rox/shared/memory/types'
import { invalidateSkillsCache } from '@rox/shared/skills/storage'
import type { LearningRpcService } from '../../handlers/handler-deps'
import type { SessionEventBus, SessionLifecycleEventMap } from '../../sessions/SessionEventBus'
import { LessonStore } from '../LessonStore'
import { MemoryFileStore } from '../MemoryFileStore'
import { SkillPendingQueue } from '../SkillPendingQueue'
import { CandidateStore } from './CandidateStore'
import { EvidenceStore } from './EvidenceStore'
import { ExperimentStore } from './ExperimentStore'
import { LearningAudit } from './LearningAudit'
import { LearningQueue } from './LearningQueue'
import { LearningService, type LearningServiceLogger } from './LearningService'
import { LearningWorker } from './LearningWorker'
import { MutationStore } from './MutationStore'
import { ObservationStore } from './ObservationStore'
import { OutcomeStore } from './OutcomeStore'
import { PolicyStore } from './PolicyStore'
import { learningDirFor, type LearningTargetStores, type ValidatorPorts } from './learning-types'

export interface LearningHostLogger {
  info?(message: string, meta?: unknown): void
  warn(message: string, error?: unknown): void
}

export interface LearningHostDeps {
  /** Workspace lookup by id or name; the host owns no workspace registry. */
  resolveWorkspace: (workspaceId: string) => { id: string; rootPath: string } | null
  /** Reflection/distillation LLM seam (may throw; failures stay inside the service). */
  distill?: (workspaceId: string, prompt: string, sessionId?: string) => Promise<string>
  /** Deterministic-validation judge LLM seam. */
  judge?: (prompt: string) => Promise<string>
  logger?: LearningHostLogger
  clock?: () => number
}

interface LearningInstance {
  service: LearningService
  worker: LearningWorker
  queue: LearningQueue
}

/** Slug shape `SkillPendingQueue` accepts — reused to keep filesystem writes inside `skills/.pending`. */
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

/**
 * Repository signals for validation (PRD §23): package manager, lockfiles,
 * language manifests, and agent-instruction files present at the workspace root.
 */
function readRepositorySignals(workspaceRoot: string): string[] {
  const signals = new Set<string>()
  const has = (name: string): boolean => existsSync(join(workspaceRoot, name))
  if (has('bun.lockb') || has('bun.lock')) signals.add('bun')
  if (has('pnpm-lock.yaml')) signals.add('pnpm')
  if (has('yarn.lock')) signals.add('yarn')
  if (has('package-lock.json')) signals.add('npm')
  if (has('Cargo.toml')) signals.add('cargo')
  if (has('go.mod')) signals.add('go')
  if (has('pyproject.toml') || has('requirements.txt')) signals.add('python')
  if (has('tsconfig.json')) signals.add('typescript')
  if (has('AGENTS.md')) signals.add('agents.md')
  if (has('CLAUDE.md')) signals.add('claude.md')
  try {
    const pkg = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as { packageManager?: unknown }
    if (typeof pkg.packageManager === 'string' && pkg.packageManager.length > 0) {
      signals.add(pkg.packageManager.split('@')[0]!)
    }
  } catch {
    // no readable package.json — the filesystem probes above already stand
  }
  return [...signals]
}

/** Bus `user.correction.kind` → the correction category the observation schema carries. */
const CORRECTION_CATEGORY: Record<SessionLifecycleEventMap['user.correction']['kind'], 'fact' | 'preference' | 'workflow'> = {
  branch: 'workflow',
  plan_edit: 'workflow',
  rejected: 'preference',
  fact_correction: 'fact',
}

const LESSON_ACTOR: AuditActor = 'distill'

export interface WorkspaceTargetStores {
  targets: LearningTargetStores
  /** Both lesson scopes, resolved the way MemoryService resolves them. */
  lessons: Record<LessonScope, LessonStore>
  skills: SkillPendingQueue
}

/**
 * Real `LearningTargetStores` over the pre-existing durable stores (WP-117):
 * lessons land in the same `lessons.jsonl` the prompt assembler reads, skills in
 * `skills/.pending/<slug>/`, policies in `policies.jsonl`.
 *
 * Identity note: the learning layer carries no personal owner, so lessons are
 * written without an `owner` (they match only other unowned rows) and skill
 * slugs are enqueued verbatim — unlike the legacy personal-owner path, which
 * hashes the owner into `<slug[:47]>-<sha256(owner)[:16]>`.
 */
export function createWorkspaceTargetStores(
  workspaceRoot: string,
  policies: PolicyStore,
  clock?: () => number,
): WorkspaceTargetStores {
  const lessons: Record<LessonScope, LessonStore> = {
    global: new LessonStore(new MemoryFileStore('global').lessonsPath, 'global'),
    workspace: new LessonStore(new MemoryFileStore('workspace', workspaceRoot).lessonsPath, 'workspace'),
  }
  const skills = new SkillPendingQueue(workspaceRoot)

  const targets: LearningTargetStores = {
    addLesson: (input) => {
      const lesson: Lesson = {
        ts: new Date(clock?.() ?? Date.now()).toISOString(),
        rule: input.rule,
        category: input.category as LessonCategory,
        scope: input.scope,
        ...(input.negative === undefined ? {} : { negative: input.negative }),
        source: {
          ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
          trigger: input.trigger,
        },
      }
      lessons[input.scope].add(lesson, LESSON_ACTOR)
    },
    removeLesson: (rule, scope) => lessons[scope].delete(rule, LESSON_ACTOR),
    enqueueSkill: (input) =>
      skills.enqueue({
        slug: input.slug,
        description: input.description,
        body: input.body,
        source: {
          ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
          ts: new Date(clock?.() ?? Date.now()).toISOString(),
        },
      }),
    // Rollback removes the pending candidate outright. `SkillPendingQueue.dismiss`
    // would additionally write the anti-repeat log, which would suppress a later
    // legitimate re-proposal of the same rule — not what an undo means.
    removeQueuedSkill: (slug) => {
      if (!SAFE_SLUG.test(slug)) return false
      const dir = join(skills.pendingDir, slug)
      if (!existsSync(dir)) return false
      rmSync(dir, { recursive: true, force: true })
      try {
        invalidateSkillsCache()
      } catch {
        // cache invalidation is best-effort
      }
      return true
    },
    readQueuedSkill: (slug) => {
      if (!SAFE_SLUG.test(slug)) return null
      const dir = join(skills.pendingDir, slug)
      let raw: string
      try {
        raw = readFileSync(join(dir, 'SKILL.md'), 'utf8')
      } catch {
        return null
      }
      let description = ''
      try {
        const meta = JSON.parse(readFileSync(join(dir, '.meta.json'), 'utf8')) as { description?: unknown }
        if (typeof meta.description === 'string') description = meta.description
      } catch {
        // meta is optional for a read
      }
      return { slug, description, body: raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim() }
    },
    savePolicy: (policy) => {
      policies.save(policy)
    },
    removePolicy: (id) => policies.remove(id),
  }

  return { targets, lessons, skills }
}

/**
 * Per-workspace learning stack: the seven durable learning stores, the target
 * stores over the pre-existing memory/skill/policy stores, the validator ports,
 * the service, and the worker driving the durable job queue.
 */
function buildInstance(
  workspace: { id: string; rootPath: string },
  deps: LearningHostDeps,
  logger: LearningServiceLogger,
): LearningInstance {
  const root = workspace.rootPath
  const clock = deps.clock

  const observations = new ObservationStore(root)
  const policies = new PolicyStore(root)
  const outcomes = new OutcomeStore(root)
  const stores = {
    observations,
    candidates: new CandidateStore(root),
    evidence: new EvidenceStore(root),
    outcomes,
    mutations: new MutationStore(root),
    experiments: new ExperimentStore(root),
    policies,
  }

  // Both lesson scopes, resolved exactly as MemoryService resolves them, so the
  // learning layer writes through the same files the prompt assembler reads.
  const { targets, lessons: lessonStores } = createWorkspaceTargetStores(root, policies, clock)

  const validatorPorts = {
    // No owner filter: the learning layer is machine-private, so duplicate and
    // contradiction checks run against the unowned rows of both scopes.
    listExistingRules: () => [
      ...lessonStores.global.list().map((lesson) => ({ rule: lesson.rule, scope: 'global' as const, negative: lesson.negative })),
      ...lessonStores.workspace.list().map((lesson) => ({ rule: lesson.rule, scope: 'workspace' as const, negative: lesson.negative })),
    ],
    readRepositorySignals,
    listOutcomesByFingerprint: (fingerprint: string) => outcomes.listByFingerprint(fingerprint),
    readSkillsLearningPolicy: () => getSkillsLearningPolicyForWorkspace(root),
    // `thresholds` is injected by LearningService itself — never supplied here.
  } satisfies Omit<ValidatorPorts, 'thresholds'>

  const service = new LearningService({
    workspaceRoot: root,
    workspaceId: workspace.id,
    ...(clock === undefined ? {} : { clock }),
    logger,
    ...(deps.distill === undefined
      ? {}
      : { distiller: (prompt: string, sessionId?: string) => deps.distill!(workspace.id, prompt, sessionId) }),
    ...(deps.judge === undefined ? {} : { judge: deps.judge }),
    audit: new LearningAudit(root),
    stores,
    targets,
    validatorPorts: validatorPorts as ValidatorPorts,
  })

  const queue = new LearningQueue(join(learningDirFor(root), 'queue.jsonl'))
  const worker = new LearningWorker({
    queue,
    service,
    workspaceId: workspace.id,
    ...(clock === undefined ? {} : { clock }),
    logger: { warn: (message, meta) => logger.warn(`worker: ${message}`, meta) },
  })
  worker.start()

  return { service, worker, queue }
}

export class LearningHost implements LearningRpcService {
  private readonly deps: LearningHostDeps
  private readonly logger: LearningHostLogger
  private readonly instances = new Map<string, LearningInstance>()

  constructor(deps: LearningHostDeps) {
    this.deps = deps
    this.logger = deps.logger ?? { warn: () => {} }
  }

  /** Resolve (creating on first use) the workspace's learning stack; `null` when unknown or broken. */
  private instanceFor(workspaceId: string): LearningInstance | null {
    const resolved = this.deps.resolveWorkspace(workspaceId)
    if (!resolved) return null
    const existing = this.instances.get(resolved.id)
    if (existing) return existing
    try {
      const instance = buildInstance(resolved, this.deps, {
        warn: (message, error) => this.logger.warn(`learning: ${message}`, error),
      })
      this.instances.set(resolved.id, instance)
      this.logger.info?.(`learning host: workspace ${resolved.id} initialized`)
      return instance
    } catch (error) {
      this.logger.warn(`learning host: failed to initialize workspace ${resolved.id}`, error)
      return null
    }
  }

  /** Run a service call against the workspace, degrading to `fallback` on any failure. */
  private withService<T>(workspaceId: string, action: (service: LearningService) => T, fallback: T): T {
    try {
      const instance = this.instanceFor(workspaceId)
      if (!instance) return fallback
      return action(instance.service)
    } catch (error) {
      this.logger.warn(`learning host: ${workspaceId} call failed`, error)
      return fallback
    }
  }

  private async withServiceAsync<T>(
    workspaceId: string,
    action: (service: LearningService) => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      const instance = this.instanceFor(workspaceId)
      if (!instance) return fallback
      return await action(instance.service)
    } catch (error) {
      this.logger.warn(`learning host: ${workspaceId} async call failed`, error)
      return fallback
    }
  }

  // -------------------------------------------------------------------------
  // PRD §8 lifecycle bus → per-workspace service
  // -------------------------------------------------------------------------

  /**
   * Subscribe to the session lifecycle bus. Every handler resolves the owning
   * workspace and forwards; consumers with no producer on this bus
   * (`verification.completed`, `workspace.idle`) stay unwired. Returns an
   * unsubscribe that detaches every listener.
   */
  attachBus(bus: SessionEventBus): () => void {
    const record = (workspaceId: string, action: (service: LearningService) => void): void => {
      this.withService(workspaceId, action, undefined)
    }

    const offs = [
      bus.on('session.completed', (evt) => {
        record(evt.workspaceId, (service) =>
          service.observeCompletion({ workspaceId: evt.workspaceId, sessionId: evt.sessionId, reason: evt.reason }),
        )
      }),
      bus.on('session.failed', (evt) => {
        record(evt.workspaceId, (service) =>
          service.observeCompletion({ workspaceId: evt.workspaceId, sessionId: evt.sessionId, reason: 'error' }),
        )
      }),
      bus.on('session.branched', (evt) => {
        record(evt.workspaceId, (service) =>
          service.observeCompletion({ workspaceId: evt.workspaceId, sessionId: evt.sessionId, reason: 'branch' }),
        )
      }),
      bus.on('user.correction', (evt) => {
        const detail = evt.detail ?? ''
        record(evt.workspaceId, (service) =>
          service.recordCorrection({
            id: `${evt.sessionId}:${evt.ts}:${evt.kind}`,
            sessionId: evt.sessionId,
            workspaceId: evt.workspaceId,
            original: detail || evt.kind,
            corrected: detail || evt.kind,
            category: CORRECTION_CATEGORY[evt.kind],
            confidence: 0.6,
            ts: evt.ts,
          }),
        )
      }),
      bus.on('tool.result', (evt) => {
        record(evt.workspaceId, (service) =>
          service.recordToolOutcome({
            workspaceId: evt.workspaceId,
            sessionId: evt.sessionId,
            tool: evt.tool,
            ok: evt.ok,
            ...(evt.error === undefined ? {} : { error: evt.error }),
            ts: evt.ts,
          }),
        )
      }),
      bus.on('prompt.assembled', (evt) => {
        record(evt.workspaceId, (service) =>
          service.recordContextUsage({
            workspaceId: evt.workspaceId,
            sessionId: evt.sessionId,
            lessons: evt.lessons ?? [],
            skills: evt.skillSlugs ?? [],
          }),
        )
      }),
    ]

    return () => {
      for (const off of offs) {
        try {
          off()
        } catch {
          // detaching is best-effort
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // LearningRpcService facade (PRD §15)
  // -------------------------------------------------------------------------

  observeCompletion: LearningRpcService['observeCompletion'] = (evt) => {
    this.withService(evt.workspaceId, (service) => service.observeCompletion(evt), undefined)
  }

  recordCorrection: LearningRpcService['recordCorrection'] = (correction) => {
    this.withService(correction.workspaceId ?? '', (service) => service.recordCorrection(correction), undefined)
  }

  recordToolOutcome: LearningRpcService['recordToolOutcome'] = (input) => {
    this.withService(input.workspaceId, (service) => service.recordToolOutcome(input), undefined)
  }

  recordContextUsage: LearningRpcService['recordContextUsage'] = (input) => {
    this.withService(input.workspaceId, (service) => service.recordContextUsage(input), undefined)
  }

  ingestDistilled: LearningRpcService['ingestDistilled'] = (input) =>
    this.withServiceAsync(input.workspaceId, (service) => service.ingestDistilled(input), {
      handled: false,
      promoted: false,
      reason: 'learning unavailable for this workspace',
    })

  reflectSession: LearningRpcService['reflectSession'] = (workspaceId, sessionId) =>
    this.withServiceAsync(workspaceId, (service) => service.reflectSession(workspaceId, sessionId), { candidates: [] })

  runConsolidation: LearningRpcService['runConsolidation'] = (workspaceId) =>
    this.withServiceAsync(workspaceId, (service) => service.runConsolidation(workspaceId), { candidates: [] })

  runSkillCuration: LearningRpcService['runSkillCuration'] = (workspaceId) =>
    this.withServiceAsync(workspaceId, (service) => service.runSkillCuration(workspaceId), { items: [] })

  runPolicyLearning: LearningRpcService['runPolicyLearning'] = (workspaceId) =>
    this.withServiceAsync(workspaceId, (service) => service.runPolicyLearning(workspaceId), { policies: [] })

  runGarbageCollection: LearningRpcService['runGarbageCollection'] = (workspaceId) =>
    this.withServiceAsync(workspaceId, (service) => service.runGarbageCollection(workspaceId), { archived: 0 })

  evaluateOutcomes: LearningRpcService['evaluateOutcomes'] = (workspaceId) =>
    this.withServiceAsync(workspaceId, (service) => service.evaluateOutcomes(workspaceId), { rolledBack: [] })

  listCandidates: LearningRpcService['listCandidates'] = (workspaceId, filter) =>
    this.withService(workspaceId, (service) => service.listCandidates(workspaceId, filter), [] as LearningCandidate[])

  getCandidate: LearningRpcService['getCandidate'] = (workspaceId, id) =>
    this.withService(workspaceId, (service) => service.getCandidate(workspaceId, id), null)

  approveCandidate: LearningRpcService['approveCandidate'] = (workspaceId, id) =>
    this.withServiceAsync(workspaceId, (service) => service.approveCandidate(workspaceId, id), {
      promoted: false,
      status: 'candidate' as LearningCandidateStatus,
      mutations: [],
    })

  rejectCandidate: LearningRpcService['rejectCandidate'] = (workspaceId, id, reason) =>
    this.withService(workspaceId, (service) => service.rejectCandidate(workspaceId, id, reason), null)

  rollbackCandidate: LearningRpcService['rollbackCandidate'] = (workspaceId, id) =>
    this.withServiceAsync(workspaceId, (service) => service.rollbackCandidate(workspaceId, id), {
      reverted: false,
      mutationIds: [],
    })

  getTimeline: LearningRpcService['getTimeline'] = (workspaceId, limit) =>
    this.withService(workspaceId, (service) => service.getTimeline(workspaceId, limit), [] as LearningTimelineEntryDto[])

  getStats: LearningRpcService['getStats'] = (workspaceId) =>
    this.withService(workspaceId, (service) => service.getStats(workspaceId), {
      observations: 0,
      candidates: 0,
      activeCandidates: 0,
      rejectedCandidates: 0,
      outcomes: 0,
      mutations: 0,
      revertedMutations: 0,
      policies: 0,
    } satisfies LearningStatsDto)

  listEvidence: LearningRpcService['listEvidence'] = (workspaceId, candidateId) =>
    this.withService(workspaceId, (service) => service.listEvidence(workspaceId, candidateId), [] as LearningEvidence[])

  getOutcome: LearningRpcService['getOutcome'] = (workspaceId, id) =>
    this.withService(workspaceId, (service) => service.getOutcome(workspaceId, id), null)

  getExperiment: LearningRpcService['getExperiment'] = (workspaceId, id) =>
    this.withService(workspaceId, (service) => service.getExperiment(workspaceId, id), null)

  getPolicies: LearningRpcService['getPolicies'] = (workspaceId) =>
    this.withService(workspaceId, (service) => service.getPolicies(workspaceId), [] as LearningPolicy[])

  getSkillEffectiveness: LearningRpcService['getSkillEffectiveness'] = (workspaceId, targetId) =>
    this.withService(workspaceId, (service) => service.getSkillEffectiveness(workspaceId, targetId), null)

  revalidateCandidate: LearningRpcService['revalidateCandidate'] = (workspaceId, id) =>
    this.withServiceAsync(workspaceId, (service) => service.revalidateCandidate(workspaceId, id), null)

  recordOutcome: LearningRpcService['recordOutcome'] = (workspaceId, outcome) => {
    this.withService(workspaceId, (service) => service.recordOutcome(workspaceId, outcome), undefined)
  }

  /** Drain every initialized workspace's in-flight background work (test/drain seam). */
  whenIdle: LearningRpcService['whenIdle'] = async () => {
    await Promise.allSettled([...this.instances.values()].map((instance) => instance.service.whenIdle()))
  }

  /** Stop every worker and forget the per-workspace stacks. Safe to call repeatedly. */
  stop(): void {
    for (const [workspaceId, instance] of this.instances) {
      try {
        instance.worker.stop()
      } catch (error) {
        this.logger.warn(`learning host: failed to stop worker for ${workspaceId}`, error)
      }
    }
    this.instances.clear()
  }
}