---
type: C4 Component
title: Relay
status: stable
groma:
  id: relay
  parent: workspace-service
  code:
    - scanner: typescript
      file: apps/workspace-service/src/modules/events/relay.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/events/valkey.ts
description: Relays committed domain events from the outbox to realtime and Valkey sinks.
---
