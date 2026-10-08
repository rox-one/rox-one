# Continual learning in ROX

This page documents the ROX **continual learning & self-improvement** layer for
operators and engineers: what the loop is, which entities it persists, how a
hypothesis becomes durable knowledge, how it is measured, and how to inspect,
approve, reject, or roll it back.

The frozen wire-safe types live in
[`packages/shared/src/memory/learning.ts`](../../packages/shared/src/memory/learning.ts);
the internal service contracts live in
[`packages/server-core/src/memory/learning/learning-types.ts`](../../packages/server-core/src/memory/learning/learning-types.ts).
Both are frozen for the first iteration — treat names in this page as the
contract.

## The norm

> **LLM-generated learning output is always a hypothesis until validated by evidence.**

(PRD §48.) Every reflection output is a *candidate*, never durable knowledge.
The candidate only changes agent behavior after ROX — not the model — computes
confidence from stored evidence and the deterministic validator (plus an
optional LLM judge) agrees it may be promoted. This is why the model's own
`modelConfidenceEstimate` is kept for auditing but is never used as the
candidate's `confidence`.

## The loop

```text
experience ──► observation ──► hypothesis ──► validation ──► promotion
                                              │                   │
                                              ▼                   ▼
                                          rejected           mutation
                                              │                   │
                                              ▼                   ▼
                                        skill v4 …          outcome (measured)
                                                                  │
                                                                  ▼
                                                    rollback on regression
                                                                  │
                                                                  ▼
                                                     (itself a learning signal)
```

1. **Experience** — a session runs: tools, skills, memory injections, git
   changes, user corrections, verification results.
2. **Observation** — the observation pipeline (`normalize → extract events →
   classify corrections → attach provenance → attach outcome → persist`) turns
   the session into a structured `LearningObservation`. This is telemetry, not
   memory.
