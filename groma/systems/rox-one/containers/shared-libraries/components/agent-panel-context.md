---
type: C4 Component
title: Context
status: stable
groma:
  id: agent-panel-context
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/agent-panel/context.ts
    - scanner: typescript
      file: packages/core/src/agent-panel/session.ts
    - scanner: typescript
      file: packages/core/src/agent-panel/index.ts
description: Defines what surface context the agent panel attaches to the next user message, with privacy and size caps.
---
