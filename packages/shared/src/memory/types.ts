/**
 * Self-learning / self-evolving types — durable lessons, workspace memory,
 * distillation results and skill-candidate queue.
 * See docs/superpowers/specs/2026-08-06-self-learning-memory-design.md
 */

/** Built-in categories plus free-form user categories (stored as plain strings). */
export type LessonCategory = 'preference' | 'workflow' | 'knowledge' | 'correction' | (string & {})
export type LessonScope = 'global' | 'workspace'
export type LessonTrigger = 'explicit' | 'branch' | 'interrupted' | 'error' | 'distillation'

/** Server-authenticated identity for a personal lesson; never supplied by the renderer. */
export interface LessonOwner {
  issuer: string
  subject: string
}

export interface Lesson {
  /** Optional personal owner; absent lessons remain machine-private legacy data. */
  owner?: LessonOwner
  /** ISO timestamp */
  ts: string
  /** The durable rule the agent must follow, e.g. "always run frontend checks before calling a change done" */
  rule: string
  category: LessonCategory
  scope: LessonScope
  /** true = anti-rule ("never do X") — rendered as its own MUST NOT line */
  negative?: boolean
  source: {
    sessionId?: string
    trigger: LessonTrigger
    /** Explicit approval provenance, preserved in canonical lesson storage. */
    proposalId?: string
    consentEventId?: string
  }
  // — Lesson schema v2 (spec F1). All optional: v1 files load without migration. —
  /** How many times this lesson was included in an assembled prompt (touchUsed). */
  usageCount?: number
  /** ISO timestamp of the last prompt inclusion. */
  lastUsedAt?: string
  /** Violations of this lesson (feedback loop), capped at the most recent 20. */
  conflicts?: LessonConflict[]
  /** Marker set when the lesson was promoted from workspace to global scope. */
  promoted?: {
    fromScope: 'workspace'
    workspaceIds: string[]
    ts: string
  }
  /** true when written by distillation (vs an explicit user/branch rule). */
  generated?: boolean
  // — Memory screen (all optional, additive; older files load unchanged). —
  /** Always injected into agent context (ahead of recency), kept on prune. */
  pinned?: boolean
  /** Kept on disk but never injected into agent context. */
  disabled?: boolean
  /** Free-form user tags (lowercase, no '#'). */
  tags?: string[]
  /** Rules folded into this one by a user merge (provenance). */
  mergedFrom?: string[]
  /** Source lesson retained but excluded from context after a reversible merge. */
  mergedInto?: string
  /** Complete pre-merge source records used by the explicit restore action. */
  mergeHistory?: {
    version: 1
    lessons: Lesson[]
  }
  /** ISO timestamps of the most recent prompt inclusions (capped, newest last). */
  usedAt?: string[]
  /** ISO timestamp of the last user edit of the rule text. */
  editedAt?: string
}

/** One recorded violation of a lesson (spec F1). */
export interface LessonConflict {
  sessionId: string
  /** ISO timestamp */
  ts: string
  reason: 'branch' | 'interrupted' | 'error'
}
/**
 * One validated conflict verdict returned by ADD_LESSON (spec L2).
 * Mirror of the server-side checker type (server-core memory/lesson-graph) —
 * kept structurally identical so the RPC payload type-checks on both ends.
 */
export interface LessonConflictVerdict {
  /** Exact text of the existing rule the new lesson collides with. */
  existingRule: string
  relation: 'contradicts' | 'subsumes'
  rationale?: string
}
/**
 * ADD_LESSON result (spec L2): the stored lesson plus conflicts detected
 * post-write against existing rules. `conflicts` is [] whenever the LLM
 * check is unavailable or fails — it never blocks the write.
 */
