---
type: C4 Component
title: Run
status: stable
groma:
  id: enrichment-run
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/voice/enrichment/run.ts
    - scanner: typescript
      file: packages/shared/src/voice/enrichment/query-plan.ts
    - scanner: typescript
      file: packages/shared/src/voice/enrichment/types.ts
    - scanner: typescript
      file: packages/shared/src/voice/enrichment/source-policy.ts
description: Runs bounded parallel web-search enrichment over a transcript, deduplicating and filtering sources under a deadline.
---
