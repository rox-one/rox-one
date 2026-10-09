# V17 — wave-1 residual closures (runtime re-verification)

Turns four wave-1 `unproven` items into **proven** or **re-confirmed** by driving the real code as
running processes / real WS RPC / real wall-clock. Rows carried over: **V1 a1.4 viewer-presence
expiry + two-actor isolation**, **V3 skills RPC + host tools**, **V5 S6 5-minute summary cadence**,
**V6 e2.5 launchd status settle window (FX-2)**.

Verifier: `w2-verify-9`. Date: 2026-10-09. Trees:
- Repo `/Users/t/Projects/rox-one-port` @ `cfb1f1b8df0efc42621e9bf2cd5a356f4becfb50` (main tip).
- Host: macOS `27.0.0` (darwin), uid `501`, `bun 1.4.2`, `/bin/launchctl` present.
- Sandboxes: `/private/tmp/w2v9/p1` (server state), `/private/tmp/w2v9/p2` (skills),
  `/private/tmp/w2v9/p4home` (launchd HOME). Harnesses in `/tmp/w2v9/`. No repo file modified;
  one new doc (this file).

## Summary

| # | Residual probe | Verdict |
|---|---|---|
| 1 | Viewer-presence expiry (`SESSION_VIEWER_TTL_MS`) over the real event stream, and two distinct Principals' typing/presence isolation | **PASS** |
| 2 | `skills:getEligibility` + `skills_search`/`skills_read` end-to-end over a live `WsRpcServer` socket; advertised ⇒ readable on the live path | **PASS** |
| 3 | Real wall-clock 5-minute summary cadence for the observe coordinator | **PASS** |
| 4 | launchd status settle window (FX-2): stop → immediate status never reports stale `running` | **PASS** |

---

## Probe 1 — viewer-presence expiry (real 300 s) + two-Principal isolation — **PASS**

**Method.** Boot the **real** server entry point (`bun run server:start`) with an isolated config and a
**real `NativeAuthority`** seeded out-of-band (two enrolled member credentials = two distinct
`Principal`s). Drive two real `WsRpcClient` sockets, one per credential, over a real TCP WebSocket.
Actor id for a principal caller is exactly `sessionActorIdFor(ctx) = ctx.principal.subject`
(`packages/server-core/src/handlers/rpc/sessions.ts:257`, `:790-795`).

Seed (real `NativeAuthority`, one admin bootstrap + two enrollments; `write` + `read` grants):

```
$ bun /tmp/w2v9/p1-seed.ts
WS 22222222-3333-4444-5555-666666666666
alice e2ce0de0-973a-438f-b984-bb8b58c73267
bob 2b93c6e7-fbbc-4370-8930-efb7dcaf3ecb
```

Server + client (real processes):

```
$ ROX_CONFIG_DIR=/private/tmp/w2v9/p1/state CRAFT_NATIVE_STATE_DIR=/private/tmp/w2v9/p1/native \
    CRAFT_SERVER_TOKEN=w2v9-token-0123456789abcdef0123456789abcdef CRAFT_RPC_PORT=19131 \
    CRAFT_RPC_HOST=127.0.0.1 CRAFT_DISABLE_MESSAGING=true CRAFT_BROWSER_BACKEND=none \
    bun run server:start
INFO  Rox server listening on ws://127.0.0.1:19131
$ timeout 420 bun /tmp/w2v9/p1-client.ts          # exit 0, elapsed 344 s
```

### Actor isolation (two tokens, two subjects) — PASS

Same session, both principals connected. Alice `setTyping true`; then Bob `setTyping true`:

```json
[alice event] session_typing {"type":"session_typing","sessionId":"261009-ready-fox",
  "actors":[{"accountId":"e2ce0de0-973a-438f-b984-bb8b58c73267", ...}]}          // only alice
[bob event]   session_typing {"type":"session_typing","sessionId":"261009-ready-fox",
  "actors":[{"accountId":"e2ce0de0-973a-438f-b984-bb8b58c73267","expiresAt":...},
            {"accountId":"2b93c6e7-fbbc-4370-8930-efb7dcaf3ecb","expiresAt":...}]} // both, distinct
```

