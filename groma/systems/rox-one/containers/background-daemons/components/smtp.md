---
type: C4 Component
title: Smtp
status: stable
groma:
  id: smtp
  parent: background-daemons
  code:
    - scanner: typescript
      file: services/rox-maild/src/smtp.ts
    - scanner: typescript
      file: services/rox-maild/src/log.ts
    - scanner: typescript
      file: services/rox-maild/src/provision.ts
    - scanner: typescript
      file: services/rox-maild/src/config.ts
    - scanner: typescript
      file: services/rox-maild/src/signature.ts
    - scanner: typescript
      file: services/rox-maild/src/http.ts
    - scanner: typescript
      file: services/rox-maild/src/server.ts
    - scanner: typescript
      file: services/rox-maild/src/index.ts
    - scanner: typescript
      file: services/rox-maild/src/idempotency.ts
      symbol: IdempotencyCache
    - scanner: typescript
      file: services/rox-maild/src/health.ts
    - scanner: typescript
      file: services/rox-maild/src/inbound.ts
description: Sends raw mail to a local Stalwart inbound listener over SMTP.
---

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [services/rox-maild/src/index.ts](../../../../../../services/rox-maild/src/index.ts) | [stalwart](../../../../../externals/stalwart.md) | Relays inbound mail | SMTP |
| [services/rox-maild/src/provision.ts](../../../../../../services/rox-maild/src/provision.ts) | [packages/shared/src/mail/index.ts](../../../../../../packages/shared/src/mail/index.ts) | Uses shared mail types | TypeScript imports |
