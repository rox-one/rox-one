---
type: C4 Component
title: Index
status: stable
groma:
  id: acquisition-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/browser-intel/src/acquisition/index.ts
    - scanner: typescript
      file: packages/browser-intel/src/acquisition/profileScanner.ts
    - scanner: typescript
      file: packages/browser-intel/src/acquisition/browserDetector.ts
    - scanner: typescript
      file: packages/browser-intel/src/acquisition/shadowCopy.ts
description: Exports browser detection, profile scanning and shadow-copy staging entry points for browser-intel acquisition.
---
