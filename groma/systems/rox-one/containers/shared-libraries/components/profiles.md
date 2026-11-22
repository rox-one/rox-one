---
type: C4 Component
title: Profiles
status: stable
groma:
  id: profiles
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/voice/processing/profiles.ts
    - scanner: typescript
      file: packages/shared/src/voice/processing/run.ts
    - scanner: typescript
      file: packages/shared/src/voice/processing/language-policy.ts
    - scanner: typescript
      file: packages/shared/src/voice/processing/result-schema.ts
    - scanner: typescript
      file: packages/shared/src/voice/processing/compiler.ts
description: Declares voice prompt-improvement modules, their instructions and canonical ordering for transcript enhancement.
---
