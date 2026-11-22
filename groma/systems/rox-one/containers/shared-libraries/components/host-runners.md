---
type: C4 Component
title: Host runners
status: stable
groma:
  id: host-runners
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/credentials/fabric/host-runners.ts
    - scanner: typescript
      file: packages/shared/src/credentials/fabric/materialization.ts
    - scanner: typescript
      file: packages/shared/src/credentials/fabric/ssh-agent-importer.ts
    - scanner: typescript
      file: packages/shared/src/credentials/fabric/infisical-provider.ts
    - scanner: typescript
      file: packages/shared/src/credentials/fabric/docker-helper-importer.ts
    - scanner: typescript
      file: packages/shared/src/credentials/fabric/local-file-provider.ts
    - scanner: typescript
      file: packages/shared/src/credentials/fabric/git-helper-importer.ts
    - scanner: typescript
      file: packages/shared/src/credentials/fabric/grant-store.ts
    - scanner: typescript
      file: packages/shared/src/credentials/fabric/delivery.ts
    - scanner: typescript
      file: packages/shared/src/credentials/fabric/keychain-importer.ts
    - scanner: typescript
      file: packages/shared/src/credentials/fabric/adc-importer.ts
    - scanner: typescript
      file: packages/shared/src/credentials/fabric/github-oauth-importer.ts
    - scanner: typescript
      file: packages/shared/src/credentials/fabric/http-header-delivery.ts
    - scanner: typescript
      file: packages/shared/src/credentials/fabric/broker.ts
    - scanner: typescript
      file: packages/shared/src/credentials/fabric/importers.ts
    - scanner: typescript
      file: packages/shared/src/credentials/fabric/aws-profile-importer.ts
    - scanner: typescript
      file: packages/shared/src/credentials/fabric/types.ts
description: Wraps host process I/O for git, docker, AWS, keychain and ssh-agent credential importers, keeping importers spawn-free.
---
