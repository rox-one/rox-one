---
type: C4 Component
title: Main
status: stable
groma:
  id: craft-native-src-main
  parent: native-runtime
  code:
    - scanner: rust
      file: native/apps/craft-native/src/main.rs
description: Serves the native sidecar RPC over a Unix socket for index, run, journal and exec.
---
