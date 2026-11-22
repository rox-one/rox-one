---
type: C4 Component
title: Voice clipboard
status: stable
groma:
  id: voice-clipboard
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/main/handlers/voice-clipboard.ts
    - scanner: typescript
      file: apps/electron/src/main/handlers/github-token-resolver.ts
    - scanner: typescript
      file: apps/electron/src/main/handlers/system.ts
    - scanner: typescript
      file: apps/electron/src/main/handlers/handler-deps.ts
      symbol: HandlerDeps
    - scanner: typescript
      file: apps/electron/src/main/handlers/cookbooks.ts
    - scanner: typescript
      file: apps/electron/src/main/handlers/index.ts
    - scanner: typescript
      file: apps/electron/src/main/handlers/browser.ts
    - scanner: typescript
      file: apps/electron/src/main/handlers/workspace.ts
    - scanner: typescript
      file: apps/electron/src/main/handlers/zed-themes.ts
    - scanner: typescript
      file: apps/electron/src/main/handlers/extension-surface.ts
    - scanner: typescript
      file: apps/electron/src/main/handlers/settings.ts
    - scanner: typescript
      file: apps/electron/src/main/handlers/native-integration.ts
    - scanner: typescript
      file: apps/electron/src/main/handlers/browser-intel.ts
    - scanner: typescript
      file: apps/electron/src/main/handlers/extension-host.ts
    - scanner: typescript
      file: apps/electron/src/main/handlers/workgraph.ts
    - scanner: typescript
      file: apps/electron/src/main/handlers/clipboard-history.ts
    - scanner: typescript
      file: apps/electron/src/main/handlers/siyuan.ts
description: RPC handler copying a bounded voice transcript to the local clipboard for the owning window.
---
