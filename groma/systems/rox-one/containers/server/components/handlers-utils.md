---
type: C4 Component
title: Utils
status: stable
groma:
  id: handlers-utils
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/handlers/utils.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/browser-pane-manager-interface.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/window-manager-interface.ts
      symbol: IWindowManager
    - scanner: typescript
      file: packages/server-core/src/handlers/user-secrets-provision.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/oauth-flow-store-interface.ts
      symbol: IOAuthFlowStore
    - scanner: typescript
      file: packages/server-core/src/handlers/messaging-registry-interface.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/handler-deps.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/voice-overlay-host.ts
      symbol: NativeVoiceOverlayHost
    - scanner: typescript
      file: packages/server-core/src/handlers/session-manager-interface.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/index.ts
description: Provides handler helpers for workspace lookup, runtime context and safe filename sanitization.
---
