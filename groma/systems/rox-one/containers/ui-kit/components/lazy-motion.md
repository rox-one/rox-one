---
type: C4 Component
title: Lazy motion
status: stable
groma:
  id: lazy-motion
  parent: ui-kit
  code:
    - scanner: react
      file: packages/ui/src/lib/lazy-motion.tsx
    - scanner: typescript
      file: packages/ui/src/lib/lazy-motion.tsx
    - scanner: typescript
      file: packages/ui/src/lib/glass-capability.ts
    - scanner: typescript
      file: packages/ui/src/lib/utils.ts
    - scanner: typescript
      file: packages/ui/src/lib/dismissible-layer-bridge.ts
    - scanner: typescript
      file: packages/ui/src/lib/tool-parsers.ts
    - scanner: typescript
      file: packages/ui/src/lib/open-external-url.ts
    - scanner: typescript
      file: packages/ui/src/lib/layout.ts
    - scanner: typescript
      file: packages/ui/src/lib/file-classification.ts
  technology: motion
description: Defers loading motion/react until animation is needed, keeping first paint light.
---
