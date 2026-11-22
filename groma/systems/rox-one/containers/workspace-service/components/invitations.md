---
type: C4 Component
title: Invitations
status: stable
groma:
  id: invitations
  parent: workspace-service
  code:
    - scanner: typescript
      file: apps/workspace-service/src/modules/collaboration/invitations.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/collaboration/runtime.ts
      symbol: createDurableWorkspaceCollaboration
    - scanner: typescript
      file: apps/workspace-service/src/modules/collaboration/routes.ts
    - scanner: typescript
      file: apps/workspace-service/src/modules/collaboration/session-publication-registry.ts
      symbol: SqliteHostedSessionRegistry
description: Handles collaboration session invitations, membership and publication admission.
---
