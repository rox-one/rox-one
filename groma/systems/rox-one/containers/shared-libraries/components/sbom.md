---
type: C4 Component
title: Sbom
status: stable
groma:
  id: sbom
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/code-intelligence/sbom.ts
    - scanner: typescript
      file: packages/shared/src/code-intelligence/provider.ts
    - scanner: typescript
      file: packages/shared/src/code-intelligence/explainer.ts
    - scanner: typescript
      file: packages/shared/src/code-intelligence/index.ts
    - scanner: typescript
      file: packages/shared/src/code-intelligence/repository-connection.ts
    - scanner: typescript
      file: packages/shared/src/code-intelligence/refs.ts
    - scanner: typescript
      file: packages/shared/src/code-intelligence/local-adapter.ts
    - scanner: typescript
      file: packages/shared/src/code-intelligence/types.ts
  technology: Syft
description: Optionally runs Syft to produce a JSON SBOM, skipping cleanly when the binary is absent.
---
