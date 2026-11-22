---
type: C4 Component
title: Format
status: stable
groma:
  id: discord-format
  parent: messaging-gateway
  code:
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/discord/format.ts
      symbol: formatForDiscord
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/discord/index.ts
description: Adapts agent Markdown for Discord by downgrading ATX headings to bold.
---
