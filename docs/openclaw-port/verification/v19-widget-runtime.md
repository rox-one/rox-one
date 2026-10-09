# V19 — board widget lifecycle runtime verification (slice b2.3 + b2.5)

Rows: **b2.3** (widget store + render tickets + `board:widget*` RPC + `show_widget`),
**b2.5** (canvas document wrap + sandboxed frame rendering).
Targets exercised: `packages/server-core/src/board/{widget-store.ts,widget-tickets.ts,tool-callbacks.ts}`,
`packages/server-core/src/handlers/rpc/board.ts`, `packages/session-tools-core/src/handlers/show-widget.ts`,
`apps/electron/src/renderer/components/board/{WidgetFrame,WidgetCard}.tsx`,
`packages/shared/src/widgets/wrap.ts`, `apps/electron/src/transport/channel-map.ts`.

Verifier: `w3-verify-2`. Date: 2026-10-09. Tree: `/Users/t/Projects/rox-w3-int` (branch `port/w3-int`),
`git rev-parse --short HEAD` = **`98e1e5cc4`**. Real installed `node_modules` (no install run).
Platform: darwin 27.0.0 arm64 · bun 1.4.2 · node v26.8.2 · playwright 1.64.0 (chromium 1248).

Two real-process harnesses were driven (scratch in `/tmp/w3v19/`, nothing in the repo edited):

- **`drive.ts`** — boots a real `WsRpcServer` (real `NativeAuthority`, real TCP WebSocket) and a real
  `WsRpcClient`, and drives the frozen `board:*` RPC surface against the real on-disk `WidgetStore`.
- **`render.tsx`/`render.mjs`** — bundles the **real** `WidgetFrame.tsx` (bun build → `frame.js`) and
  renders it in **real Chromium** inside a host page carrying the **app renderer's exact CSP** from
  `apps/electron/src/renderer/index.html`.

```
# 1. RPC + store + ticket registry
$ cd /Users/t/Projects/rox-w3-int
$ ROX_CONFIG_DIR=/tmp/w3v19/state CRAFT_CONFIG_DIR=/tmp/w3v19/state bun /tmp/w3v19/drive.ts
  -> DRIVE_OK, transcript at /tmp/w3v19/transcript.json

# 2. real Chromium render of the leased document
$ cd /tmp/w3v19 && NODE_ENV=production bun build frame-entry.tsx --outfile frame.js --target browser --production
$ cd /Users/t/Projects/rox-w3-int && node /tmp/w3v19/render.mjs
  -> RENDER_DONE, transcript at /tmp/w3v19/render-transcript.json
```

The RPC surface is singleton-consistent by construction: both the RPC handler and the tool callbacks
build a `WidgetStore(workspace.rootPath, …)` and share `widgetTicketRegistryFor(workspace.rootPath)`,
a module-level `Map` keyed by root path (`widget-tickets.ts:177-186`). The in-process `registry`
handle used below is therefore the **same instance** the server handlers used over the wire
(confirmed by the shared generation counter, step `old_ticket`: `generation:2`).

---

## (1) put → mount: bridge bytes precede widget code, sha256 readback matches — **PASS**

`board:widgetPut` `chart` (html) → `board:widgetMount` `chart`:

```json
[step] put.html    {"widgetId":"chart","name":"chart","revision":1}
[step] disk.readback {
  "html_sha256":"a38d5642bedd92d928bf77aaa2dbc79dd7fe08466fb557dc435fc286161c79bc",
  "record_sha256":"a38d5642bedd92d928bf77aaa2dbc79dd7fe08466fb557dc435fc286161c79bc",
  "match":true,
  "equals_expected_wrap":true,
  "bridge_offset":700, "widget_code_offset":1375, "bridge_before_code":true,
  "record":{"widgetId":"chart","name":"chart","kind":"html","revision":1,
            "sha256":"a38d5642…c79bc","createdBy":"cdc7b296-…","createdAt":"2026-10-09T15:53:04.748Z"} }
[step] mount.v1 {"revision":1,"ticket_len":32,
  "content_sha256":"a38d5642…c79bc","content_matches_disk":true,"bridge_before_code":true}
```

Three independent digests agree: sha256(index.html on disk) == `widget.json.sha256` == sha256(mounted
content), and the stored bytes are byte-identical to `buildWidgetDocument(...)`. The bridge global
`roxWidgetBridge` (offset 700) precedes the widget code `widget-marker` (offset 1375) by construction
(`wrap.ts:104-` emits `bridgeBootstrap` then `sizeReporter` then `widgetCode`). Verdict: **PASS**.

## (2) re-put is a NEW revision; the OLD ticket is refused, a fresh mount works — **PASS (with a caveat, see §9)**

