lets work on github.com/rox-one/rox-one 

<attachment>
Ниже PRD, который я бы положил прямо поверх текущего `MemoryService`, не создавая параллельную memory-систему. Ключевой принцип: **ROX не должен автоматически считать любой вывод LLM новой истиной**. Он должен вести `experience → observation → hypothesis → validation → promotion → outcome → rollback`, а существующие `LessonStore`, `EpisodicMemory`, `SkillPendingQueue` и session provenance становятся хранилищами и исполнительными механизмами этого цикла.

# PRD — ROX Continual Learning & Self-Improvement

## 0. Цель

Превратить ROX из системы:

```text
session
→ distill
→ memory/skill candidate
```

в систему:

```text
session
→ observe
→ reflect
→ generate learning candidates
→ validate against evidence
→ promote
→ use
→ measure outcome
→ keep / revise / rollback
```

Система должна уметь автономно улучшать:

1. **semantic memory** — что агент знает;
2. **episodic memory** — что происходило;
3. **procedural memory** — как действовать;
4. **preferences** — как пользователь/проект хочет работать;
5. **orchestration policy** — какую стратегию решения выбирать.

### Non-goals

В первой версии **не** нужно обучать model weights, делать fine-tuning или RL training.

Это continual learning **на уровне agent runtime**.

---

# 1. Что уже считаем существующей платформой

Не создавать дубликаты:

```text
packages/server-core/src/memory/MemoryService.ts
packages/server-core/src/memory/LessonStore.ts
packages/server-core/src/memory/episodic-memory.ts
packages/server-core/src/memory/lesson-graph.ts
packages/server-core/src/memory/SkillPendingQueue.ts
packages/server-core/src/memory/decay.ts

packages/shared/src/memory/types.ts
packages/shared/src/prompts/
packages/shared/src/sessions/
packages/shared/src/skills/

packages/server-core/src/sessions/SessionManager.ts
packages/server-core/src/sessions/runtime-trace/
packages/server-core/src/handlers/rpc/memory.ts
packages/server-core/src/handlers/rpc/skills-pending.ts
```

Текущий `MemoryService` уже:

- получает completion/interruption/error/branch;
- запускает distillation;
- пишет lessons;
- пишет history/context;
- пишет episodic summaries;
- собирает memory в prompt;
- считает usage;
- фиксирует conflicts;
- создаёт skill candidates;
- имеет pending queue;
- поддерживает skill versions;
- имеет decay.

Новый слой должен **оркестрировать эти механизмы**, а не заменять их.

---

# 2. Новая архитектура

Добавить поверх существующего memory:

```text
                          SESSION
                             │
                             ▼
                     Runtime Observation
                             │
                             ▼
                     ┌─────────────────┐
                     │ Reflection      │
                     │ + Pattern       │
                     │ + Evaluation    │
                     └────────┬────────┘
                              │
                         candidates
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
       Lesson              Skill              Policy
       Candidate           Candidate           Candidate
          │                   │                   │
          └───────────────────┼───────────────────┘
                              ▼
                       Evidence Engine
                              │
                       confidence/effect
                              │
                  ┌───────────┼───────────┐
                  ▼           ▼           ▼
               promote     observe      reject
                  │
                  ▼
            ACTIVE KNOWLEDGE
                  │
                  ▼
              NEXT SESSION
                  │
                  ▼
               OUTCOME
                  │
                  └──────────────► Evaluation
```

---

# 3. Новые сущности

Я бы добавил **8 основных сущностей**.

## 3.1 `LearningObservation`

Сырые структурированные сигналы из session.

```ts
export interface LearningObservation {
  id: string
  sessionId: string
  workspaceId: string
  ts: string

  task?: {
    goal?: string
    category?: string
  }

  execution: {
    tools: string[]
    skills: string[]
    models: string[]
    delegated: boolean
  }

  outcome: {
    status: 'success' | 'failure' | 'partial' | 'aborted'
    reason?: string
  }

  signals: {
    userCorrections: UserCorrection[]
    errors: ExecutionError[]
    branches: number
    interruptions: number
    verification?: VerificationResult
  }

  memory: {
    lessonsInjected: LessonUsage[]
    episodesRecalled: EpisodeUsage[]
    skillsInjected: string[]
  }

  artifacts: {
    filesChanged: number
    testsPassed?: number
    testsFailed?: number
  }
}
```

