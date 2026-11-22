---
type: C4 Component
title: Soup document actions
status: stable
groma:
  id: soup-document-actions
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/rox2/soup-document-actions.ts
    - scanner: typescript
      file: packages/core/src/rox2/conation-api.ts
    - scanner: typescript
      file: packages/core/src/rox2/map-reduce.ts
    - scanner: typescript
      file: packages/core/src/rox2/notes-engine.ts
    - scanner: typescript
      file: packages/core/src/rox2/surface-context.ts
    - scanner: typescript
      file: packages/core/src/rox2/soup-native-actions.ts
    - scanner: typescript
      file: packages/core/src/rox2/project-membership.ts
    - scanner: typescript
      file: packages/core/src/rox2/rpc-native-actions.ts
    - scanner: typescript
      file: packages/core/src/rox2/platform-contract.ts
    - scanner: typescript
      file: packages/core/src/rox2/meeting-conation-shell.ts
    - scanner: typescript
      file: packages/core/src/rox2/index.ts
    - scanner: typescript
      file: packages/core/src/rox2/onboarding-first-result.ts
    - scanner: typescript
      file: packages/core/src/rox2/notes-repository.ts
description: Produces list, read and act results for GraphqlSoupDocument, distinguishing live native Notes from fixture and queued sources.
---