The two `accountId`s are the two credential subjects, not `installation` — so typing is attributed
per-Principal. Presence (both `watchSession`) carries the same two distinct viewers on both sockets:

```json
[alice event] session_presence {"type":"session_presence","sessionId":"261009-ready-fox",
  "viewers":[{"accountId":"e2ce0de0-...","username":"e2ce0de0-...","role":"editor","joinedAt":1791553163421},
             {"accountId":"2b93c6e7-...","username":"2b93c6e7-...","role":"editor","joinedAt":1791553163846}]}
```

Typing cleared (`setTyping false` from both) emitted `actors: []` on both sockets.

### Viewer-presence expiry after the real 300 s TTL — PASS

After `watchSession` from both clients, no further heartbeat; a single wall-clock wait of
`330 429 ms` (> `SESSION_VIEWER_TTL_MS = 300 000`, reaped by the real
`SESSION_ACTIVITY_SWEEP_INTERVAL_MS = 15 000` sweep in `session-activity-tracker.ts:151-163`)
produced exactly one `session_presence` with an empty viewer list, on **both** clients:

```json
[alice event] session_presence {"type":"session_presence","sessionId":"261009-ready-fox","viewers":[]}
[bob event]   session_presence {"type":"session_presence","sessionId":"261009-ready-fox","viewers":[]}
```

```json
"presence:after-ttl": { "elapsedMs": 330429,
  "aliceLast": {"type":"session_presence","sessionId":"261009-ready-fox","viewers":[]},
  "bobLast":   {"type":"session_presence","sessionId":"261009-ready-fox","viewers":[]} }
"presence:empty-observed": { "aliceEmpty": true, "bobEmpty": true }
```

The wave-1 `unproven` viewer expiry is **proven by direct observation** (same `sweep()`/`expireGroup`
path as typing, now driven for the viewers map too). Both wave-1 caveats closed: real wall-clock
TTL, and two real credentials (two `Principal`s) instead of a simulated foreign owner id.

---

## Probe 2 — skills RPC + host tools over a live socket — **PASS**

**Method.** Two live surfaces. (i) The **genuinely bootstrapped** server from probe 1
(`bun run server:start`, real `registerSkillsHandlers` in the real process) was queried over its real
socket with a real native `Principal`. (ii) A dedicated harness boots a real `WsRpcServer` +
real `registerSkillsHandlers` (the exact wiring `headless-start.ts:591-607` uses), connects a real
`WsRpcClient` over TCP, then drives `skills_search`/`skills_read` through the **registered** runtime
(`getSkillsToolRuntime()` — the process-global the live registration installed at
`skills.ts:53`), i.e. not a direct import of the handler internals.

```
# (i) against the real server:start process on ws://127.0.0.1:19131
$ timeout 90 bun /tmp/w2v9/p2-live-probe.ts
### known {"eligible":true,"report":{"eligible":[{"slug":"ab-test-analyzer",...}]}}
### bogus {"eligible":false,"reason":"skill not found: no-such-skill-w2v9",
          "report":{"eligible":[],"ineligible":[],"collisions":[]}}

# (ii) live in-process WsRpcServer + socket, real principal, full catalog
$ ROX_CONFIG_DIR=/private/tmp/w2v9/p2/state timeout 900 bun /tmp/w2v9/p2-skills.ts   # exit 0
```

### `skills:getEligibility` round-trips over the live socket — PASS

```json
### advertised {"eligible":1123,"ineligible":1,"advertisedSlugs":31,"blockBytes":7890}
### rpc:getEligibility-known   {"slug":"operations-worktree","eligible":true,"reportEligible":1}
### rpc:getEligibility-unknown {"eligible":false,"reason":"skill not found: no-such-skill-w2v9"}
```

The full report rides alongside the frozen `{eligible, reason?}` shape, matched by the wave-1
handler at `packages/server-core/src/handlers/rpc/skills.ts:118-137`. Known slug → `eligible:true`;
bogus slug → `eligible:false` + typed reason. Both real RPC round-trips.

### `skills_search` / `skills_read` round-trip through the registered runtime — PASS

