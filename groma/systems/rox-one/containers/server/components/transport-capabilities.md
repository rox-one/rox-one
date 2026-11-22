---
type: C4 Component
title: Capabilities
status: stable
groma:
  id: transport-capabilities
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/transport/capabilities.ts
    - scanner: typescript
      file: packages/server-core/src/transport/device-auth.ts
    - scanner: typescript
      file: packages/server-core/src/transport/index.ts
    - scanner: typescript
      file: packages/server-core/src/transport/peer-trust.ts
    - scanner: typescript
      file: packages/server-core/src/transport/server.ts
    - scanner: typescript
      file: packages/server-core/src/transport/browser-capability.ts
    - scanner: typescript
      file: packages/server-core/src/transport/identity-credential.ts
      symbol: resolveRoxIdentityCredential
    - scanner: typescript
      file: packages/server-core/src/transport/push.ts
      symbol: pushTyped
    - scanner: typescript
      file: packages/server-core/src/transport/codec.ts
    - scanner: typescript
      file: packages/server-core/src/transport/types.ts
    - scanner: typescript
      file: packages/server-core/src/transport/client.ts
description: Defines client capability names and thin wrappers for server-to-client invocations.
---