export interface AddLessonResult {
  lesson: Lesson
  conflicts: LessonConflictVerdict[]
}
/** One promotion candidate (spec L3): same normalized rule in ≥2 distinct workspace stores. */
export interface PromotionCandidate {
  /** Rule text as first seen across workspace stores. */
  rule: string
  category: LessonCategory
  /** Distinct workspace ids carrying the rule, in scan order. */
  workspaceIds: string[]
}
/** PROMOTE_LESSON result (spec L3): the promoted global lesson plus provenance. */
export interface PromoteLessonResult {
  /** The global lesson after promotion (created or patched). */
  lesson: Lesson
  /** Workspace ids the rule was promoted from. */
  workspaceIds: string[]
  /** true when the rule already existed globally and was only re-marked. */
  alreadyGlobal: boolean
}
/** M5: read-only view of a project's agent-managed MEMORY.md for the Memory tab. */
export interface ProjectMemoryDto {
  name: string
  /** Project slug (stable route key). */
  slug: string
  /** Absolute path to projects/{slug}/MEMORY.md. */
  memoryPath: string
  /** MEMORY.md content ('' when absent), capped for transport. */
  memoryContent: string
}

export type AuditActor = 'ui' | 'distill' | 'rpc' | 'queue' | 'user' | 'agent' | 'automation'

export type AuditAction =
  | 'add'
  | 'update'
  | 'delete'
  | 'promote'
  | 'conflict'
  | 'approved'
  | 'dismissed'
  /** Knowledge bridge actions (spec K-05 §3.8: knowledge.proposal.created/…). */
  | `knowledge.${string}`

/**
 * One append-only audit line in {scope}/memory/audit.jsonl (spec F2).
 * Written by LessonStore mutations, MemoryService.applyResult and
 * SkillPendingQueue approve/dismiss.
 */
export interface AuditEntry {
  /** ISO timestamp */
  ts: string
  actor: AuditActor
  action: AuditAction
  /** Rule text for lessons, slug for skills, 'context.md' for memory updates. */
  target: string
  detail?: string
  scope: LessonScope
}

export interface MemoryConfig {
  /** master switch, default true */
  enabled: boolean
  /** idle hours before full distillation, default 3 */
  distillIdleHours: number
  /** messages between lightweight distillations, default 30 */
  distillMsgCount: number
  /**
   * L5: ask the distiller to phrase constraint-type lessons as negative
   * formulations (never/MUST NOT) where idiomatic, default true.
   */
  negativeFirst: boolean
  /**
   * P1: extra literal strings (project names, internal hostnames, paths, …)
   * masked by redactSecrets in addition to the built-in secret shapes —
   * applied to the distill window before it leaves the machine AND to the
   * distilled result before it is persisted. Case-insensitive. Default [].
   */
  redactExtraPatterns: string[]
  /**
   * M1: top-K lessons/context entries returned by the FTS query path
   * (memory.getContext with a query). Default 20.
   */
  ftsLimit: number
  /**
   * M2: semantic (episodic) memory layer — opt-in. When true, distilled
   * session summaries are stored as success/failure episodes
   * ({workspace}/memory/episodic.jsonl) and the prompt's workspace-memory
   * block gains a '## Related past sessions' tail with the vector top-3
   * (topical overlap ≥ 0.78) for the current query. Enabling triggers a
   * one-time lazy download of the local embedding model
   * (Xenova/all-MiniLM-L6-v2, ~90MB) into {configDir}/models; without the
   * model the layer degrades to keyword-overlap matching. Default false.
   */
  semantic: boolean
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: true,
  distillIdleHours: 3,
  distillMsgCount: 30,
  negativeFirst: true,
  redactExtraPatterns: [],
  ftsLimit: 20,
  semantic: false,
}

/** Hard limits (mirror KiroCrew learn.py) */
export const LESSON_LIMITS = {
  /** max lessons kept in a store file; oldest pruned beyond this */
  total: 200,
  /** max lessons injected into a prompt context */
  context: 50,
  /** max conflict events kept per lesson (spec F1: cap last 20) */
  conflicts: 20,
  /** max injection timestamps kept per lesson (usage history) */
  usedAt: 20,
} as const

export interface SkillCandidate {
  slug: string
  description: string
  /** SKILL.md body without frontmatter */
  body: string
  source: {
    /** Native personal custody, assigned only by a trusted producer. */
    owner?: LessonOwner
    sessionId?: string
    ts: string
    toolCallStats?: Record<string, number>
  }
}

/**
 * A skill candidate awaiting approval in {workspaceRoot}/skills/.pending/.
 * Returned by skillsPending:list — parsed .meta.json plus raw SKILL.md content.
 */