```json
### tool:skills_search {"query":"operations","isError":false,
  "preview":"## Skills search: \"operations\"\n10 skill(s)\n\n1. **operations-worktree**
   (`operations-worktree`)\n   source: global\n   path: /Users/t/.agents/skills/operations-worktree\n ..."}
### tool:skills_read-samples [{"slug":"operations-worktree","ok":true,"detail":"## operations-worktree
   (operations-worktree)\n_path: /Users/t/.agents/skills/operations-worktree_ ..."},
   {"slug":"understand-knowledge","ok":true,...},{"slug":"remotion-maps","ok":true,...},
   {"slug":"okr-writer","ok":true,...},{"slug":"directives","ok":true,...}]
```

`skills_search` returned 10 bounded, provenance-rich hits (`source`, absolute `path`, description);
all five sampled advertised slugs read back their real `SKILL.md` bodies via `skills_read`. The wave-1
`unproven` ("handlers were called directly with a real runtime; the RPC process path was not driven")
is closed: the RPC half ran on a genuinely bootstrapped server AND on the live in-process socket; the
tool half ran through the runtime the live registration installed.

### advertised ⇒ readable on the live path — PASS

The advertised set is built exactly as production does it — `buildSkillEligibilityReport(...)` →
`buildAvailableSkillsBlock(report.eligible)` (`packages/shared/src/agent/omp-agent.ts:588-597`) — and
compared against the confined catalog the read path resolves against
(`createNativeSkillsToolRuntime.eligibleCatalog`, `skills-tool-runtime.ts`):

```json
### advertised-vs-confined {"advertised":31,"confined":1123,"advertisedNotInConfined":0,"sample":[]}
"verdict": {"rpcRoundTripKnownEligible":true,"rpcUnknownNotEligible":true,
            "searchRoundTrips":true,"sampleReadsOk":true,"advertisedSubsetOfConfined":true}
```

