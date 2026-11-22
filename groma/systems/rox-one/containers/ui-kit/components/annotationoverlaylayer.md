---
type: C4 Component
title: AnnotationOverlayLayer
status: stable
groma:
  id: annotationoverlaylayer
  parent: ui-kit
  code:
    - scanner: react
      file: packages/ui/src/components/annotations/AnnotationOverlayLayer.tsx
    - scanner: typescript
      file: packages/ui/src/components/annotations/AnnotationOverlayLayer.tsx
    - scanner: react
      file: packages/ui/src/components/annotations/AnnotationIslandMenu.tsx
    - scanner: typescript
      file: packages/ui/src/components/annotations/AnnotationIslandMenu.tsx
    - scanner: typescript
      file: packages/ui/src/components/annotations/annotation-host-config.ts
    - scanner: typescript
      file: packages/ui/src/components/annotations/island-motion.ts
    - scanner: typescript
      file: packages/ui/src/components/annotations/use-annotation-interaction-controller.ts
    - scanner: typescript
      file: packages/ui/src/components/annotations/use-annotation-island-presentation.ts
    - scanner: typescript
      file: packages/ui/src/components/annotations/interaction-selectors.ts
    - scanner: typescript
      file: packages/ui/src/components/annotations/use-annotation-cancel-restore.ts
    - scanner: typescript
      file: packages/ui/src/components/annotations/annotation-style-tokens.ts
    - scanner: typescript
      file: packages/ui/src/components/annotations/annotation-overlay-geometry.ts
    - scanner: typescript
      file: packages/ui/src/components/annotations/use-annotation-island-events.ts
    - scanner: typescript
      file: packages/ui/src/components/annotations/selection-restore.ts
    - scanner: typescript
      file: packages/ui/src/components/annotations/follow-up-state.ts
    - scanner: typescript
      file: packages/ui/src/components/annotations/interaction-policy.ts
    - scanner: typescript
      file: packages/ui/src/components/annotations/block-markers.ts
    - scanner: typescript
      file: packages/ui/src/components/annotations/island-dismiss-policy.ts
    - scanner: typescript
      file: packages/ui/src/components/annotations/interaction-state-machine.ts
    - scanner: typescript
      file: packages/ui/src/components/annotations/annotation-core.ts
description: Draws annotation rectangles and chips over the annotated document surface.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/ui/src/components/annotations/AnnotationOverlayLayer.tsx](../../../../../../packages/ui/src/components/annotations/AnnotationOverlayLayer.tsx) | [packages/ui/src/components/chat/TurnCard.tsx](../../../../../../packages/ui/src/components/chat/TurnCard.tsx) | Invokes supplied callbacks: getTooltipText, onChipOpen | react |
| [packages/ui/src/components/annotations/AnnotationOverlayLayer.tsx](../../../../../../packages/ui/src/components/annotations/AnnotationOverlayLayer.tsx) | [packages/ui/src/components/overlay/AnnotatableMarkdownDocument.tsx](../../../../../../packages/ui/src/components/overlay/AnnotatableMarkdownDocument.tsx) | Invokes supplied callbacks: getTooltipText, onChipOpen | react |
