---
type: C4 Component
title: Path validation
status: stable
groma:
  id: path-validation
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/utils/path-validation.ts
description: Validates that paths are absolute and platform-appropriate without touching the filesystem.
---
