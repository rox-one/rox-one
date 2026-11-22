---
type: C4 Component
title: ChatInputZone
status: stable
groma:
  id: chatinputzone
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/input/ChatInputZone.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/ChatInputZone.tsx
      symbol: ChatInputZone
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/input/ComposerStatsLine.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/ComposerStatsLine.tsx
      symbol: ComposerStatsLine
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/input/ImageSupportWarningBanner.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/ImageSupportWarningBanner.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/input/VoiceDictationControl.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/VoiceDictationControl.tsx
      symbol: VoiceDictationControl
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/input/CompactPermissionModeSelector.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/CompactPermissionModeSelector.tsx
      symbol: CompactPermissionModeSelector
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/input/InputContainer.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/InputContainer.tsx
      symbol: InputContainer
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/input/FreeFormInputContextBadge.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/FreeFormInputContextBadge.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/input/InputErrorBoundary.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/InputErrorBoundary.tsx
      symbol: InputErrorBoundary
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/input/CompactModelSelector.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/CompactModelSelector.tsx
      symbol: CompactModelSelector
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/input/WorkingDirectorySelector.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/WorkingDirectorySelector.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/input/StructuredInput.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/StructuredInput.tsx
      symbol: StructuredInput
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/input/ToolbarStatusSlot.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/ToolbarStatusSlot.tsx
      symbol: ToolbarStatusSlot
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/composer-stats.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/model-picker-helpers.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/useModelVisionToggle.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/turn-progress.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/index.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/useAutoGrow.ts
      symbol: useAutoGrow
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/structured-height.ts
      symbol: getStructuredInputMaxHeight
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/use-working-directory-state.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/focus-input-events.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/working-directory-history.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/input-event-guards.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/picker-mode.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/voice-dictation-state.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/prompt-history.ts
description: 'Assembles the composer zone: input, option badges, labels, project chip and stats line.'
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx) | [apps/electron/src/renderer/pages/dev-space/components/AskQuestionComposer.tsx](../../../../../../apps/electron/src/renderer/pages/dev-space/components/AskQuestionComposer.tsx) | Invokes supplied callbacks: onModelChange, onSubmit | react |
| [apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx) | [apps/electron/src/renderer/platform/ComposerDeck.playground.tsx](../../../../../../apps/electron/src/renderer/platform/ComposerDeck.playground.tsx) | Invokes supplied callbacks: onSourcesChange, onStop, onSubmit, onWorkingDirectoryChange | react |
| [apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx) | [apps/electron/src/renderer/playground/registry/slash-command.tsx](../../../../../../apps/electron/src/renderer/playground/registry/slash-command.tsx) | Invokes supplied callbacks: onStop, onSubmit | react |
| [apps/electron/src/renderer/components/app-shell/input/InputContainer.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/input/InputContainer.tsx) | [apps/electron/src/renderer/playground/registry/chat.tsx](../../../../../../apps/electron/src/renderer/playground/registry/chat.tsx) | Invokes supplied callback: onStructuredResponse | react |
| [apps/electron/src/renderer/components/app-shell/input/WorkingDirectorySelector.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/input/WorkingDirectorySelector.tsx) | [apps/electron/src/renderer/components/app-shell/kanban/TaskEditor.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/kanban/TaskEditor.tsx) | Invokes supplied callback: renderTrigger | react |
