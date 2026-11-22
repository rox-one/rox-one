---
type: C4 Component
title: Index
status: stable
groma:
  id: skills-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/skills/index.ts
    - scanner: typescript
      file: packages/shared/src/skills/bundled-sync.worker.ts
    - scanner: typescript
      file: packages/shared/src/skills/bundled-background.ts
    - scanner: typescript
      file: packages/shared/src/skills/managed.ts
    - scanner: typescript
      file: packages/shared/src/skills/skill-index-worker.ts
      symbol: SkillScanRow
    - scanner: typescript
      file: packages/shared/src/skills/bundled-core.ts
    - scanner: typescript
      file: packages/shared/src/skills/eligibility.ts
    - scanner: typescript
      file: packages/shared/src/skills/types.ts
    - scanner: typescript
      file: packages/shared/src/skills/prompt.ts
    - scanner: typescript
      file: packages/shared/src/skills/storage.ts
    - scanner: typescript
      file: packages/shared/src/skills/skill-index.ts
    - scanner: typescript
      file: packages/shared/src/skills/read-instructions.ts
    - scanner: typescript
      file: packages/shared/src/skills/skill-head.ts
    - scanner: typescript
      file: packages/shared/src/skills/bundled-fingerprint.ts
    - scanner: typescript
      file: packages/shared/src/skills/omp-discovery.ts
    - scanner: typescript
      file: packages/shared/src/skills/bundled.ts
description: Re-exports workspace skill loading, storage, OMP discovery, bundled-pack sync and fingerprint helpers.
---
