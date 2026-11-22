---
type: C4 Component
title: Blocked subprocess env
status: stable
groma:
  id: blocked-subprocess-env
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/env/blocked-subprocess-env.ts
description: Central blocklist of credentials and secret env vars that must never be inherited by child processes.
---
