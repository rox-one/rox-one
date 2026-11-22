---
type: C4 Component
title: Web fetch
status: stable
groma:
  id: web-fetch
  parent: agent-sidecars
  code:
    - scanner: typescript
      file: packages/pi-agent-server/src/tools/web-fetch.ts
      symbol: createWebFetchTool
description: Fetches and converts web pages to Markdown with SSRF guards.
---
