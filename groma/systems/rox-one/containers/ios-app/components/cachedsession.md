---
type: C4 Component
title: CachedSession
status: stable
groma:
  id: cachedsession
  parent: ios-app
  code:
    - scanner: swift
      file: apps/ios/CraftAgentsApp/CraftAgentsApp/Persistence/CachedSession.swift
    - scanner: swift
      file: apps/ios/CraftAgentsApp/CraftAgentsApp/Persistence/CachedMessage.swift
    - scanner: swift
      file: apps/ios/CraftAgentsApp/CraftAgentsApp/Persistence/SessionCacheRepository.swift
  technology: SwiftData
description: Caches session summaries locally in SwiftData for offline session lists.
---
