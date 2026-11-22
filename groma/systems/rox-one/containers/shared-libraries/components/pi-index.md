---
type: C4 Component
title: Index
status: stable
groma:
  id: pi-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/agent/backend/pi/index.ts
    - scanner: typescript
      file: packages/shared/src/agent/backend/pi/event-adapter.ts
      symbol: PiEventAdapter
    - scanner: typescript
      file: packages/shared/src/agent/backend/pi/constants.ts
    - scanner: typescript
      file: packages/shared/src/agent/backend/pi/session-tool-defs.ts
description: Re-exports the Pi agent subprocess client, its event adapter and tool and thinking constants.
---