export interface PendingSkill {
  slug: string
  description: string
  /** Raw SKILL.md file content (with frontmatter) */
  content: string
  source: SkillCandidate['source']
  /**
   * S3 versioning: set when this candidate supersedes an approved skill of
   * the same slug — approving it snapshots the live SKILL.md into
   * .versions/v{N}-SKILL.md before overwriting.
   */
  updates?: string
  /** S3: version number the candidate will become on approve (display hint). */
  nextVersion?: number
  /**
   * S2: forbidden-token violations found by validateSkillContent in fenced
   * shell blocks. Non-empty blocks approve unless forced. Absent means clean.
   */
  violations?: string[]
}

/** S3: payload of skillsPending:diff — base is the last-known-good version. */
export interface PendingSkillDiff {
  /**
   * Latest .versions snapshot of the approved skill, or its live SKILL.md
   * when no snapshots exist yet. null when the candidate is brand-new.
   */
  base: string | null
  /** Raw pending SKILL.md content of the candidate. */
  candidate: string
}

/** Strict-JSON payload returned by the distillation prompt */
export interface DistillResult {
  history_entry: string | null
  memory_update: string | null
  lessons: Array<{ rule: string; category: LessonCategory; negative?: boolean }>
  skill_candidate: { slug: string; description: string; body: string } | null
}

/** Workspace memory directory contents */
export interface WorkspaceMemory {
  context: string
  preferences: string
  recentHistory: string
}

/**
 * One recalled memory reference (spec c1.5): the lane that produced it and the
 * chunk it points at. Lane 2 (escalation) references are always chosen from
 * provenance-eligible candidates — an untrusted chunk never appears here.
 */
export interface RecallPromptReference {
  chunkId: string
  /** Document path relative to the workspace root. */
  path: string
  /** Deterministic lexical trigger score in [0, 1]. */
  score: number
  origin: MemoryOriginClass
}

/**
 * Provenance of the recall block: which lane produced it (`1` deterministic
 * lexical trigger, `2` escalation sub-agent) and exactly what was injected.
 */
export interface RecallPromptProvenance {
  lane: 1 | 2
  refs: RecallPromptReference[]
}

/**
 * Lifecycle state of a standing intent (spec c1.6, prospective memory).
 * `armed` may fire; `fired` is cooling down; `done` exhausted maxFires;
 * `cancelled` is user-disabled.
 */
export type StandingIntentStatus = 'armed' | 'fired' | 'done' | 'cancelled'

/**
 * A standing intent (spec c1.6): a prospective, event-conditioned rule the
 * agent should recall when a future prompt matches its trigger. `trigger` is a
 * keyword phrase — every trigger token must appear in the prompt for the
 * intent to fire. Time-only reminders are NOT standing intents: scheduling
 * belongs to cron (see `isTimeOnlyIntent`), so such intents are rejected at
 * creation and ignored at match time.
 */
export interface StandingIntent {
  id: string
  /** Human-readable intent text injected into the prompt when it fires. */
  text: string
  /** Keyword phrase whose tokens gate firing (all tokens must be present). */
  trigger: string
  createdAt: string
  status: StandingIntentStatus
  fireCount: number
  maxFires: number
  lastFiredAt?: string
  /** Injection gate (spec c1.2): only owner/agent intents ever enter a prompt. */
  provenance: MemoryChunkProvenance
}

/**
 * Pre-formatted prompt blocks produced by formatLessonsForPrompt /
 * formatWorkspaceMemoryForPrompt and injected into agent system prompts.
 * Resolved by the server core (MemoryService) and passed into the agent
 * backends via BackendConfig.memoryBlocks — agent code never reads the
 * memory store itself.
 */
