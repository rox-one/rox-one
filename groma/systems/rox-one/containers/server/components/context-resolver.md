---
type: C4 Component
title: Context resolver
status: stable
groma:
  id: context-resolver
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/automations/context-resolver.ts
      symbol: resolveWorkspaceAutomationContext
description: Resolves automation context references to workspace tasks and projects.
---
