---
type: C4 Component
title: ActionButtonBlock
status: stable
groma:
  id: actionbuttonblock
  parent: ui-kit
  code:
    - scanner: react
      file: packages/ui/src/components/markdown/extensions/ActionButtonBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/ActionButtonBlock.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/extensions/TiptapImageBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/TiptapImageBlock.tsx
      symbol: TiptapImageBlock
    - scanner: react
      file: packages/ui/src/components/markdown/extensions/TabsBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/TabsBlock.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/extensions/LatexBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/LatexBlock.tsx
      symbol: LatexBlock
    - scanner: react
      file: packages/ui/src/components/markdown/extensions/ColumnsBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/ColumnsBlock.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/extensions/MermaidBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/MermaidBlock.tsx
      symbol: MermaidBlock
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/animated-task-item.tokens.ts
      symbol: ANIMATED_TASK_ITEM_TOKENS
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/legacy-tabs.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/HashTag.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/CodeFenceEnter.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/rox-block-syntax.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/entity-input-rules.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/EntityEmbed.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/EntityMention.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/legacy-columns.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/RichBlockInteractions.ts
      symbol: RichBlockInteractions
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/DocumentFolding.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/WikiLink.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/rox-block-kinds.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/MarkdownComment.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/task-checkbox-input-rule.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/AnimatedTaskItem.ts
      symbol: AnimatedTaskItem
    - scanner: typescript
      file: packages/ui/src/components/markdown/extensions/legacy-fence.ts
  technology: TipTap
description: Renders declarative action-button fences in TipTap without executing side effects.
---
