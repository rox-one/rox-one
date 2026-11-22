---
type: C4 Component
title: FeedParts
status: stable
groma:
  id: feedparts
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/feed/FeedParts.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/feed/FeedParts.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/feed/FeedSectionTabs.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/feed/FeedSectionTabs.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/feed/FeedSidebar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/feed/FeedSidebar.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/feed/FeedSources.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/feed/FeedSources.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/feed/feed-list-render.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/feed/feed-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/feed/feed-caller.ts
description: 'Provides small Лента presentational parts: color dots, tag editor, sparkline and source icons.'
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/pages/feed/FeedParts.tsx](../../../../../../apps/electron/src/renderer/pages/feed/FeedParts.tsx) | [apps/electron/src/renderer/pages/FeedPage.tsx](../../../../../../apps/electron/src/renderer/pages/FeedPage.tsx) | Invokes supplied callbacks: onChange, onToggle | react |
| [apps/electron/src/renderer/pages/feed/FeedSidebar.tsx](../../../../../../apps/electron/src/renderer/pages/feed/FeedSidebar.tsx) | [apps/electron/src/renderer/pages/FeedPage.tsx](../../../../../../apps/electron/src/renderer/pages/FeedPage.tsx) | Invokes supplied callbacks: onSourceSelect, onViewSelect | react |
| [apps/electron/src/renderer/pages/feed/FeedSources.tsx](../../../../../../apps/electron/src/renderer/pages/feed/FeedSources.tsx) | [apps/electron/src/renderer/features/product-tour/adapters/work/inbox-feed/reader-harness.fixture.tsx](../../../../../../apps/electron/src/renderer/features/product-tour/adapters/work/inbox-feed/reader-harness.fixture.tsx) | Invokes supplied callbacks: onSelect, onShowItems, reload | react |
| [apps/electron/src/renderer/pages/feed/FeedSources.tsx](../../../../../../apps/electron/src/renderer/pages/feed/FeedSources.tsx) | [apps/electron/src/renderer/pages/FeedPage.tsx](../../../../../../apps/electron/src/renderer/pages/FeedPage.tsx) | Invokes supplied callbacks: fmt, onRemoved, onShowItems, reload | react |
