---
type: C4 Component
title: Synthesis
status: stable
groma:
  id: insights-synthesis
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/browser-intel/src/insights/synthesis.ts
    - scanner: typescript
      file: packages/browser-intel/src/insights/cognitiveProfile.ts
    - scanner: typescript
      file: packages/browser-intel/src/insights/aggregate.ts
    - scanner: typescript
      file: packages/browser-intel/src/insights/index.ts
description: Synthesizes browser-history profile slots with an injected model, falling back to deterministic candidates when offline.
---
