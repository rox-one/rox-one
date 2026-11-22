---
type: C4 Component
title: Image utils
status: stable
groma:
  id: image-utils
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/services/image-utils.ts
    - scanner: typescript
      file: packages/server-core/src/services/git-bash.ts
    - scanner: typescript
      file: packages/server-core/src/services/privileged-execution-broker.ts
    - scanner: typescript
      file: packages/server-core/src/services/index.ts
    - scanner: typescript
      file: packages/server-core/src/services/vcredist.ts
    - scanner: typescript
      file: packages/server-core/src/services/search.ts
  technology: sharp
description: Inspects and resizes uploaded image buffers through the injected processor.
---
