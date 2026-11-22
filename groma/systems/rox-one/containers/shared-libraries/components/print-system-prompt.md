---
type: C4 Component
title: Print system prompt
status: stable
groma:
  id: print-system-prompt
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/prompts/print-system-prompt.ts
    - scanner: typescript
      file: packages/shared/src/prompts/index.ts
    - scanner: typescript
      file: packages/shared/src/prompts/system.ts
    - scanner: typescript
      file: packages/shared/src/prompts/mcp-guidance.ts
      symbol: MCP_USAGE_GUIDANCE
description: Debug CLI script printing the assembled ROX system prompt and dynamic context sections with annotations.
---
