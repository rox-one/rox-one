---
type: C4 Component
title: Index
status: stable
groma:
  id: claude-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/agent/backend/claude/index.ts
    - scanner: typescript
      file: packages/shared/src/agent/backend/claude/task-notification.ts
    - scanner: typescript
      file: packages/shared/src/agent/backend/claude/persistent-input.ts
    - scanner: typescript
      file: packages/shared/src/agent/backend/claude/event-adapter.ts
description: Re-exports the Claude agent class and its SDK-message event adapter.
---
