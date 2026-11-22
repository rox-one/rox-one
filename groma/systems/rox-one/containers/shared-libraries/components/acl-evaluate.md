---
type: C4 Component
title: Evaluate
status: stable
groma:
  id: acl-evaluate
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/acl/evaluate.ts
    - scanner: typescript
      file: packages/core/src/acl/memory-facts.ts
      symbol: MemoryAclFacts
    - scanner: typescript
      file: packages/core/src/acl/local-shim.ts
    - scanner: typescript
      file: packages/core/src/acl/topics.ts
    - scanner: typescript
      file: packages/core/src/acl/index.ts
    - scanner: typescript
      file: packages/core/src/acl/roles.ts
    - scanner: typescript
      file: packages/core/src/acl/actions.ts
description: Evaluates acl.can across explicit grants, contextual roles, inheritance, presets and secrecy for workspace resources.
---
