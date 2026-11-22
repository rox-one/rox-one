---
type: C4 Component
title: Session activity tracker
status: stable
groma:
  id: session-activity-tracker
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/collaboration/session-activity-tracker.ts
    - scanner: typescript
      file: packages/server-core/src/collaboration/sync-service.ts
    - scanner: typescript
      file: packages/server-core/src/collaboration/remote-bro-invite-client.ts
    - scanner: typescript
      file: packages/server-core/src/collaboration/bro-invite-service.ts
    - scanner: typescript
      file: packages/server-core/src/collaboration/session-suggestions.ts
    - scanner: typescript
      file: packages/server-core/src/collaboration/session-publication-bridge.ts
      symbol: projectSessionForCollaboration
description: Tracks ephemeral session typing indicators and viewer presence with TTL expiry.
---
