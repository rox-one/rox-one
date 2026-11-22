---
type: C4 Component
title: Lite mode
status: stable
groma:
  id: lite-mode
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/lib/lite-mode.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/lite-mode.ts
    - scanner: react
      file: apps/electron/src/renderer/lib/route-recovery.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/lib/route-recovery.tsx
    - scanner: react
      file: apps/electron/src/renderer/lib/deferred-motion.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/lib/deferred-motion.tsx
    - scanner: react
      file: apps/electron/src/renderer/lib/surface-keepalive.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/lib/surface-keepalive.tsx
    - scanner: react
      file: apps/electron/src/renderer/lib/render-profile-motion.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/lib/render-profile-motion.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/lib/notes-write-authority.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/native-notes-sync.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/workspace-work-client.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/open-label-link.ts
      symbol: openLabelLink
    - scanner: typescript
      file: apps/electron/src/renderer/lib/shell-layout-preferences.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/connection-labels.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/skill-mentions.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/route-preload.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/memory-approval-receipt.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/transport-wait.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/errors.ts
      symbol: toErrorMessage
    - scanner: typescript
      file: apps/electron/src/renderer/lib/merge-refs.ts
      symbol: mergeRefs
    - scanner: typescript
      file: apps/electron/src/renderer/lib/skills-query.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/native-surface-owners.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/web-chrome-preference.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/starter-prompts.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/density-preference.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/overlay-detection.ts
      symbol: hasOpenOverlay
    - scanner: typescript
      file: apps/electron/src/renderer/lib/local-storage.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/message-action-id.ts
      symbol: messageActionId
    - scanner: typescript
      file: apps/electron/src/renderer/lib/warmup.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/layout-engine.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/learning-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/session-sharing.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/document-writer-retry.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/smart-typography.ts
      symbol: applySmartTypography
    - scanner: typescript
      file: apps/electron/src/renderer/lib/utils.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/input-text.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/browser-history.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/provider-icons.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/perf.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/sidebar-unseen-status.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/native-surface-visibility.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/startup-perf.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/slow-refresh-scheduler.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/panel-workspace-layout.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/contextual-suggestions.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/panel-keyboard.ts
      symbol: panelOwnsKeyboardTarget
    - scanner: typescript
      file: apps/electron/src/renderer/lib/drafts.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/session-row-actions.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/ui-appearance-store.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/pages-project-context.ts
      symbol: pagesCreationProject
    - scanner: typescript
      file: apps/electron/src/renderer/lib/platform.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/collection-reorder.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/zen-shell-qa-catalog.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/useWorkspaceWork.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/session-presence.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/navigation-registry.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/material-effect-art.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/icon-cache.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/session-load.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/layout-defaults.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/personal-tasks.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/latest-state-buffer.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/slugify.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/panel-url.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/logger.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/entities-links-sync.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/animations.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/dismissible-layer-bridge.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/header-status.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/branch-error.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/notes-capability.ts
      symbol: hasNativeNotesTransport
    - scanner: typescript
      file: apps/electron/src/renderer/lib/file-changes.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/render-profile-status.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/mentions.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/shell-appearance-subscription.ts
      symbol: subscribeDesktopShellAppearance
    - scanner: typescript
      file: apps/electron/src/renderer/lib/navigate.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/session-learn-request.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/home-fetch.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/scoped-capability-read.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/settings-recent.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/session-auto-open.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/memory-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/native-surface-dom.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/desktop-appearance.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/status-bar-items.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/runtime-trace-navigation.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/rox-connect-poll.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/personal-tasks-sync.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/capability-catalog.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/rovers-client.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/open-workspace-tool.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/focus-session.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/lesson-dedupe.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/system-accent.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/feature-flags.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/message-tts.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/notes-migration-map.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/usePanelKeyboardGuard.ts
      symbol: usePanelKeyboardGuard
    - scanner: typescript
      file: apps/electron/src/renderer/lib/idle-preload.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/reconnect-recovery.ts
      symbol: getSessionsToRefreshAfterStaleReconnect
    - scanner: typescript
      file: apps/electron/src/renderer/lib/draft-persistence.ts
      symbol: DraftPersistence
    - scanner: typescript
      file: apps/electron/src/renderer/lib/session-share-provider.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/one-time-hints.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/migrate-conation-flags-default-off.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/error-journal.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/authenticated-web-bootstrap.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/permission-mode-reconcile.ts
      symbol: getSessionsRequiringPermissionModeReconcile
    - scanner: typescript
      file: apps/electron/src/renderer/lib/file-utils.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/runtime-catalog-capabilities.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/skill-risk.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/caller-session-loading.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/zen-shell-qa-fixture.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/nav-helpers.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/startup-shell-cache.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/stale-chunk-reload.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/render-profile-dom.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/splash-sessions-ready.ts
      symbol: markSessionsReadyThenReconcile
    - scanner: typescript
      file: apps/electron/src/renderer/lib/pausable-deadline.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/shell-warmup.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/main-language-sync.ts
      symbol: syncMainProcessLanguage
    - scanner: typescript
      file: apps/electron/src/renderer/lib/startup-setup-needs.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/se-icon-map.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/task-reminders.ts