Это **не memory**.

Это telemetry/training example.

---

# 3.2 `LearningCandidate`

Главный новый объект.

```ts
export interface LearningCandidate {
  id: string

  type:
    | 'lesson'
    | 'skill'
    | 'preference'
    | 'policy'

  scope:
    | 'global'
    | 'workspace'
    | 'project'
    | 'session'

  hypothesis: string

  payload: unknown

  evidence: EvidenceRef[]

  confidence: number

  status:
    | 'candidate'
    | 'validating'
    | 'approved'
    | 'active'
    | 'rejected'
    | 'rolled_back'

  createdAt: string
  updatedAt: string
}
```

Ключевой момент:

**candidate не становится durable knowledge сразу.**

---

# 3.3 `Evidence`

```ts
export interface LearningEvidence {
  id: string

  type:
    | 'session'
    | 'user_correction'
    | 'successful_outcome'
    | 'failed_outcome'
    | 'tool_trace'
    | 'git_diff'
    | 'test_result'
    | 'skill_usage'
    | 'memory_usage'

  ref: string

  weight: number

  metadata?: Record<string, unknown>

  ts: string
}
```

Это позволит потом объяснить:

> Почему ROX решил, что это правило истинно?

---

# 3.4 `LearningExperiment`

Нужен для проверки новых skills / policy.

```ts
export interface LearningExperiment {
  id: string

  candidateId: string

  baseline: {
    behavior: string
    metrics: Record<string, number>
  }

  treatment: {
    behavior: string
    metrics: Record<string, number>
  }

  sampleSize: number

  status:
    | 'running'
    | 'passed'
    | 'failed'
    | 'inconclusive'

  createdAt: string
  completedAt?: string
}
```

---

# 3.5 `TaskOutcome`

Это один из самых важных объектов.

```ts
export interface TaskOutcome {
  id: string
  sessionId: string

  taskFingerprint: string

  status: 'success' | 'failure' | 'partial' | 'aborted'

  qualityScore?: number

  durationMs?: number
  tokenUsage?: number

  verification?: {
    testsPassed?: number
    testsFailed?: number
    buildPassed?: boolean
    lintPassed?: boolean
  }

  userCorrections: number

  memoryUsed: string[]
  skillsUsed: string[]

  errors: string[]

  ts: string
}
```

Это позволяет ответить:

> стало ли после изменения реально лучше?

---

# 3.6 `LearningMutation`

Каждое изменение durable state должно быть reversible.

```ts
export interface LearningMutation {
  id: string

  candidateId: string

  targetType:
    | 'lesson'
    | 'skill'
    | 'policy'
    | 'memory'

  targetId: string

  before: unknown
  after: unknown

  expectedEffect?: Record<string, number>

  actualEffect?: Record<string, number>

  rollbackAvailable: boolean

  status:
    | 'applied'
    | 'confirmed'
    | 'reverted'

  ts: string
}
```

---

# 3.7 `LearningPolicy`

Это новый класс данных, который отсутствует в нынешней модели ROX.

Например:

```json
{
  "taskClass": "frontend-bug",
  "preferredModel": "X",
  "preferredSkills": [
    "browser-debugging"
  ],
  "verification": [
    "targeted-test",
    "typecheck"
  ],
  "delegation": "avoid",
  "confidence": 0.87
}
```

Это уже **не memory**.

Это learned orchestration.

---

# 3.8 `UserCorrection`

Особенно важный signal.

```ts
export interface UserCorrection {
  id: string
  sessionId: string

  original: string
  corrected: string

  category:
    | 'fact'
    | 'preference'
    | 'workflow'
    | 'tool'
    | 'architecture'
    | 'style'

  confidence: number

  ts: string
}
```

В идеале одна фраза пользователя должна иметь больший learning weight, чем 20 похожих LLM-generated observations.

---

# 4. Новые файлы

Я бы добавил:

