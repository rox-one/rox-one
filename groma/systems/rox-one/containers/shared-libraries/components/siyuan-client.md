---
type: C4 Component
title: Client
status: stable
groma:
  id: siyuan-client
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/knowledge/providers/siyuan/client.ts
    - scanner: typescript
      file: packages/core/src/knowledge/providers/siyuan/index.ts
    - scanner: typescript
      file: packages/core/src/knowledge/providers/siyuan/adapter.ts
    - scanner: typescript
      file: packages/core/src/knowledge/providers/siyuan/deep-links.ts
    - scanner: typescript
      file: packages/core/src/knowledge/providers/siyuan/mutation-adapter.ts
  technology: SiYuan
description: Wraps the SiYuan kernel REST API with a read-only query surface and a narrow write whitelist.
---
