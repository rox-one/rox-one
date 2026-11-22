---
type: C4 Component
title: DiffIcons
status: stable
groma:
  id: difficons
  parent: ui-kit
  code:
    - scanner: react
      file: packages/ui/src/components/code-viewer/DiffIcons.tsx
    - scanner: typescript
      file: packages/ui/src/components/code-viewer/DiffIcons.tsx
    - scanner: react
      file: packages/ui/src/components/code-viewer/DiffViewerControls.tsx
    - scanner: typescript
      file: packages/ui/src/components/code-viewer/DiffViewerControls.tsx
    - scanner: react
      file: packages/ui/src/components/code-viewer/UnifiedDiffViewer.tsx
    - scanner: typescript
      file: packages/ui/src/components/code-viewer/UnifiedDiffViewer.tsx
    - scanner: react
      file: packages/ui/src/components/code-viewer/ShikiCodeViewer.tsx
    - scanner: typescript
      file: packages/ui/src/components/code-viewer/ShikiCodeViewer.tsx
    - scanner: react
      file: packages/ui/src/components/code-viewer/ShikiDiffViewer.tsx
    - scanner: typescript
      file: packages/ui/src/components/code-viewer/ShikiDiffViewer.tsx
    - scanner: typescript
      file: packages/ui/src/components/code-viewer/zedShikiThemeData.ts
    - scanner: typescript
      file: packages/ui/src/components/code-viewer/index.ts
    - scanner: typescript
      file: packages/ui/src/components/code-viewer/zedShikiThemes.ts
    - scanner: typescript
      file: packages/ui/src/components/code-viewer/registerShikiThemes.ts
      symbol: registerCraftShikiThemes
    - scanner: typescript
      file: packages/ui/src/components/code-viewer/diff-stats.ts
    - scanner: typescript
      file: packages/ui/src/components/code-viewer/language-map.ts
description: Supplies split and unified SVG glyphs for diff viewer controls.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/ui/src/components/code-viewer/DiffViewerControls.tsx](../../../../../../packages/ui/src/components/code-viewer/DiffViewerControls.tsx) | [packages/ui/src/components/overlay/MultiDiffPreviewOverlay.tsx](../../../../../../packages/ui/src/components/overlay/MultiDiffPreviewOverlay.tsx) | Invokes supplied callbacks: onBackgroundChange, onDiffStyleChange | react |
