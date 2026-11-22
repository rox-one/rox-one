---
type: C4 Component
title: Versioning
status: stable
groma:
  id: versioning
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/environment/versioning.ts
    - scanner: typescript
      file: packages/shared/src/environment/index.ts
    - scanner: typescript
      file: packages/shared/src/environment/types.ts
    - scanner: typescript
      file: packages/shared/src/environment/work-style-prompt.ts
      symbol: formatWorkStyleForPrompt
    - scanner: typescript
      file: packages/shared/src/environment/storage.ts
description: Computes pending environment questionnaire questions and applies skip, answer and completion transitions.
---
