---
type: C4 Component
title: InlineCredentialCard
status: stable
groma:
  id: inlinecredentialcard
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/InlineCredentialCard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/InlineCredentialCard.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/InlineApprovalCard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/InlineApprovalCard.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/SessionDivider.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/SessionDivider.tsx
      symbol: SessionDivider
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/ContinuumTurn.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/ContinuumTurn.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/ArtifactShell.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/ArtifactShell.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/primitives.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/primitives.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/ScreenshotArtifact.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/ScreenshotArtifact.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/RunArtifact.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/RunArtifact.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/DiffArtifact.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/DiffArtifact.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/PermissionDiffPreview.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/chat-continuum/PermissionDiffPreview.tsx
description: Presents an inline credential request card in the chat continuum, reusing the existing credential form.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/app-shell/chat-continuum/InlineApprovalCard.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/chat-continuum/InlineApprovalCard.tsx) | [apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx) | Invokes supplied callback: onResponse | react |
| [apps/electron/src/renderer/components/app-shell/chat-continuum/InlineApprovalCard.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/chat-continuum/InlineApprovalCard.tsx) | [apps/electron/src/renderer/platform/InlineApproval.playground.tsx](../../../../../../apps/electron/src/renderer/platform/InlineApproval.playground.tsx) | Invokes supplied callback: onResponse | react |