3. **Hypothesis** — `ReflectionEngine` reads the observation plus transcript,
   runtime trace, tool outcomes, memory/skills used, corrections, verification,
   and `git diff`, and emits hypotheses, observations, and — importantly —
   `rejectedHypotheses` ("looks like a signal, but there is not enough
   evidence"). Rejections reduce memory pollution.
4. **Validation** — `CandidateValidator` runs the deterministic passes first
   (below) and only then asks an LLM judge. The verdict is `promotable`.
5. **Promotion** — a promotable candidate is written to the *existing*
   source-of-truth store (lesson / skill / policy) as a reversible
   `LearningMutation`.
6. **Outcome** — subsequent sessions produce `TaskOutcome` rows keyed by a
   comparable-task `taskFingerprint`; `evaluateOutcomes()` feeds
   `EffectivenessScorer`.
7. **Rollback** — a regression reverted by `RollbackManager`. The rollback is
   itself recorded and used as a learning signal (PRD §41).

## Entities

Every name below is exported from `packages/shared/src/memory/learning.ts`.

| Entity | Type | What it is |
|---|---|---|
| **Observation** | `LearningObservation` | Raw structured signal from a session; `LearningObservationKind` names the lifecycle event. Telemetry, not memory. |
| **Correction** | `UserCorrection` | The highest-value signal. `UserCorrectionCategory`: `fact`, `preference`, `workflow`, `tool`, `architecture`, `style`. |
| **Evidence** | `LearningEvidence` / `EvidenceRef` | Deterministic reference (`session`, `user_correction`, `successful_outcome`, `failed_outcome`, `tool_trace`, `git_diff`, `test_result`, `skill_usage`, `memory_usage`, `repository`, `recurrence`) plus a `weight` (0..1). |
| **Candidate** | `LearningCandidate` | The central object. `LearningCandidateType`: `lesson`, `skill`, `preference`, `policy`. Status: `candidate → validating → approved → active`, or `rejected` / `rolled_back`. Scoped `global \| workspace \| project \| session`. |
| **Experiment** | `LearningExperiment` | Baseline vs treatment with `sampleSize` and status `running \| passed \| failed \| inconclusive`. |
| **Outcome** | `TaskOutcome` | Did it actually get better? Status `success \| failure \| partial \| aborted`, with quality, duration, tokens, verification, correction/skill/memory usage. |
| **Mutation** | `LearningMutation` | Every durable change is reversible. `LearningMutationTargetType`: `lesson`, `skill`, `policy`, `memory`; status `applied \| confirmed \| reverted`; carries `before`/`after` and expected vs actual effect. |
| **Policy** | `LearningPolicy` | Learned orchestration policy — never memory, approval level 3. Task class, preferred model/skills, verification steps, delegation hint, tool order. |

Candidates are deduplicated deterministically: `candidateFingerprint()` hashes
`type + normalized hypothesis + scope + sorted evidence ids` (sha256), so the
same evidence set can never yield two candidates for the same hypothesis.

### Validation passes

`CandidateValidator` runs **eight deterministic passes in this order** before
any LLM judgement (PRD §37 + the `consistency` pass in code):

| # | Pass id | Question |
|---|---|---|
| 1 | `duplicate` | Does a candidate with this fingerprint already exist? |
| 2 | `contradiction` | Does it contradict an existing lesson/skill/policy? |
| 3 | `scope` | Is the requested scope valid for this type? |
| 4 | `sensitive` | Does it touch secrets/credentials/deployment? |
| 5 | `evidence_count` | Enough distinct evidence items? |
| 6 | `repository_evidence` | Is there repository support (files, tests, diff)? |
| 7 | `outcome_evidence` | Is there measured-outcome support? |
| 8 | `consistency` | Are the component scores internally consistent? |

Only when every pass returns `ok` (at the candidate's policy level) is the
result `promotable: true`; a judge, when available, is asked afterwards and its
verdict recorded separately — it never overrides the deterministic verdict.

### Confidence and effectiveness

Confidence is a **product**, computed by ROX from stored evidence (PRD §38):

```text
confidence = recurrence × evidenceQuality × userSignal
           × repositorySupport × outcomeSupport × consistency
```

`computeConfidence(components)` clamps every component to 0..1 and returns the
clamped product. Because it is a product, one zero component zeroes the whole
score — "plausible but uncorroborated" cannot reach a promotion threshold.

Effectiveness is kept **as separate component scores**, never one opaque number
(PRD §18):

```text
effectiveness = 0.50 × successRate
              + 0.20 × reuseRate
              + 0.15 × confidence
              + 0.15 × (1 − correctionRate)
              − 0.50 × conflictRate
```

`computeEffectiveness(components)` clamps each component and the result.
`EffectivenessComponents` = `successRate`, `correctionRate`, `conflictRate`,
`reuseRate`, `confidence`; `ConfidenceComponents` = `recurrence`,
`evidenceQuality`, `userSignal`, `repositorySupport`, `outcomeSupport`,
`consistency`.

## Thresholds and configuration

The self-improvement policy replaces the boolean
`skills.autoCreateFromSessions` (PRD §42). Config key: **`skills.learning`** in
`packages/shared/src/config/storage.ts`, resolved by
`getSkillsLearningPolicy()`:

| Field | Default (`DEFAULT_SKILLS_LEARNING_POLICY`) | Meaning |
|---|---|---|
| `enabled` | `true` | master switch |
| `autoCreate` | `'off'` | `off \| candidate \| autonomous` |
| `autoImprove` | `'candidate'` | `off \| candidate \| autonomous` |
| `minEvidence` | `3` | integer 1..20 |
| `minConfidence` | `0.85` | 0..1 |
| `requireVerification` | `true` | verification pass required before promotion |

Legacy migration (PRD §43): `autoCreateFromSessions: false → autoCreate: 'off'`,
`true → 'candidate'`. `'autonomous'` only ever turns on explicitly. Invalid
values fall back field-by-field to the defaults; an explicit `skills.learning`
object wins over the legacy boolean entirely.

Per-type promotion thresholds (`DEFAULT_LEARNING_THRESHOLDS`, configurable via
`skills.learning`, PRD §39):

| Threshold | Default |
|---|---|
| `lessonMinEvidence` / `lessonMinConfidence` | `3` / `0.7` |
| `skillMinEvidence` / `skillMinConfidence` | `2` / `0.75` |
| `skillPatchMinEvidence` / `skillPatchMinConfidence` | `3` / `0.75` |
| `policyMinEvidence` / `policyMinConfidence` | `10` / `0.85` |
| `rollbackSuccessDrop` | `0.1` |
| `rollbackCorrectionRate` | `0.25` |

A lesson needs 3 repeated independent observations **or** 1 strong user
correction; a skill needs 2+ instances of the same reusable workflow plus
successful-completion evidence; a skill patch needs 3+ failures/corrections or
strong deterministic evidence; a policy needs ≥10 comparable tasks or explicit
user confirmation.

Safety levels (PRD §16–17) gate what may happen without review:
`LearningSafetyLevel` is `0 | 1 | 2 | 3`. Level 0 (observations, evidence,
statistics) is free; level 1 (workspace lesson at high confidence) is
autonomous; level 2 (new/modified skill) requires review; level 3 (global
memory, orchestration policy, security/credentials/deployment) requires
approval. In code, `PromotionEngine.promote()` refuses `approval: 'autonomous'`
when the candidate is `scope: 'global'` **or** `type: 'policy'`.

## Rollback

`RollbackManager` undoes `LearningMutation` rows (PRD §40). A skill is
auto-rolled back on regression when, against the comparable-task baseline:

- new success rate drops by more than `rollbackSuccessDrop` (`> 0.1`), **or**
- correction rate exceeds `rollbackCorrectionRate` (`> 0.25`), **or**
- the error rate increased.

Rollback semantics:

- `revert(mutationId)` refuses unknown / already-reverted / non-rollbackable
  rows, and refuses to rip out a skill that is already approved into
  `skills/<slug>` (`'skill already approved'`).
- On success the mutation flips to `reverted`, the owning candidate flips to
  `rolled_back`, and an `action: 'rollback'` line is appended to the audit log.
- `revertCandidate` reverts every non-reverted mutation of a candidate.

**A rollback is itself a learning signal** (PRD §41): `Skill v4 → rolled back`
does not merely say "v4 is bad", it says *the hypothesis behind v4 was wrong*.
The learning timeline must record the causal chain `mutation → failure
evidence → rollback`, and the next reflection pass is expected to reason about
**why** the hypothesis failed. The automatic regression trigger runs from
`LearningService.evaluateOutcomes()` (PRD §40–41).

## Storage layout

Learning data is JSONL only (PRD §5) — no DB migration in this iteration. The
canonical directory helper is `learningDirFor(workspaceRoot)` in
`packages/server-core/src/memory/learning/learning-types.ts`:

```text
{workspaceRoot}/memory/learning/
    observations.jsonl
    candidates.jsonl
    evidence.jsonl
    outcomes.jsonl
    mutations.jsonl
    experiments.jsonl
    policies.jsonl
    queue.jsonl
    learning-audit.jsonl
```

The existing memory stores stay **source-of-truth** for the memory objects
themselves — the learning layer only keeps its ledger and writes through to
them:

```text
lessons.jsonl             lesson memory objects (LessonStore)
episodic.jsonl            episodic memory objects (EpisodicMemory)
audit.jsonl               existing memory audit
skills/.pending/<slug>/   queued skills (SkillPendingQueue)
```

Promotion writes to these targets through `LearningTargetStores`: lessons land
in the same `lessons.jsonl` the prompt assembler reads, skills in
`skills/.pending/<slug>/`, and policies in `policies.jsonl` (the learning-dir
store above).

`LearningStore<T>` backs every JSONL file: fail-soft reads (corrupt lines are
skipped), atomic rewrite via `.tmp` + rename, idempotent `save`/`saveMany`.
A separate SQLite/FTS projection DB is anticipated for analytics but is not
part of the first iteration (PRD §6).

## RPC surface

The `learning:*` namespace is declared in
`packages/shared/src/protocol/channels.ts` (`RPC_CHANNELS.learning`) and served
by `packages/server-core/src/handlers/rpc/learning.ts` — **20 channels** in
three groups:

*Read (9):*
`learning:listCandidates`, `learning:getCandidate`, `learning:listEvidence`,
`learning:getOutcome`, `learning:getExperiment`, `learning:getStats`,
`learning:getSkillEffectiveness`, `learning:getPolicy`, `learning:getTimeline`.

*Actions (8):*
`learning:approve`, `learning:reject`, `learning:rollback`,
`learning:revalidate`, `learning:forceReflect`, `learning:consolidate`,
`learning:curateSkills`, `learning:runPolicyLearning`.

*Agent / native (3):*
`learning:observe`, `learning:recordOutcome`, `learning:recordCorrection`.

The three agent/native channels require native context and are deliberately
absent from the renderer channel map — a renderer cannot call them. Host
compatibility: when an older host does not serve the namespace, the handler
throws `CodedError('UNSUPPORTED_OPERATION', 'Learning operations are unavailable
on this host')`; clients render an explanatory "unavailable" state instead of
crashing. There is no `learning:changed` push channel yet — every own mutation
must refetch.

## UI

The Learning screen lives at
`apps/electron/src/renderer/components/learning/LearningScreen.tsx` and is
mounted from `MainContentPanel.tsx` next to Memory / Skills / Sessions. Its
views follow PRD §25–30: dashboard, candidate inspector, skill evolution,
timeline, and help. Everything shown is an *evidence dashboard*: candidates are
presented as hypotheses, and approve / reject / rollback are the three
operator actions.

The learning timeline (`LearningTimelineEntryDto`, `kind: observation |
candidate | mutation | outcome | rollback | experiment`) is designed to overlay
the ROX **runtime map**, connecting `session → observation → candidate →
mutation → outcome` so an operator can see *why the agent changed* (PRD §29–30).
See [`docs/runtime-map/`](../runtime-map/).

## Operator runbook

**Read the timeline.** Open Learning → Timeline. Each entry carries `ts`,
`kind`, `id`, optional `sessionId`, a `summary`, and optional `detail`. Walk
backwards from an outcome to its mutation, candidate, and the observations that
produced it. Drill into a candidate (Learning → Candidates) to see its evidence
list, confidence components, and per-pass validation results.

**Approve.** Use `learning:approve` (or the inspector's Activate button) for a
candidate that is `approved`/`validating` and whose evidence you accept. Scope
`global` and type `policy` always require this explicit user action — they are
never promoted autonomously.

**Reject.** Use `learning:reject` with a reason. The reason is retained on the
candidate (`rejectedReason`) so the same bad hypothesis is not re-proposed.

**Rollback.** Use `learning:rollback` for an applied mutation. Auto-rollback
also fires from outcome evaluation on regression, but a manual rollback is
always available because every mutation is reversible.

**Revalidate.** Use `learning:revalidate` to re-run the deterministic passes
(e.g. after new evidence arrived). This re-runs the validator against the
candidate's current evidence and updates its status.

## Prohibitions (PRD §44)

Four things are deliberately forbidden:

1. **No auto-learning from every transcript.** Otherwise memory gets polluted;
   observations are cheap, candidates come only from recurring patterns.
2. **No treating an error as the cause of any injected lesson.**
   `recordProvenanceConflicts()` is an *input to causal evaluation*, never a
   final verdict.
3. **No changing global memory without evidence.** Otherwise one
   project-specific experience becomes a global rule.
4. **No letting the agent change its own learning policies.** Otherwise
   `agent → changes policy → policy permits more changes → agent becomes ever
   more autonomous`. A trust boundary is required.

**No parallel memory system.** `LessonStore`, `EpisodicMemory`,
`SkillPendingQueue`, and `MemoryProposalStore` remain the source-of-truth for
memory objects; the learning layer only maintains its ledger and calls into
them through `LearningTargetStores`. `MemoryService`'s distill/recall/decay
becomes the first stage of the learning system, not a competing one.

## References

- PRD: [`docs/plans/2026-10-08-continual-learning-prd.md`](../plans/2026-10-08-continual-learning-prd.md)
  (§3 entities, §5/§7 storage, §15 RPC, §16–17 safety, §18 scoring, §25–30 UI,
  §35–41 pipeline/validation/rollback, §44 prohibitions, §46 DoD, §48 norm).
- Program: [`docs/plans/2026-10-08-continual-learning-program.md`](../plans/2026-10-08-continual-learning-program.md)
- Shared types: `packages/shared/src/memory/learning.ts`
- Server module: `packages/server-core/src/memory/learning/`
- Config: `packages/shared/src/config/storage.ts` (`skills.learning`)
- Channels: `packages/shared/src/protocol/channels.ts` (`learning`)
- RPC handler: `packages/server-core/src/handlers/rpc/learning.ts`
- UI: `apps/electron/src/renderer/components/learning/LearningScreen.tsx`