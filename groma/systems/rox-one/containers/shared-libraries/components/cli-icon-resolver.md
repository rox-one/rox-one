---
type: C4 Component
title: Cli icon resolver
status: stable
groma:
  id: cli-icon-resolver
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/utils/cli-icon-resolver.ts
    - scanner: typescript
      file: packages/shared/src/utils/bounded-file.ts
    - scanner: typescript
      file: packages/shared/src/utils/index.ts
    - scanner: typescript
      file: packages/shared/src/utils/icon-encoder.ts
    - scanner: typescript
      file: packages/shared/src/utils/mask.ts
    - scanner: typescript
      file: packages/shared/src/utils/url-safety.ts
    - scanner: typescript
      file: packages/shared/src/utils/summarize.ts
      symbol: resetSummarizationClient
    - scanner: typescript
      file: packages/shared/src/utils/service-url.ts
      symbol: deriveServiceUrl
    - scanner: typescript
      file: packages/shared/src/utils/workspace-slug.ts
      symbol: extractWorkspaceSlugFromPath
    - scanner: typescript
      file: packages/shared/src/utils/large-response.ts
    - scanner: typescript
      file: packages/shared/src/utils/icon-constants.ts
    - scanner: typescript
      file: packages/shared/src/utils/logo.ts
    - scanner: typescript
      file: packages/shared/src/utils/redaction.ts
    - scanner: typescript
      file: packages/shared/src/utils/open-url.ts
      symbol: openUrl
    - scanner: typescript
      file: packages/shared/src/utils/bundle-files.ts
    - scanner: typescript
      file: packages/shared/src/utils/paths.ts
    - scanner: typescript
      file: packages/shared/src/utils/slug.ts
    - scanner: typescript
      file: packages/shared/src/utils/workspace.ts
    - scanner: typescript
      file: packages/shared/src/utils/perf.ts
    - scanner: typescript
      file: packages/shared/src/utils/sqlite-runtime.ts
    - scanner: typescript
      file: packages/shared/src/utils/icon.ts
    - scanner: typescript
      file: packages/shared/src/utils/files.ts
    - scanner: typescript
      file: packages/shared/src/utils/toolNames.ts
    - scanner: typescript
      file: packages/shared/src/utils/title-generator.ts
    - scanner: typescript
      file: packages/shared/src/utils/debug.ts
    - scanner: typescript
      file: packages/shared/src/utils/binary-detection.ts
description: Detects known CLI tools inside bash commands and resolves their display names and icons for turn cards.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/shared/src/utils/icon-encoder.ts](../../../../../../packages/shared/src/utils/icon-encoder.ts) | [packages/server-core/src/services/image-utils.ts](../../../../../../packages/server-core/src/services/image-utils.ts) | Invokes supplied callback: resize | typescript |
