---
type: C4 Component
title: Service lifecycle
status: stable
groma:
  id: service-lifecycle
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/service-lifecycle.ts
    - scanner: typescript
      file: packages/shared/src/index.ts
    - scanner: typescript
      file: packages/shared/src/unified-network-interceptor.ts
    - scanner: typescript
      file: packages/shared/src/interceptor-request-utils.ts
      symbol: resolveRequestContext
    - scanner: typescript
      file: packages/shared/src/test-preload-pdfjs-url.ts
    - scanner: typescript
      file: packages/shared/src/interceptor-common.ts
    - scanner: typescript
      file: packages/shared/src/toolchain-runtime.ts
    - scanner: typescript
      file: packages/shared/src/branding.ts
    - scanner: typescript
      file: packages/shared/src/feature-flags.ts
description: Defines OS service states, doctor diagnostics and tray status types shared by Electron main and renderer.
---
