---
type: C4 Component
title: Access policy registry
status: stable
groma:
  id: access-policy-registry
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/authority/access-policy-registry.ts
    - scanner: typescript
      file: packages/server-core/src/authority/local-maintenance.ts
    - scanner: typescript
      file: packages/server-core/src/authority/native-authority.ts
    - scanner: typescript
      file: packages/server-core/src/authority/os-private-path.ts
    - scanner: typescript
      file: packages/server-core/src/authority/native-journal.ts
    - scanner: typescript
      file: packages/server-core/src/authority/operator-role-policy.ts
description: Registers named access-policy plugins and fails closed when a declared plugin is missing.
---