```text
packages/server-core/src/memory/learning/
├── LearningService.ts
├── LearningWorker.ts
├── LearningQueue.ts
├── ObservationStore.ts
├── CandidateStore.ts
├── EvidenceStore.ts
├── OutcomeStore.ts
├── MutationStore.ts
├── ReflectionEngine.ts
├── PatternDetector.ts
├── CandidateValidator.ts
├── EffectivenessScorer.ts
├── ConsolidationEngine.ts
├── SkillEvolutionEngine.ts
├── PolicyLearner.ts
├── RollbackManager.ts
└── learning-types.ts
```

И отдельно:

```text
packages/shared/src/memory/learning.ts
```

для shared types.

---

# 5. Хранилище

Я **не стал бы сразу тащить Postgres/SQLite** в этот слой.

Для текущей архитектуры ROX JSONL подходит лучше.

Использовать:

```text
{workspace}/memory/
    observations.jsonl
    candidates.jsonl
    evidence.jsonl
    outcomes.jsonl
    mutations.jsonl
    experiments.jsonl
    learning-audit.jsonl
```

А существующие:

```text
lessons.jsonl
episodic.jsonl
audit.jsonl
```

остаются source-of-truth для самих memory objects.

### Почему так

Это сохраняет:

- локальность;
- crash tolerance;
- append-only semantics;
- простую диагностику;
- совместимость с текущим filesystem-oriented design;
- отсутствие миграции DB.

Позже для аналитики можно построить SQLite/FTS projection.

---

# 6. Нужна отдельная projection DB

Не обязательно в первой итерации, но архитектурно стоит заложить.

```text
memory JSONL
      ↓
learning projection
      ↓
SQLite
```

Она нужна для запросов вроде:

```text
top failing skills last 30 days
```

или:

```text
lessons with >20 uses and <50% effectiveness
```

JSONL остаётся canonical storage.

SQLite — derived index.

---

# 7. Изменение `MemoryService`

`MemoryService` не должен становиться монстром.

Оставить ему:

```text
session completion
message count
idle
distillation
memory write
memory prompt assembly
```

И добавить одну точку:

```ts
learningService.observeSession(...)
```

То есть:

```text
MemoryService
    ↓
LearningService
```

а не наоборот.

---

# 8. Lifecycle hooks

Нужны 10 событий.

## `session.created`

Создаёт learning context.

## `session.prompt.assembled`

Записывает:

```text
lessons
episodes
skills
model
```

которые реально попали в execution.

Это уже частично существует через provenance.

## `tool.call`

Для outcome analysis.

## `tool.result`

Сохраняет:

```text
success / failure / latency / error
```

## `user.correction`

Новый hook.

Триггерится когда пользователь:

- branch'ит;
- исправляет план;
- отклоняет решение;
- прямо корректирует факт/workflow.

## `verification.completed`

Например:

```text
tests
typecheck
build
lint
```

## `session.completed`

Создаёт `TaskOutcome`.

## `session.failed`

То же, но с failure evidence.

## `session.branches`

Особый high-value correction signal.

## `workspace.idle`

Запускает background learning.

---

# 9. Главный lifecycle

После этого:

```text
Session complete
      ↓
MemoryService.distill()
      ↓
LearningService.observe()
      ↓
ObservationStore
      ↓
ReflectionEngine
      ↓
LearningCandidate[]
      ↓
CandidateValidator
      ↓
Promotion / Reject
      ↓
Memory / Skill / Policy
      ↓
next sessions
      ↓
Outcome
      ↓
EffectivenessScorer
```

---

# 10. Background jobs

Нужны не один, а несколько workers.

## Job 1 — `session-reflection`

Триггер:

```text
session.completed
```

Задача:

```text
transcript
+ runtime trace
+ provenance
+ outcome
→ candidate observations
```

Это дешёвый анализ.

---

## Job 2 — `learning-consolidation`

Раз в несколько часов.

Собирает:

```text
candidate observations
```

и ищет:

```text
repeated pattern
```

Например:

```text
session 1 → correction A
session 2 → correction A
session 3 → correction A
```

создаётся один candidate.

---

# 11. Job 3 — `skill-curation`

Например, раз в сутки.

Для каждого agent-created skill:

```text
usage
success
failure
corrections
conflicts
```

