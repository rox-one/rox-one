---
type: C4 Component
title: Local issuer
status: stable
groma:
  id: local-issuer
  parent: workspace-service
  code:
    - scanner: typescript
      file: apps/workspace-service/src/auth/local-issuer.ts
    - scanner: typescript
      file: apps/workspace-service/src/auth/verified-actor.ts
    - scanner: typescript
      file: apps/workspace-service/src/auth/postgres-identity.ts
description: Issues short-lived Ed25519 local-bootstrap JWTs for loopback authentication.
---
