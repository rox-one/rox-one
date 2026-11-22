---
type: C4 Component
title: Profile
status: stable
groma:
  id: workspace-work-profile
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/workspace-work/profile.ts
      symbol: captureAgentProfileSnapshot
    - scanner: typescript
      file: packages/server-core/src/workspace-work/service.ts
    - scanner: typescript
      file: packages/server-core/src/workspace-work/store.ts
      symbol: WorkspaceWorkStore
    - scanner: typescript
      file: packages/server-core/src/workspace-work/validation.ts
description: Captures an agent profile snapshot with validated sources and skills.
---
