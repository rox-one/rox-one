---
type: C4 Component
title: Index
status: stable
groma:
  id: wechat-index
  parent: messaging-gateway
  code:
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/index.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/format.ts
      symbol: stripMarkdownForWeChat
description: Adapts personal WeChat chats to the messaging platform interface via iLink.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/messaging-gateway/src/adapters/wechat/index.ts](../../../../../../packages/messaging-gateway/src/adapters/wechat/index.ts) | [packages/messaging-gateway/src/registry.ts](../../../../../../packages/messaging-gateway/src/registry.ts) | Invokes supplied callback: onEvent | typescript |