и решение:

```text
keep
improve
merge
split
archive
```

Это важнее простого periodic cleanup.

---

# 12. Job 4 — `memory-consolidation`

Берёт:

```text
lesson A
lesson B
lesson C
lesson D
```

и обнаруживает:

```text
same fact
same preference
contradiction
subsumption
```

После чего может предложить canonical rule.

Например:

```text
A: use Bun
B: prefer Bun
C: don't use npm
D: Bun is repo package manager
```

↓

```text
Use Bun in this repository.
Never substitute npm/pnpm unless explicitly requested.
```

---

# 13. Job 5 — `policy-learning`

Ежедневно анализирует:

```text
task class
model
skills
tools
delegation
verification
outcome
```

И ищет стратегии с устойчивым выигрышем.

---

# 14. Job 6 — `memory-garbage-collection`

Не просто decay.

Правила:

```text
low use
low effectiveness
old
contradicted
superseded
```

→ archive.

Нельзя просто удалить.

Всегда:

```text
ACTIVE
 ↓
ARCHIVED
```

с reversible restore.

---

# 15. RPC API

Я бы добавил отдельный namespace:

```ts
RPC_CHANNELS.learning
```

### Read

```text
learning:listCandidates
learning:getCandidate
learning:listEvidence
learning:getOutcome
learning:getExperiment
learning:getStats
learning:getSkillEffectiveness
learning:getPolicy
learning:getTimeline
```

### Actions

```text
learning:approve
learning:reject
learning:rollback
learning:revalidate
learning:forceReflect
learning:consolidate
learning:curateSkills
learning:runPolicyLearning
```

### Agent/native actions

```text
learning:observe
learning:recordOutcome
learning:recordCorrection
```

Последние должны быть native/internal, а не произвольными renderer RPC.

---

# 16. Новая модель permissions

Это критично.

Разные операции:

| Операция | Default |
|---|---|
| читать observations | да |
| создавать candidate | да |
| создавать ephemeral hypothesis | да |
| писать durable lesson | controlled |
| создавать skill | controlled |
| patch existing skill | controlled |
| изменять policy | controlled |
| rollback | да |
| менять global preference | строго controlled |

Для `global` scope требования выше, чем для `project`.

---

# 17. Safety policy

Autonomous learning нельзя пускать одинаково на всё.

### Level 0 — свободно

```text
episodic memory
observation
evidence
statistics
```

### Level 1 — autonomous

```text
workspace lesson
```

при высокой confidence.

### Level 2 — review

```text
new skill
existing skill modification
```

### Level 3 — approval required

```text
global memory
orchestration policy
security-related knowledge
credentials
deployment behavior
```

---

# 18. Новый scoring

Нужен `EffectivenessScorer`.

Например:

```text
effectiveness =
    + successful_outcomes
    + verified_artifacts
    + repeated_success
    + user_acceptance
    - user_corrections
    - failures
    - conflicts
    - rollbacks
```

Но не делать это одним линейным числом без контекста.

Хранить компоненты отдельно:

```json
{
  "successRate": 0.91,
  "correctionRate": 0.04,
  "conflictRate": 0.02,
  "reuseRate": 0.73,
  "confidence": 0.94
}
```

---

# 19. Counterfactual evaluation

Это самый важный advanced feature.

Для skill/lesson нельзя просто сравнивать:

```text
before vs after
```

потому что задачи изменяются.

Нужен `taskFingerprint`.

Например:

```text
frontend-debug
auth
nextjs
medium-complexity
```

Тогда:

```text
skill absent:
54 tasks
success = 62%

skill present:
48 tasks
success = 81%
```

Это уже meaningful evidence.

---

# 20. Shadow evaluation

Перед тем как заменить skill v3 на v4:

```text
v3 = active
v4 = candidate
```

Некоторые будущие вызовы можно оценить:

```text
v3 result
v4 simulated result
```

не меняя фактическое поведение.

Для coding workflows можно сделать ещё лучше:

```text
candidate skill
→ isolated branch/worktree
→ agent execution
→ tests
→ score
```

И только потом promotion.

---

# 21. Skill evolution

Новая модель:

```text
skill v1
   ↓
usage
   ↓
failure evidence
   ↓
candidate patch
   ↓
skill v2
   ↓
validation
   ↓
promote
```

Каждая версия должна знать:

```json
{
  "version": 4,
  "parentVersion": 3,
  "evidence": [
    "outcome-103",
    "outcome-119"
  ],
  "reason": "repeated failure on auth refresh",
  "metrics": {
    "v3": 0.71,
    "v4": 0.88
  }
}
```

`SkillPendingQueue` уже умеет version snapshots; сюда нужно добавить **evaluation semantics**, а не писать новую storage систему.

---

# 22. User correction pipeline

Это я считаю обязательным.

Например:

```text
Agent:
npm install

User:
В этом repo только bun.

```

ROX должен автоматически создать observation:

```json
{
  "type": "user_correction",
  "category": "workflow",
  "original": "npm install",
  "corrected": "bun install"
}
```

Но **не сразу** писать lesson.

После повторений:

```text
correction x1 → candidate
correction x2 → confidence ↑
correction x3 + repo evidence → promote
```

---

# 23. Repository evidence

Для coding agent одного transcript недостаточно.

Learning engine должен читать:

```text
package.json
bun.lock
pnpm-lock.yaml
yarn.lock
README
AGENTS.md
CLAUDE.md
project config
git history
test results
```

Например, если пользователь сказал:

> используем Bun

и присутствует `bun.lock`, evidence становится гораздо сильнее.

---

# 24. Memory contradiction engine

У текущего `lesson-graph` уже есть foundation.

Расширить:

```text
CONTRADICTS
SUBSUMES
SUPPORTS
DERIVED_FROM
VALIDATED_BY
SUPERSEDES
```

Например:

```text
Lesson A
   ↓ SUPPORTS
Fact B
   ↓ DERIVED_FROM
Session C
```

и:

```text
Lesson D
   ↓ SUPERSEDES
Lesson A
```

---

# 25. UI

Я бы не засовывал всё в текущую `MemoryScreen`.

Сделал бы отдельный:

```text
Learning
```

рядом с:

```text
Memory
Skills
Sessions
```

---

# 26. Learning dashboard

Главный экран:

```text
Learning

This week

12 observations
4 validated lessons
2 new skills
3 skill improvements
1 rollback

Agent effectiveness
↑ 14%

Memory effectiveness
↑ 9%

Top learned patterns
...
```

Это должно быть **evidence dashboard**, а не декоративный AI UI.

---

# 27. Candidate inspector

Например:

```text
Candidate
────────────────────────────
"Use Bun for this repository"

Confidence: 96%

Evidence
✓ session-21
✓ session-28
✓ session-34
✓ bun.lock
✓ user correction

Observed:
4 times

Outcome correlation:
+18%

Scope:
Project

[Activate]
[Reject]
```

---

# 28. Skill evolution UI

Для skill:

```text
deploy-preview

v3
success: 71%

v4 candidate
success: 86%

Why changed:
Repeated failures during env resolution.

Evidence:
7 sessions

Diff
────────────────────

[Approve]
[Reject]
[Rollback]
```

---

# 29. Learning timeline

Это будет особенно хорошо ложиться на существующую концепцию runtime map.

Например:

```text
Oct 01
  agent learned Bun

Oct 02
  created deploy-preview skill

Oct 03
  skill failed twice

Oct 04
  skill patched

Oct 05
  success rate improved 63 → 87%
```

Можно визуально связать:

```text
session
   ↓
observation
   ↓
candidate
   ↓
mutation
   ↓
outcome
```

Это фактически **карта эволюции агента**.

---

# 30. Runtime Map integration

Это одна из возможностей, которую я бы сделал уникальной для ROX.

В текущую live map добавить:

```text
Memory
Skill
Policy
Evidence
Outcome
```

Например:

```text
          Skill: auth-debug
                 │
                 ▼
        ┌────────────────┐
        │ Session #183   │
        └───────┬────────┘
                │
        user correction
                │
                ▼
        Candidate v2
                │
                ▼
        Test validation
                │
                ▼
          Success +23%
```

То есть пользователь видит **почему агент стал другим**.

---

# 31. `MemoryService` changes