export interface MemoryPromptBlocks {
  /** Output of formatLessonsForPrompt (caller composes global then workspace lessons) */
  lessonsBlock?: string
  /** Output of formatWorkspaceMemoryForPrompt */
  memoryBlock?: string
  /**
   * Pre-formatted retrieved source docs (FTS hits from the workspace source
   * index). Injected after lessons/memory blocks. Empty/absent when the index
   * is missing, the query is blank, or no hits fit the token budget.
   */
  sourcesBlock?: string
  /**
   * Provenance (spec F4): lessons actually included in lessonsBlock, listed as
   * `{rule, scope}` pairs in the same order they were passed to
   * formatLessonsForPrompt. Absent in records predating F4; present (possibly
   * empty) whenever the blocks were assembled by an F4-aware MemoryService.
   */
  used?: LessonPromptUsage[]
  /**
   * c1.4: provenance-gated MEMORY.md / curated-context bootstrap block. Built
   * from memory chunks whose `originClass` is eligible for automatic injection
   * (`owner`/`agent`); untrusted chunks never appear here. Absent when empty.
   */
  bootstrapBlock?: string
  /**
   * Provenance of exactly the documents folded into `bootstrapBlock`, listed in
   * the same order. Absent when the block was not assembled.
   */
  bootstrap?: Array<{ path: string; provenance: MemoryChunkProvenance }>
  /**
   * c1.5: recall-lane block — deterministic lexical trigger matches (lane 1)
   * or, only when lane 1 is inconclusive and the message shows recall intent,
   * escalation sub-agent picks (lane 2). Absent when nothing was recalled.
   * Untrusted chunks never appear here.
   */
  recallBlock?: string
  /** Provenance of exactly what `recallBlock` injected, in injection order. */
  recall?: RecallPromptProvenance
  /**
   * c1.6: standing-intent block — event-conditioned prospective memories that
   * matched the current prompt, deduplicated and injected once per turn.
   * Absent when no intent fired. Time-only reminders never appear here.
   */
  intentBlock?: string
  /** Ids of exactly the standing intents folded into `intentBlock`. */
  intents?: string[]
}

/** One lesson that was injected into an agent prompt (spec F4). */
export interface LessonPromptUsage {
  rule: string
  scope: LessonScope
}

/**
 * Per-session memory provenance record (spec F4), persisted at
 * {workspace}/sessions/{id}/meta/provenance.json by the SessionManager at the
 * site where prompt blocks are assembled (currently: session start / backend
 * spawn). `skills` (spec S4) are the [skill:slug] mentions recovered from the
 * session's own message contents — skills attach per-message, so the session
 * messages are the only resolvable per-skill prompt-hit set.
 */
export interface SessionProvenance {
  lessons: LessonPromptUsage[]
  skills: string[]
  /** ISO timestamp of the prompt assembly that produced this record */
  ts: string
}

// ---------------------------------------------------------------
// S4: skill usage metrics + prune; T1: team export
// ---------------------------------------------------------------

/** Per-skill usage stats aggregated from {workspace}/skills/.usage.jsonl (spec S4). */
export interface SkillUsageStats {
  /** Number of session spawns whose prompt carried this skill's [skill:slug] mention. */
  used: number
  /** ISO ts of the most recent hit; '' when unknown. */
  lastUsedAt: string
}

/** Usage map keyed by skill slug (skills:getUsage response). */
export type SkillUsageMap = Record<string, SkillUsageStats>

/** Result of archiving unused skills into {workspace}/skills/.archive/ (spec S4). */
export interface SkillPruneResult {
  /** Slugs moved into skills/.archive/. */
  archived: string[]
  /** Requested slugs that were not moved (unknown slug, missing dir, or fs error). */
  skipped: string[]
}

/** Result of copying a workspace skill into a project's .agents/skills (spec T1). */
export interface SkillExportResult {
  slug: string
  /** Absolute target path {projectRoot}/.agents/skills/<slug>. */
  path: string
  /** Target already existed with identical content — nothing was copied. */
  alreadyExisted: boolean
}

// ---------------------------------------------------------------
// Y1: dashboard insights card (memory:insights)
// ---------------------------------------------------------------

/**
 * Aggregated memory metrics for the Memory tab insights card (spec Y1).
 * 7-day counters merge the global and the workspace audit.jsonl; categories
 * and totals come from the current lesson stores (audit lines carry no
 * category, so per-category chips are derived from live lessons).
 */
export interface MemoryInsights {
  /** Lessons added in the last 7 days (audit 'add'), global + workspace. */
  lessonsAdded7d: number
  /** Conflict verdicts recorded in the last 7 days (audit 'conflict'). */
  conflicts7d: number
  /** Current size of the workspace pending-skill queue (0 without a workspace). */
  pendingCount: number
  /** Pending candidates approved in the last 7 days (audit 'approved'). */
  approved7d: number
  /** Lesson count by category across both scopes (0-count categories omitted). */
  categories: Record<string, number>
  /** Total lessons across global + workspace (Y4 onboarding emptiness check). */
  totalLessons: number
  /** Y4: onboarding seed dialog already shown ({configDir}/memory/.onboarded). */
  onboarded: boolean
}

