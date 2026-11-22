---
type: C4 Component
title: ProposalInbox
status: stable
groma:
  id: proposalinbox
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/meetings/ProposalInbox.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/meetings/ProposalInbox.tsx
      symbol: ProposalInbox
    - scanner: react
      file: apps/electron/src/renderer/pages/meetings/MeetingsSidebar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/meetings/MeetingsSidebar.tsx
      symbol: MeetingsSidebar
    - scanner: react
      file: apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/meetings/MeetingDetail.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/meetings/MeetingDetail.tsx
      symbol: MeetingDetail
    - scanner: react
      file: apps/electron/src/renderer/pages/meetings/ConationPanels.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/meetings/ConationPanels.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/meetings/finalize-rpc.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/meetings/manual-rpc.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/meetings/meetings-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/meetings/proposal-rpc.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/meetings/meeting-page-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/meetings/selection.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/meetings/local-meetings-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/meetings/request-state.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/meetings/import-rpc.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/meetings/capture-rpc.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/meetings/start-rpc.ts
description: Lists meeting proposals with batch approve, reject and clarify actions.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx](../../../../../../apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx) | [apps/electron/src/renderer/pages/MeetingsPage.tsx](../../../../../../apps/electron/src/renderer/pages/MeetingsPage.tsx) | Invokes supplied callback: onTrashed | react |
| [apps/electron/src/renderer/pages/meetings/ProposalInbox.tsx](../../../../../../apps/electron/src/renderer/pages/meetings/ProposalInbox.tsx) | [apps/electron/src/renderer/pages/MeetingsPage.tsx](../../../../../../apps/electron/src/renderer/pages/MeetingsPage.tsx) | Invokes supplied callbacks: onApprove, onOpenTarget, onReject | react |
