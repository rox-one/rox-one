---
type: C4 Component
title: Mail channels
status: stable
groma:
  id: mail-channels
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/meetings/conation/mail-channels.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/conation/notes-projects.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/conation/calendar-calls.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/conation/capabilities.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/conation/board-fund.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/conation/sync.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/conation/adapters.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/conation/native-shells.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/conation/files.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/conation/crm.ts
description: Models meeting mail and channel drafts with approval gating while live send stays blocked.
---
