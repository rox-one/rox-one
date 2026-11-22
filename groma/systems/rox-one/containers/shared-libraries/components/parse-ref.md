---
type: C4 Component
title: Parse ref
status: stable
groma:
  id: parse-ref
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/session-tools-core/src/knowledge/parse-ref.ts
    - scanner: typescript
      file: packages/session-tools-core/src/knowledge/runtime.ts
    - scanner: typescript
      file: packages/session-tools-core/src/knowledge/format.ts
description: Leniently parses knowledge references from mentions and SiYuan deep links into canonical refs.
---