Минимальное изменение:

```ts
export interface MemoryServiceDeps {
  ...
  learningService?: LearningService
}
```

При completion:

```ts
const outcome = await learningService.observeCompletion(...)
```

При prompt assembly:

```ts
learningService.recordContextUsage(...)
```

При branch:

```ts
learningService.recordCorrection(...)
```

При tool execution:

```ts
learningService.recordToolOutcome(...)
```

Но не заставлять `MemoryService` заниматься анализом.

---

# 32. `SessionManager` changes

Ввести lifecycle event bus:

```ts
onSessionCreated
onPromptAssembled
onToolCall
onToolResult
onUserCorrection
onVerificationComplete
onSessionComplete
onSessionFailed
onSessionBranched
```

Тогда learning будет consumer этого bus.

Это лучше, чем десятки прямых импортов:

```text
SessionManager → MemoryService
SessionManager → LearningService
SessionManager → SkillService
SessionManager → ...
```

Нужен:

```text
SessionManager
       ↓
SessionEventBus
       ├── MemoryService
       ├── LearningService
       ├── OutcomeService
       └── Analytics
```

---

# 33. Worker architecture

Не делать один giant timer.

Добавить:

```text
LearningWorker
```

с очередью:

```ts
type LearningJob =
  | SessionReflectionJob
  | ConsolidationJob
  | SkillCurationJob
  | EvaluationJob
  | PolicyLearningJob
  | GarbageCollectionJob
```

В первой версии достаточно in-process queue по аналогии с `MemoryService`.

Но интерфейс сделать таким, чтобы потом можно было заменить на:

```text
SQLite queue
Redis
Upstash
```

без изменения consumers.

---

# 34. Retry/idempotency

Каждый job:

```text
jobId
sourceId
attempt
status
```

Все learning operations должны быть idempotent.

Например:

```text
session-123
```

не должен дважды создать:

```text
candidate-1
candidate-2
```

из одного и того же evidence set.

Нужен deterministic fingerprint:

```text
sha256(
  type +
  normalized hypothesis +
  scope +
  evidence ids
)
```

---

# 35. Observation pipeline

Сам pipeline:

```text
raw session
   ↓
normalize
   ↓
extract events
   ↓
classify corrections
   ↓
attach provenance
   ↓
attach outcome
   ↓
persist observation
```

Только после этого:

```text
reflection
```

---

# 36. Reflection prompt

Текущий `buildDistillPrompt()` следует оставить.

Но сделать второй prompt:

```text
buildReflectionPrompt()
```

Он получает **не только transcript**:

```text
session transcript
runtime trace
tool outcomes
memory used
skills used
user corrections
verification
git diff
```

и возвращает:

```json
{
  "observations": [],
  "hypotheses": [],
  "rejectedHypotheses": []
}
```

Особенно важно поле:

```json
"rejectedHypotheses"
```

чтобы модель могла сказать:

> Это кажется обучающим сигналом, но evidence недостаточно.

Это сильно уменьшит memory pollution.

---

# 37. Validation pipeline

`CandidateValidator` должен иметь deterministic passes до LLM.

### Pass 1

Duplicate?

### Pass 2

Contradiction?

### Pass 3

Scope validity?

### Pass 4

Sensitive?

### Pass 5

Evidence count?

### Pass 6

Repository evidence?

### Pass 7

Outcome evidence?

Только потом LLM judge.

---

# 38. Confidence model

Не позволять LLM назначать:

```text
confidence = 0.98
```

самому себе и принимать это за факт.

Модель может предложить `confidence_estimate`, но итоговый score считается ROX:

```text
confidence =
  recurrence
  × evidenceQuality
  × userSignal
  × repositorySupport
  × outcomeSupport
  × consistency
```

---

# 39. Когда candidate становится ACTIVE

Я бы зафиксировал примерно такие политики.

### Lesson

```text
1 strong user correction
OR
3 repeated independent observations
```

### Skill

```text
2+ instances of same reusable workflow
+
evidence of successful completion
```

### Skill patch

```text
3+ failures/corrections
OR
strong deterministic evidence
```

### Policy

Требует больше evidence:

```text
≥10 comparable tasks
```

