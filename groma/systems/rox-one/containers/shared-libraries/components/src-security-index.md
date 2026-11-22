---
type: C4 Component
title: Index
status: stable
groma:
  id: src-security-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/security/index.ts
    - scanner: typescript
      file: packages/shared/src/security/release-assurance.ts
    - scanner: typescript
      file: packages/shared/src/security/secret-scan.ts
    - scanner: typescript
      file: packages/shared/src/security/credential-ref-policy.ts
description: Barrel re-exporting secret scanning, credential-reference policy and release-assurance kill-switch helpers.
---
