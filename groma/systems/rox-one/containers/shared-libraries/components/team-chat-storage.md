---
type: C4 Component
title: Storage
status: stable
groma:
  id: team-chat-storage
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/team-chat/storage.ts
    - scanner: typescript
      file: packages/shared/src/team-chat/types.ts
    - scanner: typescript
      file: packages/shared/src/team-chat/livekit-token.ts
    - scanner: typescript
      file: packages/shared/src/team-chat/apply-livekit-webhook.ts
    - scanner: typescript
      file: packages/shared/src/team-chat/call-summary.ts
    - scanner: typescript
      file: packages/shared/src/team-chat/livekit-webhook.ts
    - scanner: typescript
      file: packages/shared/src/team-chat/call-credentials.ts
    - scanner: typescript
      file: packages/shared/src/team-chat/index.ts
    - scanner: typescript
      file: packages/shared/src/team-chat/im-bridge.ts
    - scanner: typescript
      file: packages/shared/src/team-chat/export-to-relay.ts
description: Persists team channels, messages and call transcripts to team-chat.json with membership and size enforcement.
---