или explicit user confirmation.

Пороги лучше сделать configurable.

---

# 40. Rollback

Автоматически rollback:

```text
new skill
success < baseline - threshold
```

или:

```text
correction rate > threshold
```

или:

```text
error rate increased
```

Например:

```text
baseline = 0.81
candidate = 0.64

rollback
```

И обязательно записать:

```text
mutation
↓
failure evidence
↓
rollback
```

Это само по себе является learning signal.

---

# 41. Вторичный learning signal: rollback

Это очень ценно.

Например:

```text
Skill v4
→ rolled back
```

означает:

```text
не просто v4 плохой
```

а:

```text
hypothesis underlying v4 was wrong
```

Значит следующий reflection должен учитывать именно **почему** hypothesis провалилась.

---

# 42. Autonomous skill creation policy

Я бы изменил текущую:

```ts
skills.autoCreateFromSessions
```

не на простой boolean, а на policy:

```ts
skills.learning?: {
  enabled: boolean

  autoCreate: 'off' | 'candidate' | 'autonomous'

  autoImprove: 'off' | 'candidate' | 'autonomous'

  minEvidence: number

  minConfidence: number

  requireVerification: boolean
}
```

Например:

```json
{
  "autoCreate": "autonomous",
  "autoImprove": "candidate",
  "minEvidence": 3,
  "minConfidence": 0.85,
  "requireVerification": true
}
```

---

# 43. Что делать с текущим `autoCreateFromSessions`

Не ломать.

Сделать backward-compatible migration:

```text
false
→ autoCreate = "off"

true
→ autoCreate = "candidate"
```

А новый режим:

```text
autonomous
```

включается отдельно.

---

# 44. Что НЕ надо делать

Я бы сознательно запретил четыре вещи.

### Не делать auto-learning из каждого transcript

Иначе memory загрязнится.

### Не считать error причиной любого injected lesson

Текущий `recordProvenanceConflicts()` должен стать **input для causal evaluation**, а не финальным verdict.

### Не менять global memory без evidence

Иначе один project-specific experience станет глобальным правилом.

### Не давать agent самому менять собственные learning policies

Иначе получится:

```text
agent
→ меняет policy
→ policy разрешает ещё больше изменений
→ agent становится всё более автономным
```

Нужен trust boundary.

---

# 45. Порядок реализации

Я бы делал **7 волн**.

## Wave 1 — Observability

Самая важная фундаментальная работа.

Добавить:

```text
LearningObservation
TaskOutcome
UserCorrection
```

и собрать:

```text
session
tool trace
memory provenance
skill provenance
verification
git changes
```

**Пока ничего автоматически не менять.**

Acceptance:

```text
любая завершённая session
→ reproducible structured observation
```

---

## Wave 2 — Reflection

Добавить:

```text
ReflectionEngine
LearningCandidate
EvidenceStore
```

Pipeline:

```text
observation
→ hypotheses
```

Но:

```text
candidate ≠ mutation
```

Acceptance:

ROX способен показать:

> «После этой сессии я считаю потенциально полезными X, Y и Z, вот evidence».

---

## Wave 3 — Memory validation

Подключить:

```text
Lesson candidates
→ recurrence
→ contradiction
→ repository evidence
→ confidence
```

И только потом писать в `LessonStore`.

Это важный архитектурный refactor текущего behavior:

```text
distill → add lesson
```

на:

```text
distill → candidate → validate → add lesson
```

---

## Wave 4 — Skill evolution

Подключить:

```text
SkillCandidate
→ evidence
→ validation
→ auto-create
```

Затем:

```text
existing skill
→ candidate patch
→ version
→ evaluation
→ promote / rollback
```

На этом Wave ROX впервые получает настоящий autonomous procedural learning.

---

## Wave 5 — Outcome learning

Добавить:

```text
OutcomeStore
EffectivenessScorer
ExperimentStore
RollbackManager
```

Теперь система начинает реально отвечать:

> стало лучше или хуже?

---

## Wave 6 — Policy learning

Добавить:

```text
PolicyLearner
```

и учиться:

```text
model selection
skill selection
delegation
tool order
verification
planning strategy
```

Это уже self-improving orchestration.

---

