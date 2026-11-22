---
type: C4 Component
title: Manifest schema
status: stable
groma:
  id: manifest-schema
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/voice/models/manifest-schema.ts
    - scanner: typescript
      file: packages/shared/src/voice/models/compatibility.ts
    - scanner: typescript
      file: packages/shared/src/voice/models/catalog.ts
      symbol: catalogTemplate
    - scanner: typescript
      file: packages/shared/src/voice/models/download.ts
description: 'Validates signed local ASR model manifests: family, files, hashes, signature and streaming capabilities.'
---