```json
[step] put.reput  {"widgetId":"chart","name":"chart","revision":2,"disk_sha_after":"2b06d0ec…9e0f2"}
[step] old_ticket {"registry_validate":{"code":"WIDGET_TICKET_REFUSED","message":"Widget ticket refused"},
                   "rpc_release":{"released":false},"generation":2}
[step] mount.fresh {"revision":2,"new_validate":{"ok":true},"content_has_v2":true}
```

The re-put rotated the widget's view generation to 2 through the RPC path (`board.ts:71`
`tickets.rotate(record.widgetId)`; the rotate ran in the same registry instance — `generation:2`), the
old nonce no longer validates (`WIDGET_TICKET_REFUSED`), and `board:widgetRelease` for the dead ticket
reports `released:false`. A fresh `board:widgetMount` mints a new ticket on revision 2 and that ticket
validates. Verdict: **PASS**.

## (3) release → the ticket stops validating — **PASS**

```json
[step] release.validates {"valid_before":true,"rpc_release":{"released":true},
                          "size_before":128,"size_after":127,
                          "valid_after":{"code":"WIDGET_TICKET_REFUSED","message":"Widget ticket refused"}}
```

One `board:widgetRelease` with the live nonce flipped `released:true`, shrank the live registry by
exactly one, and made the same nonce refuse. Verdict: **PASS**.

## (4) a2ui payload → typed `UNSUPPORTED_WIDGET_KIND`, NOTHING written — **PASS**

```json
[step] a2ui.refusal {"error":{"code":"UNSUPPORTED_WIDGET_KIND","message":"Request failed"},
                     "dir_before":false,"dir_after":false,"store_read":null}
```

`board:widgetPut` with `kind:"a2ui"` and a well-formed v0.9 stream is refused with the typed code
(`widget-store.ts:209-219` validates the stream first, then throws before any write). `board/widgets/a2uiw`
does not exist after the call and `WidgetStore.read('a2uiw')` returns `null`. Nothing is written.
Verdict: **PASS**.

## (5) traversal name + oversize payload → typed refusals, nothing written — **PASS**

```json
[step] refusals {"traversal":{"code":"INVALID_PAYLOAD","message":"Request failed"},
                 "oversize":{"code":"INVALID_PAYLOAD","message":"Request failed"},
                 "evil_dir":false,"big_dir":false}
```

`name:"../evil"` is rejected by `WIDGET_NAME_PATTERN` (`widget-store.ts:67,133`) and a 520 KiB source
(> `MAX_WIDGET_SOURCE_BYTES` = 512 KiB, `widget-store.ts:221`) is rejected, both typed `INVALID_PAYLOAD`.
Neither created a directory (`board/evil` absent; `board/widgets/big` absent). Verdict: **PASS**.

## (6) the ticket store stays bounded under >N mounts — **PASS**

```json
[step] bounded {"mounts":300,"registry_size":128,"first_ticket_still_valid":false}
```

300 real `board:widgetMount` calls left the live registry at exactly **128** (`DEFAULT_MAX_TICKETS`,
`widget-tickets.ts:32,99-105`): the oldest ticket was evicted once the cap was reached, and the very
first ticket no longer validates. Verdict: **PASS**.

## (7) real Chromium: sandbox attr, opaque origin, same-frame-only messages — **PASS**

Real `WidgetFrame` (bundled from source) rendered in Chromium under the app renderer's CSP.

```json
[step] ok.report {"heights":[18],"sandboxAttr":"allow-scripts","hasFailureChrome":false,
  "messages":[{"origin":"null","sameFrame":true,"type":"rox:widget-bootstrap"},
              {"origin":"null","sameFrame":true,"type":"rox:widget-ready"},
              {"origin":"null","sameFrame":true,"type":"rox:widget-size"}]}
[step] frame.inside {"origin":"null","selfEqualsParent":false,"bridgeGlobal":"object",
                     "bridgeFrozen":true,"bridgePort":"MessagePort"}
[step] accept.rule {"good":42,"foreignSource":null,"selfSource":null,"wrongOrigin":null,
                    "wrongType":null,"bootstrapType":null,"badHeight":null}
[step] forgery {"beforeLen":1,"afterHeights":[18],"sizeMessagesSameFrameFlags":[true,false]}
```

- `sandbox` attribute is **exactly** `allow-scripts` (`WidgetFrame.tsx:175`); no `allow-same-origin`.
- Inside the frame document `window.origin === "null"` and `window.parent !== window` → **opaque origin**;
  the host observed every message with `event.origin === "null"` and `source === frame.contentWindow`.
- The real bridge global `roxWidgetBridge` is installed, **frozen**, carrying a `MessagePort`.
- Accept rule (`WidgetFrame.tsx:88-95`): a same-frame `rox:widget-size` returns `42`; a foreign/`null`
  source, the host window itself, a wrong origin (`https://evil.example`), `ready`, the MessagePort-
  bearing `bootstrap`, and a non-positive height all return `null` — dropped before state.
