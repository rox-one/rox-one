---
type: C4 Component
title: Lib
status: stable
groma:
  id: craft-index-src-lib
  parent: native-runtime
  code:
    - scanner: rust
      file: native/crates/craft-index/src/lib.rs
description: Indexes workspace source files into SQLite for incremental full-text retrieval.
---
