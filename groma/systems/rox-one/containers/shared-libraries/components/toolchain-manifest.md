---
type: C4 Component
title: Manifest
status: stable
groma:
  id: toolchain-manifest
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/toolchain/manifest.ts
    - scanner: typescript
      file: packages/shared/src/toolchain/spawn-readiness.ts
    - scanner: typescript
      file: packages/shared/src/toolchain/git-locks.ts
    - scanner: typescript
      file: packages/shared/src/toolchain/npm-pins.ts
    - scanner: typescript
      file: packages/shared/src/toolchain/exec.ts
    - scanner: typescript
      file: packages/shared/src/toolchain/windows-git-bash-pin.ts
      symbol: WINDOWS_GIT_BASH_PIN
    - scanner: typescript
      file: packages/shared/src/toolchain/manifest-data.ts
    - scanner: typescript
      file: packages/shared/src/toolchain/pip-locks.ts
      symbol: getPipRequirements
    - scanner: typescript
      file: packages/shared/src/toolchain/resolver.ts
    - scanner: typescript
      file: packages/shared/src/toolchain/downloader.ts
    - scanner: typescript
      file: packages/shared/src/toolchain/installer.ts
    - scanner: typescript
      file: packages/shared/src/toolchain/manager.ts
    - scanner: typescript
      file: packages/shared/src/toolchain/npm-locks.ts
      symbol: getNpmLock
    - scanner: typescript
      file: packages/shared/src/toolchain/types.ts
    - scanner: typescript
      file: packages/shared/src/toolchain/craft-native.ts
    - scanner: typescript
      file: packages/shared/src/toolchain/openclaw.ts
    - scanner: typescript
      file: packages/shared/src/toolchain/windows-bootstrap.ts
    - scanner: typescript
      file: packages/shared/src/toolchain/index.ts
    - scanner: typescript
      file: packages/shared/src/toolchain/status.ts
description: Declares pinned toolchain versions, platform support and config-directory paths used to install and verify external tools.
---
