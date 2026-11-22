---
type: C4 Component
title: Sources
status: stable
groma:
  id: adapters-sources
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/extensions/adapters/sources.ts
    - scanner: typescript
      file: packages/shared/src/extensions/adapters/automations.ts
    - scanner: typescript
      file: packages/shared/src/extensions/adapters/index.ts
    - scanner: typescript
      file: packages/shared/src/extensions/adapters/marketplace.ts
    - scanner: typescript
      file: packages/shared/src/extensions/adapters/skills.ts
description: Projects loaded MCP, API and local sources into extension records with derived permissions and status.
---
