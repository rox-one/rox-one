---
type: C4 Component
title: WireError
status: stable
groma:
  id: wireerror
  parent: ios-app
  code:
    - scanner: swift
      file: apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/WireError.swift
    - scanner: swift
      file: apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/JSONValue.swift
    - scanner: swift
      file: apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/RPCChannels.swift
    - scanner: swift
      file: apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/MessageEnvelope.swift
    - scanner: swift
      file: apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/ProtocolConstants.swift
      symbol: ProtocolConstants
    - scanner: swift
      file: apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/ProtocolVersionPolicy.swift
    - scanner: swift
      file: apps/ios/CraftAgentKit/Sources/CraftAgentKit/Protocol/ProtocolCodec.swift
description: Mirrors wire error codes so the iOS client tolerates unknown server errors.
---
