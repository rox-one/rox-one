# V11 — host scheduler + hooks runtime verification (port row f.8)

Targets: `packages/server-core/src/scheduler/scheduler.ts`, `.../cron-expr.ts`, `.../hooks.ts`,
`packages/server-core/src/bootstrap/headless-start.ts`.
Verifier: `w2-verify-3`. Date: 2026-10-09. Tree: `rox-one-port` @ `cfb1f1b8d` (main tip; no repo files edited).

## Surface driven (real process / real host timers / real listening server)

The scheduler is exercised through the **real module** imported into a real `bun` process and
driven by the **real host clock** — `HostScheduler()` with no `clock` option, i.e. the default
`hostClock` whose `arm` is a real `setTimeout` (`scheduler.ts:37-45`). No fake clock, no unit-test
seam, no mock timer. Harness: `/tmp/w2v3/sched-runtime.ts` (scratch, outside the repo).

```
$ cd /tmp/w2v3 && timeout 200 bun sched-runtime.ts
$ cd /tmp/w2v3 && timeout 30  bun reject.ts        # satisfiability edge cases
```

The bootstrap target is driven as a **real listening server** (entry `packages/server/src/index.ts`
→ `bootstrapServer`, `headless-start.ts:466-724`), bound to `ws://127.0.0.1:19021` with an isolated
`ROX_CONFIG_DIR=/tmp/w2v3/state`; no repo files touched.

```
$ ROX_CONFIG_DIR=/tmp/w2v3/state CRAFT_SERVER_TOKEN=w2v3-token-0123456789abcdef0123456789ab \
  CRAFT_RPC_PORT=19021 CRAFT_RPC_HOST=127.0.0.1 CRAFT_DISABLE_MESSAGING=true \
  CRAFT_BROWSER_BACKEND=none CRAFT_PRINT_TOKEN=1 CRAFT_VERSION=0.0.0-w2v3 \
  timeout 90 bun run server:start > /tmp/w2v3/server.log 2>&1 &
```

---

## (a) `once` fires on the real timer — **PASS**

```
ONCE fired=1 lateMs=10 kind=once missed=0
ctx {"id":"once-a","kind":"once","missed":0,"scheduledAtMs":1791552550677,"firedAtMs":1791552550684}
```

`delayMs:120` fired 10 ms late (real `setTimeout` jitter), `kind='once'`, `missed=0`. A second
`scheduleOnce` reusing the same id (`once-a`) fired, proving the one-shot was de-registered after
its run (`scheduler.ts:327-329`). Verdict: **PASS**.

## (b) `every` is drift-free / anchor-stable across many real ticks — **PASS**

`everyMs:100`, run for ~3.2 s (21 ticks), induced missed ticks in the middle (see (c)). Everything
lands on one grid:

```
EVERY offGrid=0
EVERY deltas=[100,100,100,100,500,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100]
EVERY scheduled=[...551844, 551944, 552044, 552144, 552244, 552744, 552844, ... 553244]
                        (anchor0 = 1791552550844)
```

Every `scheduledAtMs` is `anchor0 + k*100` exactly (`offGrid=0`); the only delta ≠ 100 is the single
`500` at the induced stall, after which the grid resumes with **no residual drift** —
`advance()` recomputes `nextMs = anchor + safeElapsed*period` from the original anchor, never from
the (late) fire time (`scheduler.ts:289-299`). Verdict: **PASS**.

## (c) missed ticks coalesce into ONE catch-up run — **PASS**

Event loop was blocked synchronously for 560 ms (≈5 periods of the 100 ms `every` job) mid-run:

```
EVERY ticks=21 beforeBlock=5 caughtUpAfterBlock=2 missedRuns=1
EVERY missedValues=[4]
missedRuns=[{"missed":4,"scheduledAtMs":1791552551744}]
```

Exactly **one** run had `missed>0` (missed=4): the 4 skipped instants `1344/1444/1544/1644` were
collapsed into a single run at `1744`, not replayed as 4 runs. `advance()` computes `missed` once per
wake; `wake()` collects each due job at most once per timer fire (`scheduler.ts:300-341`). Verdict: **PASS**.

## (d) `cron` fires on a real UTC minute boundary — **PASS**

Cron granularity is one minute by design (`cron-expr.ts` — 5-field, `nextAfter` aligns to a UTC minute),
so a sub-second cron is not expressible; the real cadence was observed instead. `* * * * *`:

```
CRON fired=1 waitedMs=46274 minuteAligned=true latenessMs=3
CRON ctx={"id":"cron-a","kind":"cron","missed":0,"scheduledAtMs":1791552600000,"firedAtMs":1791552600003}
```

`scheduledAtMs % 60_000 === 0` (real UTC minute boundary), fired 3 ms late on the host timer.
Verdict: **PASS**.

## (e) `0 0 30 2 *` rejected at registration with `NO_MATCH` — **PASS**

Registration is the only entry (`registerCron` parses eagerly, `scheduler.ts:187-199`), so the
unsatisfiable expression throws `CronExpressionError` before any timer is armed:

```
$ bun reject.ts
0 0 30 2 * => NO_MATCH
0 0 31 4 * => NO_MATCH
0 0 31 2 * => NO_MATCH
0 0 29 2 * => ACCEPTED        # Feb 29 is a valid leap date → satisfiable (control)
0 0 30 4 * => ACCEPTED        # Apr 30 valid → satisfiable (control)
0 0 * * 7  => ACCEPTED        # dow-restricted → always satisfiable (control)
```

