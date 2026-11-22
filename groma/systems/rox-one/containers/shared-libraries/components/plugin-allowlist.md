---
type: C4 Component
title: Plugin allowlist
status: stable
groma:
  id: plugin-allowlist
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/knowledge/plugin-allowlist.ts
    - scanner: typescript
      file: packages/shared/src/knowledge/provider-gate.ts
    - scanner: typescript
      file: packages/shared/src/knowledge/knowledge-map-types.ts
    - scanner: typescript
      file: packages/shared/src/knowledge/siyuan-binary.ts
    - scanner: typescript
      file: packages/shared/src/knowledge/oem-pin.ts
    - scanner: typescript
      file: packages/shared/src/knowledge/vault-insights.ts
description: Filters marketplace packages against an OEM allowlist; an empty list disables all plugin installs.
---
