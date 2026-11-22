---
type: C4 Component
title: Parser
status: stable
groma:
  id: parser
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/browser-intel/src/hindsight/parser.ts
    - scanner: typescript
      file: packages/browser-intel/src/hindsight/bridge.ts
    - scanner: typescript
      file: packages/browser-intel/src/hindsight/runner.ts
    - scanner: typescript
      file: packages/browser-intel/src/hindsight/index.ts
  technology: SQLite
description: Reads Hindsight's timeline table into defensive visit and bookmark records for browser-intel.
---
