# V7 — voice runtime verification (slice S8 + fix-s8-voice)

- Repo: `/Users/t/Projects/rox-one-port` @ `cdcd4c50faa25ff909662ef9e2efe91fedf7c1d0` (branch `port/openclaw-features`)
- Runtime: `bun 1.4.2` (macOS arm64, node 26.8.2); real loopback WebSockets and real `WsRpcServer`/`WsRpcClient` over TCP.
- Scripts (throwaway, `/tmp/v7/`): `fixture.ts`, `ab-ordering.ts`, `cd-queue-wake.ts`, `e-stt-reconnect.ts`, `cf-rpc-e2e.ts`.
- All long-running processes were bounded (`timeout 120/150`) and their WS servers stopped (`server.stop(true)` / `server.close()`); no ports left bound.

Every observed fact below is real runtime output from the scripts, not a unit-test assertion. Claims that could only be exercised in-process (pure functions) are labelled as such.

---

## (a) Audio chunks flow through the bridge into the fixture in order

**Command:** `timeout 120 bun run /tmp/v7/ab-ordering.ts`

The bridge is driven with the real `openGlobalWebSocket` opener against a real `Bun.serve` WS fixture.

Observed (trimmed):
```
(a) ready=1 ok=true
(a) append byte order = [11,12,13,21,22,23] (expect 11,12,13,21,22,23)
(a) first frame type = session.update
(a) auth header = Bearer k
```
- `11,12,13` were sent **while `connecting`** (queued), `21,22,23` **after ready** (direct). The fixture received them in exactly that order: `input_audio_buffer.append` frames decoded base64 → `[11,12,13,21,22,23]`. Handshake (`session.update`) is always first, auth header forwarded.

**Sequencer + reorder buffer (in-process, pure functions):**
```
(a2) sequencer seqs = 1,2,3
(a2) after seq3 -> ordered=  pending=3 watermark=0
(a2) after seq1 -> ordered=1 pending=3 watermark=1
(a2) after seq2 -> ordered=1,2,3 watermark=3 monotonic=true pending=0
(a2) duplicate seq2 -> dropped=1 ordered=1,2,3
```
`TalkEventSequencer` assigns strictly increasing `seq` (1,2,3). `mergeTalkEvent`, fed out of order (3 → 1 → 2), buffers the gap and emits only the contiguous prefix; the final `ordered` stream is strictly monotonic; a duplicate is counted (`dropped=1`) and never appended. **The per-connection frame delivery itself is FIFO (observed over the wire); the reorder buffer is the consumer-side merge and is exercised directly.**

**Verdict (a): PASS** (ordering over the real WS wire + monotonic reorder buffer verified).

---

## (b) fix-s8 socket binding — no cross-talk

**Commands:** `timeout 120 bun run /tmp/v7/ab-ordering.ts` (sections b + b2)

**(b1) two concurrent bridge sessions, real WS, two fixtures:**
```
(b) fixtureA appends=[1:1:1] fixtureB appends=[2:2:2]
(b) after A drop: A connections=2 reconnected=true; B connections=1
(b) A new socket first frame = session.update
(b) crossTalk: A-appends-in-A=1 B-appends-in-B=1
```
Session A and session B each send distinct audio. Fixture A received only A's payloads (`1:1:1`), fixture B only B's (`2:2:2`). Dropping A's socket made A reconnect (2 connections, fresh `session.update`) while B kept its single undisturbed connection.

**(b2) the exact fixed bug — late event from a superseded socket (scripted opener, deterministic):**
```
(b2) sockets after connect = 1
(b2) abandoned socket sent frames while connecting = 0
(b2) retry scheduled = true
(b2) sockets after retry = 2; abandoned closeCalls=1
(b2) live ready=1; live first frame=session.update; queued drained audio=9:9
```
Sequence replayed: audio queued while connecting → socket A errors → retry opens socket B (A is actively closed: `closeCalls=1`) → **A's late `onClose(1006)` arrives** → B still opens, completes the handshake (`session.update`, `ready=1`) and drains the queued frame (`9:9`). Pre-fix (`git show 0e609814f` diff, source inspection) the late close set `this.socket = null` and called `lifecycle.fail(...)` unconditionally, clobbering the live retried socket — this scenario is the regression that fix closed.

