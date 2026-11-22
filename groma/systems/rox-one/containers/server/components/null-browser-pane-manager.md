---
type: C4 Component
title: Null browser pane manager
status: stable
groma:
  id: null-browser-pane-manager
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/runtime/null-browser-pane-manager.ts
      symbol: NullBrowserPaneManager
    - scanner: typescript
      file: packages/server-core/src/runtime/index.ts
    - scanner: typescript
      file: packages/server-core/src/runtime/platform-headless.ts
      symbol: createHeadlessPlatform
    - scanner: typescript
      file: packages/server-core/src/runtime/capability-probe.ts
    - scanner: typescript
      file: packages/server-core/src/runtime/platform.ts
description: Provides a headless null-object browser pane manager that refuses automation calls.
---
