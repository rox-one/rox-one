---
type: C4 Component
title: Runtime
status: stable
groma:
  id: skills-runtime
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/session-tools-core/src/skills/runtime.ts
    - scanner: typescript
      file: packages/session-tools-core/src/skills/scope.ts
description: Registration seam exposing the on-disk skill catalog to skills_search and skills_read session tools.
---