**Verdict (b): PASS** (isolation confirmed over real WS; the superseded-socket clobber is verifiably gone).

---

## (c) Typed wire error codes, never a fake provider

**(c-module)** `timeout 120 bun run /tmp/v7/cd-queue-wake.ts`:
```
(c-module) no provider configured: VoiceProviderError code=unconfigured inErrorCodeUnion=true isVoiceProviderError=true
(c-module) preferred unconfigured: VoiceProviderError code=unconfigured inErrorCodeUnion=true isVoiceProviderError=true
(c-module) unknown provider id: VoiceProviderError code=unknown-provider inErrorCodeUnion=true isVoiceProviderError=true
(c-module) unknown provider via resolve: VoiceProviderError code=unknown-provider inErrorCodeUnion=true isVoiceProviderError=true
(c-module) registry.resolveRealtime unconfigured -> code=unconfigured
(c-module) registry.resolveRealtime unknown -> code=unknown-provider
```
No call ever returned a provider on failure — every failure is a thrown `VoiceProviderError` whose `code` is a genuine `ErrorCode` union member (checked with `isErrorCode`).

**(c-wire)** real `WsRpcServer` + real `WsRpcClient` (TCP WS) with the **real** `registerVoiceRealtimeHandlers`; `timeout 150 bun run /tmp/v7/cf-rpc-e2e.ts`:
```
voice:providers -> {"realtime":[{"id":"openai",...,"configured":true,...}],"speech":[]}
voice:talkStart(provider=ghost) -> code=unknown-provider msg="Unknown realtime voice provider: ghost"
voice:ttsStreamStart(provider=ghost) -> code=unknown-provider msg="Unknown speech provider: ghost"
voice:talkStart() unconfigured -> code=unconfigured msg="No realtime voice provider is configured on this server"
unconfigured code is real ErrorCode member -> true
```
The typed code survives the wire intact (`isErrorCode` gating in `transport/server.ts:1396` → `client.ts` re-attaches `err.code`); it never collapsed to `HANDLER_ERROR`, and `talkStart` threw instead of returning a fabricated session. `unconfigured` / `unknown-provider` / `unsupported` are literal members of the `ErrorCode` union (`packages/shared/src/protocol/types.ts:138-140`).

**Verdict (c): PASS.**

---

## (d) Bounded queue overflow policy (320 chunks / 1 MiB)

**Command:** `timeout 120 bun run /tmp/v7/cd-queue-wake.ts` (real `createRealtimeVoiceAudioQueue` with production defaults):
```
(d) defaults: maxChunks=320 maxBytes=1048576 ttlMs=1800000
(d) chunk-cap overflow: size=320 droppedChunks=1 bytes=320
(d) drain first byte=2 last byte=65 count=320   (oldest evicted => first should be 2)
(d) byte-cap overflow: 64KiB*20 -> size=16 bytes=1048576 droppedChunks=4 accepted=20
(d) oversized frame: result={"accepted":false,"dropped":0,"reason":"chunk-too-large"} queue size before=1 after=1 firstAccepted={"accepted":true,"dropped":0}
```
**Documented policy on overflow = drop-oldest.** When either cap is exceeded the oldest frames are evicted (and counted in `droppedChunks`/`droppedBytes`) until the new frame fits; a single frame larger than the whole byte budget is **rejected outright** (`reason: 'chunk-too-large'`) without flushing the queue. Chunk cap: 321 in → 320 kept, byte `1` evicted (drain starts at `2`). Byte cap: 20 × 64 KiB → 16 kept = exactly 1 MiB, 4 oldest evicted. TTL default 30 min (`prune` on drain).

**Verdict (d): PASS** — behaviour matches the module's documented policy.

---

## (e) STT relay reconnects after a fixture disconnect without duplicating/dropping queued frames

