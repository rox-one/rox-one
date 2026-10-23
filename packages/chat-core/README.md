# @rox/chat-core

> **Attribution.** Part of the Rox native chat client. Portions derived from
> Block's Buzz (<https://github.com/block/buzz>), Copyright Block, Inc.,
> licensed under the Apache License, Version 2.0. The relay deployment lives in
> [`deploy/rox-chat/`](../../deploy/rox-chat/) and the native implementation in
> [`native/crates/rox-chat-core/`](../../native/crates/rox-chat-core/). See
> [`NOTICE`](../../NOTICE) for the full list of third-party notices.

Native NIP-01 chat core for the Rox messenger. The implementation is Rust; this
package is the thin ESM loader that exposes it to the desktop app.

## What it does

* **Relay client** — a Tokio WebSocket speaking NIP-01: client frames `REQ` /
  `EVENT` / `CLOSE` / `AUTH`, relay frames `EVENT` / `EOSE` / `OK` / `AUTH` /
  `NOTICE`. An `AUTH` challenge is answered automatically with a signed
  kind-22242 event.
* **Reconnect** — exponential backoff, then re-subscribe to every channel the
  host asked for and replay the outbox.
* **Cache** — SQLite tables `events`, `channels`, `read_state` plus an FTS5
  virtual table over message content (`searchMessages`).
* **Durable outbox** — locally authored events are written to SQLite before they
  hit the wire, replayed in insertion order on reconnect and keyed by event id
  so a replay is idempotent.
* **Signing** — NIP-01 canonical id (`sha256` of
  `[0,pubkey,created_at,kind,tags,content]`) signed with BIP340 schnorr. The
  relay key is passed in by the host and held in memory only; it is never
  written to the cache.
* **Ephemeral presence/typing** — kinds 20001/20002 are surfaced through
  callbacks and never persisted.

## Usage

```js
import { createChatCore, ChatCoreUnavailableError } from '@rox/chat-core';

const core = createChatCore({
  relayUrl: 'wss://chat.rox.one',
  dbPath: '/path/to/chat.sqlite',
  secretKeyHex: relayKeyHex,
  channels: [channelId],
});

core.onMessage((message) => render(message));
core.onStatus((status) => setStatus(status.state));

await core.start();
await core.sendMessage(channelId, 'hello');
```

`createChatCore` throws `ChatCoreUnavailableError` when the platform addon is not
built, so callers can fall back to a web implementation.

## Building the addon

```sh
cd native
cargo test -p rox-chat-core                                     # pure-Rust tests, no Node symbols
cargo build -p rox-chat-core --features napi-bindings --release  # produces the cdylib
```

The napi bindings live behind the `napi-bindings` feature, so neither the core
nor its tests link against Node.

## Notes on the wire format

* `createdAt` is the NIP-01 `created_at`: **unix seconds**.
* `publishTyping(channel, untilMs)` takes **unix milliseconds** (matching
  `TypingEntry.until`).
* `editMessage` / `deleteMessage` return the id of the message that changed.
  They publish a kind-9 envelope tagged `["e", id, "", "edit"]` and a NIP-09
  kind-5 deletion respectively, and update the local cache optimistically.
