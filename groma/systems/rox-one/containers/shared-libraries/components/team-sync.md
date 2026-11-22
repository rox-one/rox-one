---
type: C4 Component
title: Sync
status: stable
groma:
  id: team-sync
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/team/sync.ts
    - scanner: typescript
      file: packages/shared/src/team/state.ts
    - scanner: typescript
      file: packages/shared/src/team/flags.ts
    - scanner: typescript
      file: packages/shared/src/team/mentions.ts
    - scanner: typescript
      file: packages/shared/src/team/index.ts
    - scanner: typescript
      file: packages/shared/src/team/types.ts
description: Adapts local team state to an organization server; currently local-only, reporting that a server is required.
---
