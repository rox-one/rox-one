---
type: C4 Component
title: Client
status: stable
groma:
  id: gamification-client
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/gamification/client.ts
    - scanner: typescript
      file: packages/shared/src/gamification/levels.ts
    - scanner: typescript
      file: packages/shared/src/gamification/index.ts
    - scanner: typescript
      file: packages/shared/src/gamification/storage.ts
    - scanner: typescript
      file: packages/shared/src/gamification/activity.ts
    - scanner: typescript
      file: packages/shared/src/gamification/quests.ts
description: Re-exports browser-safe gamification level, quest and activity rules; persistence belongs to the RPC host.
---
