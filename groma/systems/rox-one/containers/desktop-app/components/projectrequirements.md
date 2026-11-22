---
type: C4 Component
title: ProjectRequirements
status: stable
groma:
  id: projectrequirements
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/project/ProjectRequirements.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/project/ProjectRequirements.tsx
      symbol: ProjectRequirements
    - scanner: react
      file: apps/electron/src/renderer/pages/project/roadmap-ui.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/project/roadmap-ui.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/project/ProjectAiPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/project/ProjectAiPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/project/ProjectInputs.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/project/ProjectInputs.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/project/ProjectTimeline.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/project/ProjectTimeline.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/project/RoadmapModelResult.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/project/RoadmapModelResult.tsx
      symbol: RoadmapModelResult
description: Edits project requirements by kind with acceptance criteria and milestone links.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/pages/project/ProjectAiPanel.tsx](../../../../../../apps/electron/src/renderer/pages/project/ProjectAiPanel.tsx) | [apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx](../../../../../../apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx) | Invokes supplied callbacks: onAccept, onApplyImprove, onImproveDone, runAi | react |
| [apps/electron/src/renderer/pages/project/ProjectInputs.tsx](../../../../../../apps/electron/src/renderer/pages/project/ProjectInputs.tsx) | [apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx](../../../../../../apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx) | Invokes supplied callbacks: onDeleteAsset, onInputsChange, onUploadFile | react |
| [apps/electron/src/renderer/pages/project/ProjectRequirements.tsx](../../../../../../apps/electron/src/renderer/pages/project/ProjectRequirements.tsx) | [apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx](../../../../../../apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx) | Invokes supplied callback: onChange | react |
| [apps/electron/src/renderer/pages/project/ProjectTimeline.tsx](../../../../../../apps/electron/src/renderer/pages/project/ProjectTimeline.tsx) | [apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx](../../../../../../apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx) | Invokes supplied callbacks: onChange, onCreateTask, onFocusMilestone, taskStats | react |
| [apps/electron/src/renderer/pages/project/roadmap-ui.tsx](../../../../../../apps/electron/src/renderer/pages/project/roadmap-ui.tsx) | [apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx](../../../../../../apps/electron/src/renderer/pages/ProjectRoadmapPage.tsx) | Invokes supplied callbacks: onChange, onCommit | react |
