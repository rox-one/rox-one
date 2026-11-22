---
type: C4 Component
title: TaskEntityBacklinks
status: stable
groma:
  id: taskentitybacklinks
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/entities/TaskEntityBacklinks.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/TaskEntityBacklinks.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/entities/NoteEntityMentions.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/NoteEntityMentions.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/entities/EntityHoverCard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/EntityHoverCard.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/entities/EntityCard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/EntityCard.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/entities/kind-icons.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/kind-icons.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/entities/EntityRowContextMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/EntityRowContextMenu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/entities/BacklinksPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/BacklinksPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/entities/entity-node-views.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/entity-node-views.tsx
      symbol: createEntityNodeViews
    - scanner: react
      file: apps/electron/src/renderer/components/entities/EntitiesPreviewsSettingsToggle.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/EntitiesPreviewsSettingsToggle.tsx
      symbol: EntitiesPreviewsSettingsToggle
    - scanner: react
      file: apps/electron/src/renderer/components/entities/EntityChip.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/EntityChip.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/entities/preview-registry.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/preview-registry.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/entities/EntityPicker.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/EntityPicker.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/canvas-backlink.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/use-entity-preview.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/flags.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/entity-context.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/index.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/row-actions.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/entity-data-source.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/backlink-groups.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/use-entity-backlinks.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/open-entity.ts
      symbol: openEntity
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/drag.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/entity-format.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/entities/fixtures.ts
description: Shows a task's «mentioned in» backlinks in the detail Links tab when entity previews are enabled.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/entities/EntityPicker.tsx](../../../../../../apps/electron/src/renderer/components/entities/EntityPicker.tsx) | [apps/electron/src/renderer/playground/registry/entity-primitives.tsx](../../../../../../apps/electron/src/renderer/playground/registry/entity-primitives.tsx) | Invokes supplied callback: onSelect | react |
