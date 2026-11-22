---
type: C4 Component
title: A2ui
status: stable
groma:
  id: a2ui
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/widgets/a2ui.ts
    - scanner: typescript
      file: packages/shared/src/widgets/wrap.ts
    - scanner: typescript
      file: packages/shared/src/widgets/types.ts
  technology: A2UI
description: Validates A2UI widget-stream JSONL messages for single-version envelopes and rejects unknown keys.
---
