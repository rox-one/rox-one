---
type: C4 Component
title: Meeting followup handler
status: stable
groma:
  id: meeting-followup-handler
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/automations/handlers/meeting-followup-handler.ts
    - scanner: typescript
      file: packages/shared/src/automations/handlers/prompt-handler.ts
      symbol: PromptHandler
    - scanner: typescript
      file: packages/shared/src/automations/handlers/event-log-handler.ts
      symbol: EventLogHandler
    - scanner: typescript
      file: packages/shared/src/automations/handlers/script-handler.ts
    - scanner: typescript
      file: packages/shared/src/automations/handlers/types.ts
    - scanner: typescript
      file: packages/shared/src/automations/handlers/webhook-handler.ts
    - scanner: typescript
      file: packages/shared/src/automations/handlers/knowledge-handler.ts
    - scanner: typescript
      file: packages/shared/src/automations/handlers/index.ts
description: Dispatches meeting.followup automation actions on scheduler ticks and records verified follow-up results.
---
