---
type: C4 Component
title: Provider
status: stable
groma:
  id: knowledge-provider
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/knowledge/provider.ts
    - scanner: typescript
      file: packages/core/src/knowledge/errors.ts
    - scanner: typescript
      file: packages/core/src/knowledge/context.ts
    - scanner: typescript
      file: packages/core/src/knowledge/capabilities.ts
      symbol: KnowledgeCapabilities
    - scanner: typescript
      file: packages/core/src/knowledge/index.ts
    - scanner: typescript
      file: packages/core/src/knowledge/publications.ts
    - scanner: typescript
      file: packages/core/src/knowledge/refs.ts
    - scanner: typescript
      file: packages/core/src/knowledge/mutations.ts
    - scanner: typescript
      file: packages/core/src/knowledge/work-envelope.ts
description: Defines the knowledge provider contract (search, get, context, mutations) and registry used by SiYuan-backed knowledge.
---
