---
type: C4 Component
title: Bootstrap
status: stable
groma:
  id: src-bootstrap
  parent: messaging-gateway
  code:
    - scanner: typescript
      file: packages/messaging-gateway/src/bootstrap.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/registry.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/config-store.ts
      symbol: ConfigStore
    - scanner: typescript
      file: packages/messaging-gateway/src/pending-senders.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/binding-store.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/router.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/pairing.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/gateway.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/access-control.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/types.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/plan-tokens.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/capabilities.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/event-fanout.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/index.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/topic-registry.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/commands.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/renderer.ts
description: Wires the messaging gateway registry and event fan-out shared by Electron and headless hosts.
---

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/messaging-gateway/src/index.ts](../../../../../../packages/messaging-gateway/src/index.ts) | [telegram](../../../../../externals/telegram.md) | Relays messages | Bot API |
| [packages/messaging-gateway/src/index.ts](../../../../../../packages/messaging-gateway/src/index.ts) | [whatsapp](../../../../../externals/whatsapp.md) | Relays messages | Baileys |
| [packages/messaging-gateway/src/index.ts](../../../../../../packages/messaging-gateway/src/index.ts) | [discord](../../../../../externals/discord.md) | Relays messages | discord.js |
| [packages/messaging-gateway/src/index.ts](../../../../../../packages/messaging-gateway/src/index.ts) | [lark-feishu](../../../../../externals/lark-feishu.md) | Relays messages | HTTPS API |
| [packages/messaging-gateway/src/index.ts](../../../../../../packages/messaging-gateway/src/index.ts) | [wechat](../../../../../externals/wechat.md) | Relays messages | HTTPS API |
| [packages/messaging-gateway/src/bootstrap.ts](../../../../../../packages/messaging-gateway/src/bootstrap.ts) | [packages/shared/src/protocol/index.ts](../../../../../../packages/shared/src/protocol/index.ts) | Uses shared protocol | TypeScript imports |
| [packages/messaging-gateway/src/bootstrap.ts](../../../../../../packages/messaging-gateway/src/bootstrap.ts) | [packages/server-core/src/handlers/index.ts](../../../../../../packages/server-core/src/handlers/index.ts) | Uses handler types | TypeScript types |
