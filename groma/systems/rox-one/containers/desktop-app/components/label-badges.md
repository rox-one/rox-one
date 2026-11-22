---
type: C4 Component
title: Label badges
status: stable
groma:
  id: label-badges
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/label-badges.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/label-badges.tsx
      symbol: labelBadgeComponents
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/generate-icons.ts
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/toasts.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/toasts.tsx
      symbol: toastsComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/browser-ui.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/browser-ui.tsx
      symbol: browserUiComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/unified-shell.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/unified-shell.tsx
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/messages.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/messages.tsx
      symbol: messagesComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/mobile-webui.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/mobile-webui.tsx
      symbol: mobileWebUIComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/turn-card.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/turn-card.tsx
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/markdown.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/markdown.tsx
      symbol: markdownComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/planner.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/planner.tsx
      symbol: plannerComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/entity-lists.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/entity-lists.tsx
      symbol: entityListComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/input.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/input.tsx
      symbol: inputComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/task-editor.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/task-editor.tsx
      symbol: taskEditorComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/chat.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/chat.tsx
      symbol: chatComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/settings.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/settings.tsx
      symbol: settingsComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/image-support.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/image-support.tsx
      symbol: imageSupportComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/edit-popover.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/edit-popover.tsx
      symbol: editPopoverComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/entity-primitives.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/entity-primitives.tsx
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/onboarding.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/onboarding.tsx
      symbol: onboardingComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/zen-shell-qa.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/zen-shell-qa.tsx
      symbol: zenShellQaComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/oauth.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/oauth.tsx
      symbol: oauthComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/glass.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/glass.tsx
      symbol: glassComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/session-list.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/session-list.tsx
      symbol: sessionListComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/project-colors.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/project-colors.tsx
      symbol: projectColorsComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/container-transitions.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/container-transitions.tsx
      symbol: containerTransitionsComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/api-key-input.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/api-key-input.tsx
      symbol: apiKeyInputComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/automations.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/automations.tsx
      symbol: automationComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/collection.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/collection.tsx
      symbol: collectionComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/premium-menu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/premium-menu.tsx
      symbol: premiumMenuComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/messaging.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/messaging.tsx
      symbol: messagingComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/transport-banner.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/transport-banner.tsx
      symbol: transportBannerComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/slash-command.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/slash-command.tsx
      symbol: slashCommandComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/custom-shadows.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/custom-shadows.tsx
      symbol: customShadowsComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/kanban.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/kanban.tsx
      symbol: kanbanComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/turn-card-modes.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/turn-card-modes.tsx
      symbol: turnCardModesComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/notes.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/notes.tsx
      symbol: notesComponents
    - scanner: react
      file: apps/electron/src/renderer/playground/registry/icons.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/icons.tsx
      symbol: iconComponents
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/story-loader.ts
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/sample-icons.ts
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/index.ts
    - scanner: typescript
      file: apps/electron/src/renderer/playground/registry/types.ts
description: Playground story demonstrating label value badges with popover editing for boolean, number, date and string labels.
---