// ---------------------------------------------------------------
// c1.1–c1.4: chunk index + provenance gate
// ---------------------------------------------------------------

/**
 * Who produced a memory chunk, and therefore how far it may be trusted.
 * Computed at index/write time from the producing session kind — never parsed
 * back out of Markdown, which the agent can forge.
 *
 * - `owner`     — human-directed interactive work (the workspace owner's voice).
 * - `agent`     — the agent's own derived artifacts (distillation, subagents).
 * - `untrusted` — provenance unknown/corrupt, or produced by a session we cannot
 *                 vouch for (foreign content, unattributable writes).
 * - `system`    — curated/machine-authored bootstrap material.
 *
 * Only `owner` and `agent` chunks are eligible for automatic prompt injection
 * (see `isMemoryOriginEligibleForAutomaticInjection`); `untrusted` stays
 * retrievable and labelled, but never reaches the prompt.
 */
export type MemoryOriginClass = 'owner' | 'agent' | 'untrusted' | 'system'

/** The kind of session that produced a memory chunk. */
export type MemorySessionKind = 'interactive' | 'cron' | 'heartbeat' | 'subagent' | 'unknown'

/** Provenance stamped on a memory chunk at index time. */
export interface MemoryChunkProvenance {
  originClass: MemoryOriginClass
  sessionKind: MemorySessionKind
  /** ISO timestamp the chunk was observed/written. */
  observedAt: string
  /** Optional key of the chunk this one supersedes (newer-wins recall). */
  supersedesKey?: string
}

/** Capability split of the memory index for the active runtime. */
export interface MemoryIndexCapability {
  /** FTS5 retrieval is available (bun:sqlite present and FTS5 compiled in). */
  fts5: boolean
  /** sqlite-vec / vector retrieval is available (not yet: no loadable extension). */
  vector: boolean
}

/** One ranked memory search hit. */
export interface MemorySearchHit {
  chunkId: string
  /** Document path relative to the workspace root (or the memory dir). */
  path: string
  /** 1-based inclusive line span of the chunk within its document. */
  startLine: number
  endLine: number
  /** Final ranking score (higher = better). */
  score: number
  /** Lexical (BM25) component of the score. */
  textScore?: number
  /** Vector component of the score (absent while vector retrieval is unavailable). */
  vectorScore?: number
  /** Short excerpt for display. */
  snippet: string
  /** Full chunk text. */
  text: string
  /** Provenance class — the single source of truth for the injection gate. */
  origin: MemoryOriginClass
  provenance: MemoryChunkProvenance
}

/** Result of `memory:search`. */
export interface MemorySearchResult {
  hits: MemorySearchHit[]
  capability: MemoryIndexCapability
}

/** Result of `memory:get` (null when the chunk id is unknown). */
export interface MemoryGetResult {
  chunkId: string
  path: string
  startLine: number
  endLine: number
  text: string
  origin: MemoryOriginClass
  provenance: MemoryChunkProvenance
  metadata?: Record<string, unknown>
}

/** Lifecycle state of the workspace memory index. */
export type MemoryIndexState = 'absent' | 'building' | 'ready' | 'stale' | 'failed'

/** Result of `memory:indexStatus`. */
export interface MemoryIndexStatus {
  state: MemoryIndexState
  /** Number of chunks in the built index (0 when absent/stale). */
  chunks?: number
  /** Epoch ms of the last successful build. */
  updatedAt?: number
  /** Sanitized error detail for `failed` (never a raw stack). */
  safeError?: string
  /** Capability split at status time. */
  capability?: MemoryIndexCapability
  /** Identity string `v<chunkingVersion>:<provider>/<model>`. */
  indexIdentity?: string
  /** Chunking version baked into the current build. */
  chunkingVersion?: number
  /** Runtime backend that produced the current build. */
  backend?: 'fts5' | 'js'
}
