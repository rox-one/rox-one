---
type: C4 Component
title: RepoWatchControls
status: stable
groma:
  id: repowatchcontrols
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/dev-space/components/RepoWatchControls.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/dev-space/components/RepoWatchControls.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/dev-space/components/AskQuestionComposer.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/dev-space/components/AskQuestionComposer.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/dev-space/components/QuestionsSurface.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/dev-space/components/QuestionsSurface.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/dev-space/components/AddRepositoryDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/dev-space/components/AddRepositoryDialog.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/dev-space/components/ArtifactSurface.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/dev-space/components/ArtifactSurface.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/dev-space/components/RepositoryCard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/dev-space/components/RepositoryCard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/dev-space/components/useDevSpaceTourLauncher.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/dev-space/components/status.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/dev-space/components/errors.ts
      symbol: devSpaceErrorKey
    - scanner: typescript
      file: apps/electron/src/renderer/pages/dev-space/components/useDevSpaceGeneratedTours.ts
      symbol: useDevSpaceGeneratedTours
    - scanner: typescript
      file: apps/electron/src/renderer/pages/dev-space/components/questions.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/dev-space/components/surfaces.ts
description: 'Configures per-repository background watch: cadence, auto-pull and artifact regeneration.'
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/pages/dev-space/components/AddRepositoryDialog.tsx](../../../../../../apps/electron/src/renderer/pages/dev-space/components/AddRepositoryDialog.tsx) | [apps/electron/src/renderer/pages/dev-space/DevSpaceHomePage.tsx](../../../../../../apps/electron/src/renderer/pages/dev-space/DevSpaceHomePage.tsx) | Invokes supplied callback: onSubmit | react |
| [apps/electron/src/renderer/pages/dev-space/components/AskQuestionComposer.tsx](../../../../../../apps/electron/src/renderer/pages/dev-space/components/AskQuestionComposer.tsx) | [apps/electron/src/renderer/pages/dev-space/DevSpaceRepoPage.tsx](../../../../../../apps/electron/src/renderer/pages/dev-space/DevSpaceRepoPage.tsx) | Invokes supplied callback: onShowOnScreens | react |
| [apps/electron/src/renderer/pages/dev-space/components/QuestionsSurface.tsx](../../../../../../apps/electron/src/renderer/pages/dev-space/components/QuestionsSurface.tsx) | [apps/electron/src/renderer/pages/dev-space/DevSpaceRepoPage.tsx](../../../../../../apps/electron/src/renderer/pages/dev-space/DevSpaceRepoPage.tsx) | Invokes supplied callbacks: onGenerated, onWatchTour | react |
| [apps/electron/src/renderer/pages/dev-space/components/RepositoryCard.tsx](../../../../../../apps/electron/src/renderer/pages/dev-space/components/RepositoryCard.tsx) | [apps/electron/src/renderer/pages/dev-space/DevSpaceHomePage.tsx](../../../../../../apps/electron/src/renderer/pages/dev-space/DevSpaceHomePage.tsx) | Invokes supplied callbacks: onCancel, onOpen, onRefresh, onRemove | react |
