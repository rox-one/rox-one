---
type: C4 Component
title: Client
status: stable
groma:
  id: soup-client
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/conation/soup/client.ts
    - scanner: typescript
      file: packages/core/src/conation/soup/queries.ts
    - scanner: typescript
      file: packages/core/src/conation/soup/types.ts
    - scanner: typescript
      file: packages/core/src/conation/soup/index.ts
  technology: GraphQL
description: Read-only GraphQL client for the Conation Soup API, querying a user's soup page and grouped items.
---
