---
type: C4 Component
title: Sbom cve
status: stable
groma:
  id: sbom-cve
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/devspace/security/sbom-cve.ts
    - scanner: typescript
      file: packages/server-core/src/devspace/security/index.ts
  technology: syft, OSV
description: Builds SBOM and OSV vulnerability artifacts under explicit per-repository network consent.
---