**Command:** `timeout 120 bun run /tmp/v7/e-stt-reconnect.ts` — real `createRealtimeTranscriptionSession` with the real `openGlobalWebSocket` opener against the WS fixture; the fixture connection is dropped only after the client observed the close (`isConnected() === false`).
```
(e) live send conn0 appends=[[1,2]]
(e) close observed (isConnected false) = true
(e) queued during drop: {"chunks":3,"bytes":6,"droppedChunks":0} isConnected=false
(e) reconnect=true connections=2 queuedAfter={"chunks":0,"bytes":0,"droppedChunks":0}
(e) conn1 handshake=session.update
(e) conn1 appends (queued, in order, once)=[[3],[4,4],[5,5,5]]
(e) events=["ready","close:socket closed (1005)","ready"]
(e) all appends across connections=["[1,2]","[3]","[4,4]","[5,5,5]"]
```
Three frames queued while in `retry-wait` were flushed on the reconnect socket in their original order, **exactly once** (queue empty afterwards, no frame repeated). Across both connections the union of frames is `[1,2] + [3,4,4,5,5,5]` — no drop, no duplication.

**Boundary note (not a claim failure):** in a first run the frames were sent in the window *after* the fixture closed the peer but *before* the client processed the close event (`isConnected()` still `true`); the library treats the socket as open and those frames were lost on the wire rather than queued. This is intrinsic socket semantics (queueing only begins once the relay observes the close), recorded here so it is not mistaken for the tested path.

**Verdict (e): PASS** (for frames queued while the relay is in `retry-wait`).

---

## (f) Wake list limits + RPC path end-to-end

**Module limits** (`/tmp/v7/cd-queue-wake.ts`):
```
(f) 33 triggers -> count=32 dropped=1 maxAllowed=32
(f) 200-unit trigger -> normalized length=64 maxUnits=64
(f) surrogate-stress -> units=64 lastIsHighSurrogate=false
(f) case-insensitive dedupe -> triggers=["Rox"] dropped=2
(f) mixed 35 -> count=32 dropped=3
```
≤32 triggers enforced; each normalised to ≤64 UTF-16 code units; the 64-unit clamp never ends on a lone high surrogate (surrogate-stress input of 40 emoji → 64 units, last not a high surrogate); case-insensitive NFC de-dup keeps the first spelling.

**RPC path over the real server** (`/tmp/v7/cf-rpc-e2e.ts`, real `WsRpcServer` + `WsRpcClient` + real `registerVoiceRealtimeHandlers`, local-binding auth):
```
voice:wakeSet(35 names incl dupes) -> {"enabled":true,"names":["trigger-0",...,"trigger-31"]}
voice:wakeGet -> {"enabled":true,"names":["trigger-0",...,"trigger-31"]}
voice:wakeSet(200-unit name) -> units=64
```
`voice:wakeSet` accepted 35 names (incl. `Rox`/`ROX` dupes) and persisted/returned a capped, de-duplicated 32-item list; `voice:wakeGet` round-tripped the same list over the wire.

**Transport caveat:** this used a real `WsRpcServer` (real TCP WebSocket, real protocol codec, real handler registration) with a `resolveLocalClientBinding` local-client binding, because the `voice:*` handlers are gated `nativeOrLocalElectron` and the full production daemon (`bun run server:start`) needs an authority/config bootstrap. The wire path — handshake, envelope codec, handler dispatch, access gate — is the production one; only the binding source was synthetic.

**Verdict (f): PASS** (module limits + RPC path reachable end-to-end).

---

## Summary

| Claim | Verdict | Surface |
|---|---|---|
| (a) ordered chunks through bridge + monotonic sequencer/reorder buffer | **PASS** | real WS fixture; reorder buffer in-process |
| (b) socket-bound handlers, no cross-talk | **PASS** | two real WS sessions + superseded-socket replay |
| (c) typed wire error codes, no fake provider | **PASS** | real `WsRpcServer`/`WsRpcClient` round-trip |
| (d) bounded queue (320 / 1 MiB) drop-oldest policy | **PASS** | real queue module, production defaults |
| (e) STT relay reconnect, no dup/drop of queued frames | **PASS** | real WS fixture disconnect |
| (f) wake list ≤32 / ≤64 + `voice:wakeGet`/`wakeSet` RPC | **PASS** | module + real RPC transport |

No FAILs. One documented non-claim boundary under (e) (frames written between peer-close and client close-observation are lost, not queued).