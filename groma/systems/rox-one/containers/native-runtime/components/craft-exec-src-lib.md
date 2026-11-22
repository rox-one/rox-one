---
type: C4 Component
title: Lib
status: stable
groma:
  id: craft-exec-src-lib
  parent: native-runtime
  code:
    - scanner: rust
      file: native/crates/craft-exec/src/lib.rs
description: Executes host shell commands with environment scrubbing, timeouts and cwd jail.
---