description: Switches the app into reduced-data mode, disabling decorative animation and blur via a data attribute.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/lib/authenticated-web-bootstrap.ts](../../../../../../apps/electron/src/renderer/lib/authenticated-web-bootstrap.ts) | [apps/electron/src/renderer/App.tsx](../../../../../../apps/electron/src/renderer/App.tsx) | Invokes supplied callbacks: isCancelled, onWorkspaceReady | typescript |
| [apps/electron/src/renderer/lib/caller-session-loading.ts](../../../../../../apps/electron/src/renderer/lib/caller-session-loading.ts) | [apps/electron/src/renderer/App.tsx](../../../../../../apps/electron/src/renderer/App.tsx) | Invokes supplied callbacks: getAuthority, getNativeWorkspaceId, getScopeKey, request | typescript |
| [apps/electron/src/renderer/lib/native-surface-dom.ts](../../../../../../apps/electron/src/renderer/lib/native-surface-dom.ts) | [apps/electron/src/renderer/hooks/useNativeSurfaceBounds.ts](../../../../../../apps/electron/src/renderer/hooks/useNativeSurfaceBounds.ts) | Invokes supplied callbacks: cancelFrame, measure, paused, requestFrame | typescript |
| [apps/electron/src/renderer/lib/notes-write-authority.ts](../../../../../../apps/electron/src/renderer/lib/notes-write-authority.ts) | [apps/electron/src/renderer/pages/NotesPage.tsx](../../../../../../apps/electron/src/renderer/pages/NotesPage.tsx) | Invokes supplied callbacks: markdown, native | typescript |
| [apps/electron/src/renderer/lib/scoped-capability-read.ts](../../../../../../apps/electron/src/renderer/lib/scoped-capability-read.ts) | [apps/electron/src/renderer/pages/NotesPage.tsx](../../../../../../apps/electron/src/renderer/pages/NotesPage.tsx) | Invokes supplied callbacks: isCurrent, onAvailable, onUnavailable, read | typescript |
| [apps/electron/src/renderer/lib/session-sharing.ts](../../../../../../apps/electron/src/renderer/lib/session-sharing.ts) | [apps/electron/src/renderer/components/app-shell/SessionSharingHost.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/SessionSharingHost.tsx) | Invokes supplied callbacks: currentWorkspace, openRemoteSession, openSession, readSession, switchWorkspace | typescript |
| [apps/electron/src/renderer/lib/transport-wait.ts](../../../../../../apps/electron/src/renderer/lib/transport-wait.ts) | [apps/electron/src/renderer/App.tsx](../../../../../../apps/electron/src/renderer/App.tsx) | Invokes supplied callbacks: arm, disarm, load, onAttemptTimeout, onExhausted | typescript |
| [apps/electron/src/renderer/lib/warmup.ts](../../../../../../apps/electron/src/renderer/lib/warmup.ts) | [apps/electron/src/renderer/perf/surface-sim.ts](../../../../../../apps/electron/src/renderer/perf/surface-sim.ts) | Invokes supplied callbacks: recentSessionIds, warmAgentProfiles, warmCalendar, warmInboxAndFeed, warmNotesAndTasks, warmRouteChunks, warmSessionMeta, warmSkillsAndSources, warmTranscriptTail | typescript |
| [apps/electron/src/renderer/lib/pausable-deadline.ts](../../../../../../apps/electron/src/renderer/lib/pausable-deadline.ts) | [apps/electron/src/renderer/hooks/useHeaderStatusDeadline.ts](../../../../../../apps/electron/src/renderer/hooks/useHeaderStatusDeadline.ts) | Invokes supplied callbacks: clearTimer, now, onElapsed, setTimer | typescript |
| [apps/electron/src/renderer/lib/splash-sessions-ready.ts](../../../../../../apps/electron/src/renderer/lib/splash-sessions-ready.ts) | [apps/electron/src/renderer/App.tsx](../../../../../../apps/electron/src/renderer/App.tsx) | Invokes supplied callbacks: markReady, reconcileAll | typescript |