- Live forgery: the host posting a size-shaped message **from itself** was seen (`sameFrame:false`) but
  did **not** change `heights` (still `[18]`).

Verdict: **PASS**.

## (8) a throwing widget → typed fallback chrome — **PASS**

A leased document whose widget code throws and detaches `document.body` (so the wrap's size reporter
never fires) settled to the frame's typed failure chrome, not a silent blank box:

```json
[step] throw.fallback {"failureCode":"runtime-error","role":"alert","hasIframe":false,
                       "reportedHeights":[],"throwMessages":0}
```

After `renderTimeoutMs = 1000`, `[data-testid="widget-frame-failure"]` appeared with
`data-failure-code="runtime-error"`, `role="alert"`, the iframe was replaced, and **zero** size
messages were accepted from that frame (`WidgetFrame.tsx:117-119,144-166`). Verdict: **PASS**.

## (9) `show_widget` writes through the SAME store (one writer) — **PASS**

Driven via `buildBoardWidgetToolCallbacks(...).putWidget(...)` — the exact object `SessionManager`
injects as `ctx.boardWidgets.putWidget` (`SessionManager.ts:5923-5936`), which `handleShowWidget`
calls (`show-widget.ts:46`). The RPC surface then reads the same bytes:

```json
[step] one_writer {
  "tool_record1":{"widgetId":"toolded","name":"toolded","kind":"html","revision":1,
                  "sha256":"b2e60a53…ae41","createdAt":"2026-10-09T15:53:07.028Z"},
  "tool_disk_sha_match":true,
  "rpc_mount_revision":1, "rpc_mount_content_matches_tool_disk":true,
  "tool_record2_revision":2, "rpc_mount2_revision":2, "rpc_mount2_has_v2":true }
```

The tool's `putWidget` wrote `board/widgets/toolded/index.html` (tool record sha == on-disk sha), and a
real `board:widgetMount` returned content **byte-identical** to that file at revision 1; a second tool
put produced revision 2 and the next RPC mount returned revision 2 with the v2 marker. There is exactly
one writer: neither `tool-callbacks.ts` nor `board.ts` re-implements the store, both call
`WidgetStore.put`. Verdict: **PASS**.

### Caveat for §9
`handleShowWidget` itself was not driven through a live session tool-callback registry; the callback
`putWidget` it calls was driven directly, and `SessionManager` wiring was read (not executed). The
store/serialization seam is identical, but the `name/title/widget_code` trimming path in
`show-widget.ts:41-52` was not exercised at runtime.

---

## Defect / limitation found

### D1 — the frame's message bridge carries no ticket, and the renderer's mount path never validates

The frame's message bridge handles **only** the size report. `parseWidgetFrameMessage` accepts a
same-frame `rox:widget-size` whose `type`/`height` are own properties and returns a clamped height
(`WidgetFrame.tsx:88-96`); its payload carries **no** `widgetId`, `ticket`, or `nonce` field — so
"refuse a bad ticket" is **not** a bridge function. The bridge never sees a ticket at all, and
`WidgetFrame.tsx` deliberately never opens the bootstrap `MessagePort` (`WidgetFrame.tsx:19-27`), so
no privileged channel is ever established.

Ticket validation is a **separate RPC**: `board:widgetValidate` (`channels.ts:1167`; handler
`handlers/rpc/board.ts:111-119` calls `tickets.validate({ nonce, widgetId, revision })`), which
raises the one uniform typed refusal `WIDGET_TICKET_REFUSED` for unknown / expired /
stale-after-re-put tickets. It is reachable over the real wire (proved by
`board/__tests__/widget-ticket-enforcement.test.ts`), but **the renderer's mount path does not call
it**: `WidgetCard.tsx` mints a fresh nonce with `board:widgetMount` and releases it with
`board:widgetRelease` on unmount / ticket change (`WidgetCard.tsx:109`) — it never calls
`board:widgetValidate`. So over the app's own renderer path a stale/forged nonce is still never
actually consumed; `board:widgetValidate` makes the refusal *reachable*, but the product mount path
does not yet exercise it.

Consequence: over the RPC surface, "the OLD ticket is refused" is observable as
`board:widgetRelease → {released:false}` (§2) or a direct `board:widgetValidate` refusal; the typed
`WIDGET_TICKET_REFUSED` is uniform across every refusal cause.

_Not a defect:_ the wire replaces every refused handler's human message with `Request failed`
(`transport/server.ts:1455`, deliberate for native/principal callers); the **typed code**
(`UNSUPPORTED_WIDGET_KIND`, `INVALID_PAYLOAD`, `WIDGET_TICKET_REFUSED`) survives intact, which is what
the client switches on.

