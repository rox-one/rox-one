---
type: C4 Component
title: StarterPromptList
status: stable
groma:
  id: starterpromptlist
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/chat/StarterPromptList.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/chat/StarterPromptList.tsx
      symbol: StarterPromptList
    - scanner: react
      file: apps/electron/src/renderer/components/chat/EmptyChatWelcome.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/chat/EmptyChatWelcome.tsx
      symbol: EmptyChatWelcome
    - scanner: react
      file: apps/electron/src/renderer/components/chat/AuthRequestCard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/chat/AuthRequestCard.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/chat/SideThreadPreviewDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/chat/SideThreadPreviewDialog.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/chat/EmptyStateHint.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/chat/EmptyStateHint.tsx
description: Lists suggested starter prompts with their source and skill dependencies above the composer.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/chat/AuthRequestCard.tsx](../../../../../../apps/electron/src/renderer/components/chat/AuthRequestCard.tsx) | [apps/electron/src/renderer/playground/registry/messages.tsx](../../../../../../apps/electron/src/renderer/playground/registry/messages.tsx) | Invokes supplied callback: onRespondToCredential | react |
| [apps/electron/src/renderer/components/chat/SideThreadPreviewDialog.tsx](../../../../../../apps/electron/src/renderer/components/chat/SideThreadPreviewDialog.tsx) | [apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx) | Invokes supplied callbacks: onCancel, onChangePrompt | react |
| [apps/electron/src/renderer/components/chat/StarterPromptList.tsx](../../../../../../apps/electron/src/renderer/components/chat/StarterPromptList.tsx) | [apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx) | Invokes supplied callback: onSelect | react |
