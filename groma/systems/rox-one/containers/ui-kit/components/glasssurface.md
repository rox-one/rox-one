---
type: C4 Component
title: GlassSurface
status: stable
groma:
  id: glasssurface
  parent: ui-kit
  code:
    - scanner: react
      file: packages/ui/src/components/glass/GlassSurface.tsx
    - scanner: typescript
      file: packages/ui/src/components/glass/GlassSurface.tsx
    - scanner: typescript
      file: packages/ui/src/components/glass/use-glass-motion.ts
    - scanner: typescript
      file: packages/ui/src/components/glass/index.ts
    - scanner: typescript
      file: packages/ui/src/components/glass/install-glass-skin.ts
    - scanner: typescript
      file: packages/ui/src/components/glass/edge-map.ts
      symbol: EDGE_MAP
  technology: SVG filter
description: Wraps surfaces in the glass styling layer with optional edge refraction.
---
