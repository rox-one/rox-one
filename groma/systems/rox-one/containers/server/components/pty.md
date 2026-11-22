---
type: C4 Component
title: Pty
status: stable
groma:
  id: pty
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/execution/terminal/pty.ts
    - scanner: typescript
      file: packages/server-core/src/execution/terminal/transport.ts
description: Placeholder pseudo-terminal factory that throws until the native crate lands.
---
