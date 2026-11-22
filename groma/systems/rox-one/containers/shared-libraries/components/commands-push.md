---
type: C4 Component
title: Push
status: stable
groma:
  id: commands-push
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/commands/push.ts
      symbol: CommandBusPushEvent
    - scanner: typescript
      file: packages/shared/src/commands/schemas.ts
    - scanner: typescript
      file: packages/shared/src/commands/index.ts
description: 'Defines the payload union pushed on the commands:event channel: realtime frames, receipts and outbox status.'
---
