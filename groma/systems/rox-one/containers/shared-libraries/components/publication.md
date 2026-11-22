---
type: C4 Component
title: Publication
status: stable
groma:
  id: publication
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/collaboration/publication.ts
    - scanner: typescript
      file: packages/shared/src/collaboration/durable-store.ts
      symbol: SqliteBroInviteStore
    - scanner: typescript
      file: packages/shared/src/collaboration/store.ts
    - scanner: typescript
      file: packages/shared/src/collaboration/omp-map.ts
    - scanner: typescript
      file: packages/shared/src/collaboration/index.ts
    - scanner: typescript
      file: packages/shared/src/collaboration/presence.ts
    - scanner: typescript
      file: packages/shared/src/collaboration/conflict.ts
    - scanner: typescript
      file: packages/shared/src/collaboration/invite.ts
    - scanner: typescript
      file: packages/shared/src/collaboration/session-publication.ts
description: Gates public publication behind a disabled trust boundary, exposing only local secret-redaction previews.
---
