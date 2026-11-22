---
type: C4 Component
title: Types
status: stable
groma:
  id: cloud-runner-src-types
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/cloud-runner/src/types.ts
    - scanner: typescript
      file: packages/cloud-runner/src/grok-bot-license.ts
    - scanner: typescript
      file: packages/cloud-runner/src/native-provider.ts
    - scanner: typescript
      file: packages/cloud-runner/src/conformance.ts
    - scanner: typescript
      file: packages/cloud-runner/src/modal-provider.ts
      symbol: ModalProvider
    - scanner: typescript
      file: packages/cloud-runner/src/index.ts
    - scanner: typescript
      file: packages/cloud-runner/src/local-provider.ts
    - scanner: typescript
      file: packages/cloud-runner/src/daytona-provider.ts
    - scanner: typescript
      file: packages/cloud-runner/src/public-registry.ts
    - scanner: typescript
      file: packages/cloud-runner/src/daytona-sandbox.ts
    - scanner: typescript
      file: packages/cloud-runner/src/daytona-client.ts
    - scanner: typescript
      file: packages/cloud-runner/src/cloudflare-provider.ts
    - scanner: typescript
      file: packages/cloud-runner/src/research-pack.ts
description: Defines the CloudRunProvider contract and run, subtask and limit types shared by Daytona, subprocess and sidecar providers.
---
