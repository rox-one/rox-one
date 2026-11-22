---
type: C4 Component
title: TurnPhaseBar
status: stable
groma:
  id: turnphasebar
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/agent-flow/TurnPhaseBar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/agent-flow/TurnPhaseBar.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/agent-flow/SessionBranchTree.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/agent-flow/SessionBranchTree.tsx
      symbol: SessionBranchTree
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/agent-flow/mid-stream-mode.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/agent-flow/branch-tree.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/agent-flow/turn-phase.ts
description: Shows the live agent turn phase and queue-or-steer selector above the composer.
---
