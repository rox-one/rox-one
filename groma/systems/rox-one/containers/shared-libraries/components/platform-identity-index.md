---
type: C4 Component
title: Index
status: stable
groma:
  id: platform-identity-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/platform/identity/index.ts
    - scanner: typescript
      file: packages/core/src/platform/identity/revalidation.ts
    - scanner: typescript
      file: packages/core/src/platform/identity/provider-contract.ts
    - scanner: typescript
      file: packages/core/src/platform/identity/credential-types.ts
    - scanner: typescript
      file: packages/core/src/platform/identity/store.ts
    - scanner: typescript
      file: packages/core/src/platform/identity/import-session.ts
    - scanner: typescript
      file: packages/core/src/platform/identity/types.ts
    - scanner: typescript
      file: packages/core/src/platform/identity/workgraph.ts
    - scanner: typescript
      file: packages/core/src/platform/identity/import-service.ts
    - scanner: typescript
      file: packages/core/src/platform/identity/github-vertical.ts
    - scanner: typescript
      file: packages/core/src/platform/identity/grants.ts
    - scanner: typescript
      file: packages/core/src/platform/identity/attach-credential-ref.ts
    - scanner: typescript
      file: packages/core/src/platform/identity/p0-adapters.ts
    - scanner: typescript
      file: packages/core/src/platform/identity/broker.ts
    - scanner: typescript
      file: packages/core/src/platform/identity/os-discovery-host.ts
    - scanner: typescript
      file: packages/core/src/platform/identity/infisical-fabric-provider.ts
description: 'Re-exports the platform identity layer: profiles, workspace memberships, service connections and credential-reference registry types.'
---
