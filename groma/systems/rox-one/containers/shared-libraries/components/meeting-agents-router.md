---
type: C4 Component
title: Router
status: stable
groma:
  id: meeting-agents-router
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/meeting-agents/router.ts
    - scanner: typescript
      file: packages/shared/src/meeting-agents/planning.ts
    - scanner: typescript
      file: packages/shared/src/meeting-agents/recipes.ts
    - scanner: typescript
      file: packages/shared/src/meeting-agents/bootstrap.ts
    - scanner: typescript
      file: packages/shared/src/meeting-agents/extraction.ts
    - scanner: typescript
      file: packages/shared/src/meeting-agents/prompts.ts
    - scanner: typescript
      file: packages/shared/src/meeting-agents/policies.ts
    - scanner: typescript
      file: packages/shared/src/meeting-agents/index.ts
    - scanner: typescript
      file: packages/shared/src/meeting-agents/summaries.ts
    - scanner: typescript
      file: packages/shared/src/meeting-agents/catalog.ts
    - scanner: typescript
      file: packages/shared/src/meeting-agents/client-capabilities.ts
    - scanner: typescript
      file: packages/shared/src/meeting-agents/knowledge.ts
    - scanner: typescript
      file: packages/shared/src/meeting-agents/assist.ts
    - scanner: typescript
      file: packages/shared/src/meeting-agents/browser.ts
    - scanner: typescript
      file: packages/shared/src/meeting-agents/artifacts.ts
description: Routes meeting events to built-in meeting-agent role jobs, enforcing concurrency, grant and debounce limits.
---
