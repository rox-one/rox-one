---
type: C4 Component
title: Cache
status: stable
groma:
  id: src-cache
  parent: native-runtime
  code:
    - scanner: rust
      file: native/crates/rox-chat-core/src/cache.rs
    - scanner: rust
      file: native/crates/rox-chat-core/src/client.rs
    - scanner: rust
      file: native/crates/rox-chat-core/src/wire.rs
    - scanner: rust
      file: native/crates/rox-chat-core/src/types.rs
    - scanner: rust
      file: native/crates/rox-chat-core/src/store.rs
    - scanner: rust
      file: native/crates/rox-chat-core/src/outbox.rs
    - scanner: rust
      file: native/crates/rox-chat-core/src/error.rs
    - scanner: rust
      file: native/crates/rox-chat-core/src/keys.rs
    - scanner: rust
      file: native/crates/rox-chat-core/src/event.rs
    - scanner: rust
      file: native/crates/rox-chat-core/src/lib.rs
description: Caches chat messages, channels and read state in SQLite with FTS5 search.
---
