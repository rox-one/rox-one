---
type: C4 Component
title: Format
status: stable
groma:
  id: lark-format
  parent: messaging-gateway
  code:
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/lark/format.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/lark/card.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/lark/index.ts
description: Converts agent Markdown into Lark/Feishu rich-text post payloads.
---
