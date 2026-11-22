---
type: C4 Component
title: Grants
status: stable
groma:
  id: extension-host-grants
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/main/extension-host/grants.ts
      symbol: resolveExtensionGrantsFromPermissions
    - scanner: typescript
      file: apps/electron/src/main/extension-host/descriptors.ts
    - scanner: typescript
      file: apps/electron/src/main/extension-host/path-allowlist.ts
    - scanner: typescript
      file: apps/electron/src/main/extension-host/worker.ts
    - scanner: typescript
      file: apps/electron/src/main/extension-host/protocol.ts
    - scanner: typescript
      file: apps/electron/src/main/extension-host/startup.ts
    - scanner: typescript
      file: apps/electron/src/main/extension-host/capability-broker.ts
    - scanner: typescript
      file: apps/electron/src/main/extension-host/extension-url-allowlist.ts
description: Resolves effective extension grants from workspace permissions, subtracting revoked capabilities.
---
