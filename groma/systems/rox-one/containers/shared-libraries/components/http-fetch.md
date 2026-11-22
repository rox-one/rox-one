---
type: C4 Component
title: Http fetch
status: stable
groma:
  id: http-fetch
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/platform/http-fetch.ts
    - scanner: typescript
      file: packages/core/src/platform/index.ts
    - scanner: typescript
      file: packages/core/src/platform/types.ts
      symbol: Disposable
    - scanner: typescript
      file: packages/core/src/platform/chrome.ts
    - scanner: typescript
      file: packages/core/src/platform/chrome-reference.ts
description: Declares injectable HTTP fetch and header types for dependency-light core packages and test doubles.
---
