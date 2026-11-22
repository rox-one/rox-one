---
type: C4 Component
title: Engine
status: stable
groma:
  id: config-engine
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/rovers-core/src/config/engine.ts
description: Reads and atomically writes the Rovers engine.json with an engine-owned cache root.
---
