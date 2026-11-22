---
type: C4 Component
title: SkillEvolutionEngine
status: stable
groma:
  id: skillevolutionengine
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/memory/learning/SkillEvolutionEngine.ts
    - scanner: typescript
      file: packages/server-core/src/memory/learning/PolicyLearner.ts
    - scanner: typescript
      file: packages/server-core/src/memory/learning/CandidateStore.ts
      symbol: CandidateStore
    - scanner: typescript
      file: packages/server-core/src/memory/learning/PolicyStore.ts
      symbol: PolicyStore
    - scanner: typescript
      file: packages/server-core/src/memory/learning/LearningWorker.ts
    - scanner: typescript
      file: packages/server-core/src/memory/learning/LearningAudit.ts
    - scanner: typescript
      file: packages/server-core/src/memory/learning/LearningHost.ts
    - scanner: typescript
      file: packages/server-core/src/memory/learning/MutationStore.ts
      symbol: MutationStore
    - scanner: typescript
      file: packages/server-core/src/memory/learning/LearningQueue.ts
    - scanner: typescript
      file: packages/server-core/src/memory/learning/ExperimentStore.ts
      symbol: ExperimentStore
    - scanner: typescript
      file: packages/server-core/src/memory/learning/LearningStore.ts
      symbol: LearningStore
    - scanner: typescript
      file: packages/server-core/src/memory/learning/PromotionEngine.ts
    - scanner: typescript
      file: packages/server-core/src/memory/learning/CandidateValidator.ts
    - scanner: typescript
      file: packages/server-core/src/memory/learning/RollbackManager.ts
    - scanner: typescript
      file: packages/server-core/src/memory/learning/ConsolidationEngine.ts
    - scanner: typescript
      file: packages/server-core/src/memory/learning/LearningService.ts
    - scanner: typescript
      file: packages/server-core/src/memory/learning/EvidenceStore.ts
      symbol: EvidenceStore
    - scanner: typescript
      file: packages/server-core/src/memory/learning/EffectivenessScorer.ts
    - scanner: typescript
      file: packages/server-core/src/memory/learning/ObservationStore.ts
      symbol: ObservationStore
    - scanner: typescript
      file: packages/server-core/src/memory/learning/PatternDetector.ts
      symbol: detectPatterns
    - scanner: typescript
      file: packages/server-core/src/memory/learning/ReflectionEngine.ts
    - scanner: typescript
      file: packages/server-core/src/memory/learning/learning-types.ts
    - scanner: typescript
      file: packages/server-core/src/memory/learning/GarbageCollector.ts
    - scanner: typescript
      file: packages/server-core/src/memory/learning/OutcomeStore.ts
      symbol: OutcomeStore
description: Computes deterministic keep/improve/archive verdicts and patch drafts from skill usage and task outcomes.
---
