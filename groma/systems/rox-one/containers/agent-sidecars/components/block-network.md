---
type: C4 Component
title: Block network
status: stable
groma:
  id: block-network
  parent: agent-sidecars
  code:
    - scanner: typescript
      file: packages/pi-agent-server/src/test-fixtures/block-network.ts
description: Test fixture that blocks all outbound fetch during bundle smoke tests.
---
