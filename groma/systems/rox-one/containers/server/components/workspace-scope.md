---
type: C4 Component
title: Workspace scope
status: stable
groma:
  id: workspace-scope
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/security/workspace-scope.ts
description: Denies cross-workspace access using caller identity and writes safe audit events.
---
