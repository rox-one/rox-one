---
type: C4 Component
title: Native inbox scope
status: stable
groma:
  id: native-inbox-scope
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/native-inbox-scope.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/llm-connections.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/system-tts.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/browser-pane.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/auth.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/statuses.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/sources.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/resources.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/toolchain.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/voice-audio-read.ts
      symbol: readVoiceAudioChunk
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/native-inbox-events.ts
      symbol: projectNativeInboxChanged
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/workspace.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/browser-data-auto-import.ts
      symbol: BrowserDataAutoImporter
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/sessions.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/directory.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/transfer.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/native-source-metadata.ts
      symbol: readNativeSourceMetadata
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/native-sidebar-metadata.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/extensions.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/note-read-error.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/knowledge-map.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/voice.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/onboarding-suggest.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/session-actor.ts
      symbol: sessionActorIdFor
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/messaging.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/memory-io.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/knowledge.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/session-foreign-auto-import-storage.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/notes.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/content.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/keeper.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/meetings.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/native-session-collaboration.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/cloud-handoff.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/workspace-guard.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/code-intelligence.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/server.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/memory-insights.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/system.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/native-notes-events.ts
      symbol: projectNativeNotesChanged
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/memory-proposals.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/environment.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/marketplace.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/cloud-handoff-sources.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/files.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/gamification.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/plugin-bridge.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/collection.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/skills-tool-runtime.ts
      symbol: createNativeSkillsToolRuntime
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/context-docs.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/skills.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/native-data.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/session-foreign-auto-import.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/tasks.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/workspace-work.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/memory.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/feed.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/privacy.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/rovers.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/index.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/automations.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/nodes.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/calendar-apple.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/memory-repo-import.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/notes-import.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/fabric.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/cloud-runs.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/native-personal-tasks.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/kanban.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/mindmap.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/onboarding.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/bundled-skills.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/memory-repo.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/session-foreign-import.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/drive.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/google-meet.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/onboarding-permissions.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/skills-pending.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/command-gateway.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/board.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/native-workspace-registry.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/fabric-runtime.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/workboard.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/labels.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/infisical-http.ts
      symbol: createInfisicalHttpClient
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/native-voice-scope.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/runtime-trace.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/settings.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/memory-test-setup.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/oauth.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/entities.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/learning.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/tg-link.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/native-model-catalog.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/browser-profile-import.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/team-chat.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/meeting-planning.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/voice-realtime.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/projects.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/pages.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/native-gamification.ts
      symbol: NativeGamificationStore
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/calendar-google.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/personal-tasks.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/native-feed.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/identity.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/commands.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/browser-credential-vault.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/dev-space.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/native-session-scope.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/orgs.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/openclaw.ts
    - scanner: typescript
      file: packages/server-core/src/handlers/rpc/browser-protected-cookie-key.ts
      symbol: deleteProtectedCookieKey
description: Guards native-inbox RPC reads and writes with owner, workspace and bounded-filesystem checks.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server-core/src/handlers/rpc/directory.ts](../../../../../../packages/server-core/src/handlers/rpc/directory.ts) | [packages/server-core/src/entities/workbench-flags.ts](../../../../../../packages/server-core/src/entities/workbench-flags.ts) | Invokes supplied callback: enabledWorkbenchFlags | typescript |
| [packages/server-core/src/handlers/rpc/keeper.ts](../../../../../../packages/server-core/src/handlers/rpc/keeper.ts) | [apps/electron/src/main/keeper/register.ts](../../../../../../apps/electron/src/main/keeper/register.ts) | Invokes supplied callback: readBrowserCredentialKey | typescript |
