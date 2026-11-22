---
type: C4 Component
title: Store
status: stable
groma:
  id: rox-tg-linkd-src-store
  parent: background-daemons
  code:
    - scanner: typescript
      file: services/rox-tg-linkd/src/store.ts
    - scanner: typescript
      file: services/rox-tg-linkd/src/log.ts
    - scanner: typescript
      file: services/rox-tg-linkd/src/index.ts
    - scanner: typescript
      file: services/rox-tg-linkd/src/server.ts
    - scanner: typescript
      file: services/rox-tg-linkd/src/config.ts
    - scanner: typescript
      file: services/rox-tg-linkd/src/link.ts
    - scanner: typescript
      file: services/rox-tg-linkd/src/telegram.ts
description: Stores pending Telegram link and registration state durably in SQLite.
---