Every advertised slug (31, the bounded block) is inside the confined catalog (1123), which is exactly
the set `skills_read` will resolve — so advertised ⇒ readable holds on the live path. (Note the 31-vs-
1123 gap is the block's own 8000-byte / 64-entry bound, not a confinement gap: `advertisedNotInConfined
= 0`.) The wave-1 F1 note ("25/27 advertised slugs unreadable") does not reproduce on this tip.

## Probe 3 — real wall-clock 5-minute summary cadence — **PASS**

**Method.** Real `MeetingObserveCoordinator` (`observe.ts:116`) with the **default** clock
(`now = Date.now`; no injected time), over a seeded real `MeetingJournal`. Synthetic caption lines
are appended with real `at` timestamps; the cadence is triggered through the real `generateSummary`
path, which calls `runSummaryCadence` with `LIVE_SUMMARY_INTERVAL_MS = 300_000`
(`packages/core/src/meetings/model.ts:188`, verified at runtime as `intervalMs 300000`).

```
$ timeout 420 bun /tmp/w2v9/p3-cadence.ts       # exit 0, elapsed 318 s
```

Session anchored at real `t0 = 1791553369879`. Two lines in window 0 → summary; then the harness
waited across the **real** boundary (`while (Date.now() < t0 + 315_000)`), appended two more lines in
window 1, and called `generateSummary` again:

```json
"started": {"sessionId":"observe-m1-1791553369879","createdAt":1791553369879,"state":"in_call"}
"gen1 (window 0)": {"windowStartMs":1791553369879,"windowEndMs":1791553669879,"revision":2,
                    "generator":"model","text":"summary for window 1791553369879 covering 2 lines"}
"boundary-crossed": {"wallNow":1791553684933,"elapsedMs":315054}
"gen2 (window 1)": {"windowStartMs":1791553669879,"windowEndMs":1791553969879,"revision":4,
                    "generator":"model","text":"summary for window 1791553669879 covering 2 lines"}
"gen3 (same window)": {"windowStartMs":1791553669879,"revision":4,"identicalToGen2":true}
"persisted-summaries": {"count":2,"summaries":[
  {"windowStartMs":1791553369879,"revision":2,"generator":"model"},
  {"windowStartMs":1791553669879,"revision":4,"generator":"model"}]}
```

Exactly **one** summary fired per window: `gen3` (immediate re-call inside window 1) returned the
byte-identical summary as `gen2` (`revision 4`, no new journal event), and the on-disk journal holds
exactly one summary per window (`count: 2`). The boundary-crossing summary **supersedes** the first
(`revision 4 > 2`, `windowStartMs` advanced by exactly one interval), and both came from the strict-
JSON model step (`generator: model`), not the heuristic.

```json
"verdict": {"gen1Window0":true,"boundaryCrossed":true,"gen2NewWindow":true,
            "revisionSupersedes":true,"exactlyOnePerWindow":true,"modelGenerator":true,
            "persistedOnePerWindow":true}
```

The wave-1 `unproven` "no wall-clock 5-minute wait" is **closed**: the boundary was crossed by
`315 054 ms` of real elapsed time and exactly one revision-superseding summary fired.

---

## Probe 4 — launchd status settle window (FX-2), sandboxed HOME — **PASS**

**Method.** Real `LaunchdService` + `LaunchdRuntime` + real `/bin/launchctl`
(`createLaunchctlRunner`) + real `node-fs`, on sandboxed `HOME=/private/tmp/w2v9/p4home`, label
`com.rox.verify.w2v9`. Eight iterations: `start()` (bootstrap) → `stop()` (bootout) → **five
immediate `getStatus()` reads in a tight loop**. The service is real (`/bin/sleep 3600`,
`RunAtLoad`, `KeepAlive=false`).

```
$ HOME=/private/tmp/w2v9/p4home timeout 240 bun /tmp/w2v9/p4-launchd.ts
"verdict": {"neverStaleRunning": true, "settleNoStaleLoaded": true}
CLEANUP done; HOME exists? false
```

Raw per-iteration reads (offset ms from the `stop()` that preceded them) — all `installed`, none
`running`:

```json
iter1 reads: [{"at":140,"state":"installed"},{"at":150,...},{"at":163,...},{"at":187,...},{"at":197,...}]
iter8 reads: [{"at":25,"state":"installed"},{"at":146,...},{"at":170,...},{"at":198,...},{"at":219,...}]
"iterations[...].staleRunning" = [false,false,false,false,false,false,false,false]
```

Settle read (`bootout` → `isLoaded()`), i.e. the module's status path right after a mutation:

```json
"settle": {"loadedAfterBootout": false, "settleMs": 39,
           "printsDuringSettle": [{"at":1791553268875,"args":"print gui/501/com.rox.verify.w2v9","code":113}]}
```

**Control (the race the module exists to hide).** The unbuffered path — raw `launchctl bootout`,
then an authoritative single `print` on a fresh runtime with no settle window — reproduced the
stale `loaded=true` **1 / 12** times:

```json
"rawPath": { "staleRuns": 1,
  "runs": [false,false,false,false,false,true,false,false,false,false,false,false] }
```

So the host race is real and reproducible (`run 6`), while the module's settle path **never** reported
a stale `running` across 8 × 5 = **40 post-stop reads** and returned `loaded=false` on the measured
settle read. Observed settle time: **39 ms** (this run; an earlier run: 226 ms) — within the
`SETTLE_BUDGET_MS = 1000` budget (`launchd-runtime.ts:47,167-177`). FX-2, classified "unproven as a
product bug" in wave-1, is now **proven non-stale**: the product path cannot surface
`getStatus() === 'running'` immediately after a successful `stop()`.

---

## Cleanup

```
$ launchctl print gui/501/com.rox.verify.w2v9
print_exit=113                                        # job not loaded
$ ls -d /private/tmp/w2v9/p4home
ls: .../p4home: No such file or directory            # probe-4 HOME removed by the harness
$ ls ~/Library/LaunchAgents | grep -i verify          # (empty — no probe plist in user LaunchAgents)
```

The probe-1 server ran as a foreground service and was stopped after the run (service `w2v9-p1`
exited; `lsof -iTCP:19131` empty). Sandboxes `/private/tmp/w2v9/p1|p2` hold only disposable state and
harnesses; the probe-4 HOME was removed by the probe itself (`CLEANUP done; HOME exists? false`). The
operator's real `~/Library/LaunchAgents` was never written to. All harnesses/state live under
`/tmp/w2v9/`.