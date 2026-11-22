---
type: C4 Component
title: RPCClient+Content
status: stable
groma:
  id: rpcclient-content
  parent: ios-app
  code:
    - scanner: swift
      file: apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient+Content.swift
    - scanner: swift
      file: apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient+Workspaces.swift
    - scanner: swift
      file: apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient+Sessions.swift
    - scanner: swift
      file: apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/JSONValue+Decoding.swift
      symbol: JSONValue.decoded
    - scanner: swift
      file: apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient+SessionControl.swift
    - scanner: swift
      file: apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient.swift
    - scanner: swift
      file: apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient+Organization.swift
    - scanner: swift
      file: apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient+Knowledge.swift
description: Adds session file-tree, notes and content-search calls to the iOS RPC client.
---