## Wave 7 — Autonomous Learning

Только теперь:

```text
LearningWorker
```

может самостоятельно ночью/на idle:

```text
reflect
consolidate
curate
evaluate
promote
rollback
```

и pipeline замыкается.

---

# 46. Definition of Done

Функция **self-improvement** считается реально реализованной только когда можно пройти такой E2E-тест:

```text
1. Агент выполняет task.

2. Пользователь его исправляет.

3. ROX сохраняет structured observation.

4. Reflection создаёт hypothesis.

5. Повторная session подтверждает pattern.

6. Candidate получает evidence.

7. Candidate становится ACTIVE.

8. Следующие sessions используют новую память/skill.

9. ROX измеряет outcome.

10. Улучшение сохраняется в effectiveness metrics.

11. При регрессии ROX автоматически делает rollback.

12. Learning timeline показывает всю причинную цепочку.
```

Это должен быть **один интеграционный тест всего learning loop**, а не набор unit-тестов отдельных классов.

---

# 47. Конечное состояние репозитория

После всех волн структура должна выглядеть примерно так:

```text
packages/
├── server-core/
│   └── src/
│       ├── memory/
│       │   ├── MemoryService.ts
│       │   ├── LessonStore.ts
│       │   ├── EpisodicMemory.ts
│       │   ├── SkillPendingQueue.ts
│       │   │
│       │   └── learning/
│       │       ├── LearningService.ts
│       │       ├── LearningWorker.ts
│       │       ├── LearningQueue.ts
│       │       ├── ObservationStore.ts
│       │       ├── CandidateStore.ts
│       │       ├── EvidenceStore.ts
│       │       ├── OutcomeStore.ts
│       │       ├── MutationStore.ts
│       │       ├── ReflectionEngine.ts
│       │       ├── PatternDetector.ts
│       │       ├── CandidateValidator.ts
│       │       ├── EffectivenessScorer.ts
│       │       ├── ConsolidationEngine.ts
│       │       ├── SkillEvolutionEngine.ts
│       │       ├── PolicyLearner.ts
│       │       └── RollbackManager.ts
│       │
│       ├── sessions/
│       │   └── SessionManager.ts
│       │
│       └── handlers/rpc/
│           ├── memory.ts
│           ├── skills-pending.ts
│           └── learning.ts
│
└── shared/
    └── src/
        └── memory/
            ├── types.ts
            └── learning.ts
```

---

# 48. Самое важное архитектурное решение

Я бы зафиксировал в спецификации ROX одну норму:

> **LLM-generated learning output is always a hypothesis until validated by evidence.**

Тогда текущий `MemoryService` становится первым этапом, а не всем learning system:

```text
                         CURRENT ROX
                              │
                ┌─────────────▼─────────────┐
                │      MemoryService        │
                │ distill / recall / decay  │
                └─────────────┬─────────────┘
                              │
                       NEW LEARNING
                              │
                ┌─────────────▼─────────────┐
                │    ReflectionEngine       │
                └─────────────┬─────────────┘
                              │
                      candidate/hypothesis
                              │
                ┌─────────────▼─────────────┐
                │   Evidence + Validation   │
                └─────────────┬─────────────┘
                              │
                    promote / reject
                              │
                ┌─────────────▼─────────────┐
                │ Memory / Skill / Policy   │
                └─────────────┬─────────────┘
                              │
                         next agent
                              │
                ┌─────────────▼─────────────┐
                │      Task Outcome         │
                └─────────────┬─────────────┘
                              │
                       effectiveness
                              │
                              └──────► learning
```

Именно так я бы строил ROX.

При этом важная практическая деталь: **первые четыре волны не требуют новой БД и не требуют переписывать текущий memory runtime**. Их можно реализовать поверх текущих JSONL stores и lifecycle hooks, а SQLite добавить позднее как производную аналитическую projection.

**Следующий запрос:** «Преврати этот PRD в implementation program для `rox-one/rox-one`: перечисли конкретные tickets WP-001…WP-xxx, зависимости между ними, точные файлы каждого изменения, тесты и acceptance criteria для каждой волны».
</attachment> 

ultrathink orchestrate workflowz 


implement attached PRD