`0 0 30 2 *`: code `NO_MATCH`, message `cron "0 0 30 2 *" can never fire: day-of-month/month pair is
not a valid calendar date and day-of-week is unrestricted`. Rejection lives in `isSatisfiable`
(`cron-expr.ts:234-243`) called from `parseCronExpression` (`:258-263`); the `nextAfter` 5-year scan
carries a `NO_MATCH` backstop (`:220`). The controls confirm the check is calendar-aware (leap
Feb 29 accepted), not a blanket reject. Verdict: **PASS**.

## (f) malformed expressions cannot crash the loop — **PASS**

```
REJECT={"nope":{"code":"INVALID_FIELD_COUNT",...},"x y z t v":{"code":"INVALID_FIELD_SYNTAX","field":"minute",...},
        "1 2 3":{"code":"INVALID_FIELD_COUNT",...},"60 * * * *":{"code":"OUT_OF_RANGE",...}}
REJECT loopStillFired=true schedulerClosedPreStop=false
```

`nope` / `1 2 3` → `INVALID_FIELD_COUNT`; `x y z t v` → `INVALID_FIELD_SYNTAX` (field `minute`);
`60 * * * *` → `OUT_OF_RANGE`. All are thrown (not swallowed), the scheduler is left **unclosed**
(`schedulerClosedPreStop=false`), and after the noise a fresh `scheduleOnce` still fired
(`loopStillFired=true`). Parse errors are thrown synchronously and never enter the arm/wake loop
(`scheduler.ts:187-199`; parse failures throw before `register`). Verdict: **PASS**.

## (g) hooks: ordered, isolated, exactly-once dispose — **PASS**

Four listeners on `ev`, the 3rd throwing:

```
HOOKS order=["h1","h2","h3-throws","h4"] invoked=4 failures=1 failIdx=[2]
HOOKS ctx0={"p":{"x":1},"c":{"event":"ev","sequence":0}}
HOOKS disposeFirst=true disposeSecond=false countAfter=0
HOOKS tickOrder=["hook","run"]
```

- **Ordered**: `h1,h2,h3-throws,h4` — registration order, awaited sequentially (`hooks.ts:82-101`).
- **Throw isolated**: `h3-throws` failed (`failIdx=[2]`) yet `h4` still ran and `emit` resolved
  (`invoked=4`); failures are collected, not rethrown (`:96-99`).
- **Dispose exactly once**: the disposer returned `true` on the first call and `false` on the second;
  `listenerCount('disp')` → `0` (`off` returns whether it removed one, `:48-66`).
- **Same tick**: a job with `event:'tick'` dispatched the hook **before** the job body in one tick
  (`tickOrder=["hook","run"]`, `scheduler.ts:351-363`).

Verdict: **PASS**.

## (h) `beginClose()`/`stop()` drains in-flight work and refuses new registrations — **PASS**

A `once` job whose callback awaits a gate was in flight when close was requested:

```
CLOSE entered=true settledWhileRunning=false stopSettledAfterRelease=true finished=true
CLOSE refusedRegistration=SchedulerError:ALREADY_CLOSED:late: scheduler is closed
```

- `beginClose()` while the callback was running: `stop()` did **not** settle within 200 ms
  (`settledWhileRunning=false`) → it joins the in-flight promise (`scheduler.ts:227-232`).
- After the gate released, the callback completed and `stop()` settled (`stopSettledAfterRelease=true`,
  `finished=true`); a second `stop()` returned immediately (idempotent).
- A registration attempted after close threw `SchedulerError` code `ALREADY_CLOSED`
  (`scheduler.ts:244-246`).

Verdict: **PASS**.

## (i) bootstrap wiring (headless-start) — **PASS**

Real listening server, isolated state dir:

```
INFO [bootstrap] Config artifacts initialized
INFO [bootstrap] Initialized missing global config
INFO Rox server listening on ws://127.0.0.1:19021
CRAFT_SERVER_URL=ws://127.0.0.1:19021
INFO [bootstrap] Toolchain ensureAll scheduled
... (SIGTERM) ...
INFO  Shutting down...
```

`bootstrapServer` constructs the `HostScheduler` (`headless-start.ts:498-502`) and exposes it on
`ServerInstance.scheduler` (`:709`); `stop()` calls `scheduler.beginClose()` then
`await scheduler.stop()` **before** tearing subsystems down (`:641-646`). The real process booted to
`listening` and, on shutdown, logged `Shutting down...` and exited 0 with **no `[scheduler]` error
line** (the only path the bootstrap logger surfaces) — the scheduler entry/close/stop wiring is live
and does not break startup or shutdown. The drain semantics themselves are proven in (h).
`lsof -iTCP:19021 -sTCP:LISTEN` empty afterwards; `pgrep -f packages/server/src/index.ts` empty.
Verdict: **PASS**.

---

## Result

| claim | verdict |
|---|---|
| `once` fires (real timer) | PASS |
| `every` drift-free / anchor-stable over 21 ticks | PASS |
| missed ticks coalesce into ONE catch-up run (`missed=4`) | PASS |
| `cron` fires on a real UTC minute boundary | PASS |
| `0 0 30 2 *` rejected at registration with `NO_MATCH` | PASS |
| malformed cron cannot crash the loop | PASS |
| hooks ordered, throw-isolated, dispose exactly once | PASS |
| `beginClose`/`stop` drains in-flight, refuses new registrations | PASS |
| bootstrap constructs + closes the scheduler | PASS |

No FAILs. Note: cron has **minute** resolution by design, so a "sub-second cron" is not expressible —
`once`/`every` covered the sub-second cadence and `cron` was observed across a real minute boundary.