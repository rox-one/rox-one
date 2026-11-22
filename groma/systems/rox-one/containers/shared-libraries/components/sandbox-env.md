---
type: C4 Component
title: Sandbox env
status: stable
groma:
  id: sandbox-env
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/session-tools-core/src/runtime/sandbox-env.ts
    - scanner: typescript
      file: packages/session-tools-core/src/runtime/host-bash-sandbox.ts
    - scanner: typescript
      file: packages/session-tools-core/src/runtime/host-bash-port.ts
    - scanner: typescript
      file: packages/session-tools-core/src/runtime/host-bash-process.ts
    - scanner: typescript
      file: packages/session-tools-core/src/runtime/path-security.ts
    - scanner: typescript
      file: packages/session-tools-core/src/runtime/network-isolation.ts
    - scanner: typescript
      file: packages/session-tools-core/src/runtime/resolve-script-runtime.ts
    - scanner: typescript
      file: packages/session-tools-core/src/runtime/host-bash-cwd.ts
      symbol: resolveHostBashCwd
    - scanner: typescript
      file: packages/session-tools-core/src/runtime/filesystem-isolation.ts
description: Builds sanitized subprocess environments for script tools, stripping credentials and redirecting caches into the session data directory.
---