### D2 — size frame had no upper bound and accepted prototype-inherited fields (fixed in this PR)

Two defects found by the adversarial probes and fixed in the wave-3 verification-fixes PR:

- **No upper clamp.** The size parser accepted a finite height straight through — a widget could
  report `1e308` and force the host box to an arbitrary, unusable height (layout DoS). Now a finite
  height is clamped: `Math.min(height, MAX_WIDGET_FRAME_HEIGHT_PX)` (= 8192) (`WidgetFrame.tsx:75,95`).
- **Prototype-inherited `type`/`height` accepted.** A payload inheriting `type`/`height` from its
  prototype (not own properties) was treated as a wire message. Now the parser requires
  `Object.hasOwn(data, 'type') && Object.hasOwn(data, 'height')` (`WidgetFrame.tsx:90`).

### D3 — widget store intermediate-symlink escape (fixed in this PR)

A `root/board` **symlink** let a write escape the workspace root: a `board/...` path resolved
outside the root through the link and wrote there. Fixed in the wave-3 verification-fixes PR —
`checkPath` now lstat-walks every **existing** component from the root down and denies any symlink
component (leaf or intermediate), and `mkdir` is done one level at a time with a post-`mkdir` lstat
to close the race (`widget-store.ts:149-215`).

---

## Verdict

Every row-b2.3/b2.5 behaviour asked for by the ticket is reproduced against real processes, real WS RPC,
real files and real Chromium: put/mount digest + ordering, re-put revision + old-ticket death + fresh
mount, a2ui typed refusal with no write, traversal/oversize typed refusals, release-driven
de-validation, bounded ticket store (300 mounts → 128), and the sandboxed frame posture (exactly
`allow-scripts`, opaque `null` origin, same-frame-only messages, throwing-widget fallback chrome), plus
`show_widget` writing through the single shared store. With the §9 caveat and the D1 limitation noted:
**PASS.**

## Unproven / not tested

- **`handleShowWidget` end-to-end** through a live session callback registry (see §9 caveat).
- **`WidgetCard.tsx` refusal/remount state machine** (stale-ticket retry-once, `board:changed` re-lease,
  `NOT_FOUND` → unavailable chrome) was not driven in Chromium; only `WidgetFrame` was rendered. The
  upstream RPC behaviours it depends on (`WIDGET_TICKET_REFUSED`, `NOT_FOUND`, `board:changed` push)
  were exercised at the RPC layer.
- **`board:changed` push** was produced on every accepted put (handler `board.ts:72`) but the push
  payload was not asserted in this harness (the sibling `widget-rpc.test.ts` does assert it).
- **No product path validates a ticket** (D1): `board:widgetValidate` exists and is wire-reachable,
  but the renderer's `board:widgetMount`/`board:widgetRelease` path never calls it — the
  revision/generation **fence** is proven at the registry/validate-RPC level, not through the app
  mount path.
- `DEFAULT_MAX_TICKETS`/`leaseTtlMs` are **not configurable over RPC**; the 128 cap and 20-min ceiling
  are code constants, and only the cap was observed (the 20-min TTL was not waited out).
- The `sandbox` CSP directive inside the widget document's `<meta>` is ignored by Chromium (browser
  console: "The CSP directive 'sandbox' is ignored when delivered via a <meta> element") — a known,
  documented wrap behaviour (`wrap.ts` header); the effective sandbox is the iframe `sandbox` attribute,
  which was verified.
- Two-actor / permission isolation on the board surface (a reader may `mount` but not `put`) is covered
  by `widget-rpc.test.ts`, not re-driven here.

---

## Post-verification corrections (adversarial refutation, 2026-10-09)

- **Bridge ≠ ticket check (refuted sub-claim).** The frame bridge consumes only the size report and
  has no `widgetId`/`ticket`/`nonce` field, so ticket refusals are not a bridge function; validation
  is the separate `board:widgetValidate` RPC (uniform `WIDGET_TICKET_REFUSED`), and the renderer's
  mount path issues/releases tickets via `board:widgetMount`/`board:widgetRelease` without calling
  validate (D1 rewritten above).
- **No upper clamp (refuted, fixed in this PR).** A probe fed `height: 1e308` and the parser accepted
  it; now clamped by `MAX_WIDGET_FRAME_HEIGHT_PX` (D2).
- **Prototype-inherited fields (refuted, fixed in this PR).** A payload inheriting `type`/`height`
  from its prototype was accepted; now `Object.hasOwn` is required (D2).
- **Intermediate-symlink escape (refuted, fixed in this PR).** A `root/board` symlink let a write land
  outside the workspace root; the store now lstat-walks every path component and denies any symlink
  (D3).