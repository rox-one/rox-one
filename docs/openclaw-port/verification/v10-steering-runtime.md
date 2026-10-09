# V10 — steering verbs + lanes + transcript fence (f.4 / f.5)

Targets: `packages/server-core/src/sessions/queue-steering.ts`,
`.../transcript-fence.ts`, `.../SessionManager.ts`,
`packages/shared/src/agent/agent-run-registry.ts`,
`packages/shared/src/agent/base-agent.ts`.
Verifier: `w2-verify-2`. Date: 2026-10-09. Tree: `main` @ `cfb1f1b8df0efc42621e9bf2cd5a356f4becfb50`, bun `1.4.2`.

## Surface driven (real classes, real process, real timers, real files)

A single bun process runs the harness `/tmp/w2v10/harness.ts` (scratch, not committed):
the **real** `QueueSteering` lane executor with a slow timing-sensitive runner, the
**real** `SessionManager` (constructed, session injected, real `sendMessage` mid-stream
branch, real `flushSession` writes), the **real** `TranscriptFence` through the
SessionManager's private writer helpers, and the **real** `AgentRunRegistry` /
`BaseAgent.waitForRun`. No mocks replace any substrate under test; only the *agent
backend* is a stand-in (the mid-stream branch only ever calls `redirect()` /
`forceAbort()` on it — see `SessionManager.ts:7661,7698`).

```
$ cd /Users/t/Projects/rox-one-port
$ ROX_CONFIG_DIR=/tmp/w2v10/state timeout 180 bun /tmp/w2v10/harness.ts > /tmp/w2v10/out.log 2>&1   # exit 0
$ cat /tmp/w2v10/lane-transcript.log          # timestamped lane writes
$ cat /tmp/w2v10/result.json                  # full JSON result
$ timeout 150 bun /tmp/w2v10/probe3.ts        # runId correlation
$ timeout 150 bun /tmp/w2v10/probe2.ts        # BaseAgent setup latency
$ timeout  60 bun /tmp/w2v10/probe4.ts        # registry guard behaviour
```

The lane runner writes a timestamped line per transition (`START`/`DRAINED`/`ABORTED`/
`END`) to `/tmp/w2v10/lane-transcript.log`; the SessionManager transcripts are the real
`<workspace>/sessions/<id>/session.jsonl` files under `/tmp/w2v10/ws`.

---

## (1) per-session lane serialization — no interleaving between two concurrent lanes — **PASS** (in `queue-steering.ts`)

Two lanes (`session:A`, `session:B`) each ran a slow task plus a queued successor
concurrently. Raw lane transcript (`/tmp/w2v10/lane-transcript.log`):

```
[+    1ms] lane=session:A START id=A1 verb=followup text="a1"
[+  384ms] lane=session:B START id=B1 verb=followup text="b1"
[+ 1928ms] lane=session:A END id=A1 aborted=false
[+ 1929ms] lane=session:A START id=C1 verb=collect text="c1\n\nc2"
[+ 1953ms] lane=session:B END id=B1 aborted=false
[+ 1953ms] lane=session:B START id=B2 verb=followup text="b2"
[+ 3299ms] lane=session:A END id=C1 aborted=false
[+ 3299ms] lane=session:A START id=F2 verb=followup text="f2"
[+ 3326ms] lane=session:B END id=B2 aborted=false
[+ 4694ms] lane=session:A END id=F2 aborted=false
[+ 4694ms] lanes A+B idle
```

No lane's successor `START` precedes its predecessor's `END`; the two lanes' intervals
overlap freely (`A1` 1–1928 ms crosses `B1`/`B2`), i.e. lanes are independent and each
lane is strictly serial. Enforcement is `LaneState.active` + the `drain` while-loop
(`queue-steering.ts:289-311`).

**Scope caveat (real finding).** `SessionManager` does **not** route session turns
through `QueueSteering` lanes: its executor is constructed with a no-op runner
(`private readonly steeringLane = new QueueSteering(async () => {})`,
`SessionManager.ts:1483`) and the only call site is `runGlobal`
(`SessionManager.ts:3762`). Per-**session** mutual exclusion inside the SessionManager is
still `managed.isProcessing` + `messageQueue`. So the serialization claim is proven for
the lane executor itself and for the global lane, not as the mechanism that serializes
SessionManager turns.

## (2) `collect` coalesces — **PASS**

Lane executor: while `A1` was active, two `collect` submits produced

```json
"C1_collect": { "taskId":"C1","lane":"session:A","disposition":"enqueued","dropped":[] },
"C2_collect": { "taskId":"C2","lane":"session:A","disposition":"coalesced","targetId":"C1","dropped":[] }
```

and `C1` ran with the merged text `"c1\n\nc2"` (transcript line `START id=C1 verb=collect text="c1\n\nc2"`).

Real `SessionManager` path (`v10-collect`, both messages sent while `isProcessing=true`,
`queueMode:'collect'`): the durable queue holds **one** entry, text merged:

```json
"collect_queue": [ { "verb":"collect", "message":"c-one\n\nc-two", "id":"msg-...-igmryy" } ]
```

Kernel agrees and enforces "a trailing task of any other verb breaks the group":
`planSteeringSubmit([{id:'p1',verb:'steer'}], undefined, 'collect')`
→ `{"disposition":"enqueued","droppedIds":[]}` (`queue-steering.ts:133-140`).

## (3) `followup` is FIFO (and never coalesces) — **PASS**

Three followups sent mid-stream are queued in submission order and kept separate:

```json
"followup_order": [ "f1", "f2", "f3" ]
```

Session log `queueLengthBefore` climbs `0 → 1 → 2` for the three `verb:"followup"` sends
(`/tmp/w2v10/out.log:46-72`), confirming append-only. Lane executor ordered successor
tasks strictly (`B1` then `B2`; `A1` then `C1` then `F2`).

## (4) `interrupt` aborts the run and drops queued ids (logged) — **PASS**

Real `SessionManager` (`v10-interrupt`): two queued messages (`followup q1`, `collect q2`)
while processing, then `queueMode:'interrupt'`. The dropped ids are logged and the
in-flight run is aborted with `user_stop`:

```
[session] queue interrupt: dropped 2 queued message(s) {
  sessionId: "v10-interrupt",
  dropped: [ "msg-1791552773310-frqeen", "msg-1791552773320-b1ku2k" ],
}
```

```json
"interrupt_queue_before": [ "msg-...-frqeen", "msg-...-b1ku2k" ],
"interrupt_queue_after": 1,
"interrupt_forceAborts": [ { "reason": "user_stop", "at": 6738 } ]
```

`queue_after == 1` is the interrupt message itself placed at the front
(`SessionManager.ts:7690-7699` clears the queue, aborts, then the trailing enqueue of the
interrupt entry runs it next). Lane executor: `preempted`, `abortedActiveId:"L1"`,
`dropped:["L2","L3","L4","Y"]`; the runner observed the abort and the dropped ids never
ran (`lane-transcript.log:15-21`):

```
[+ 4738ms] lane=session:C ABORTED id=L1 signal.aborted=true preempted=resolved
[+ 4738ms] lane=session:C END id=L1 aborted=true
[+ 4738ms] lane=session:C START id=INT verb=interrupt text="now"
[+ 6116ms] lane=session:C END id=INT aborted=false
```

## (5) a stale writer's append throws `StaleTranscriptWriterError` — **PASS**

Through the real SessionManager writer helpers (`SessionManager.ts:1703-1724`) —
`claimTranscriptWriter(run-A)` then `claimTranscriptWriter(run-B)` (supersede), then an
append tagged `run-A`:

```json
"after_claim_A": "run-A",
"append_A_ok": "committed",
"stale_append": {
  "name": "StaleTranscriptWriterError",
  "code": "ROX_STALE_TRANSCRIPT_WRITER",
  "sessionId": "v10-fence",
  "runId": "run-A",
  "activeRunId": "run-B",
  "message": "Run run-A is not the active transcript writer for session v10-fence (active writer is run-B)",
  "isTyped": true
},
"after_release_A_active": "run-B",
"after_release_B_active": null,
"append_after_release": { "code": "ROX_STALE_TRANSCRIPT_WRITER", "activeRunId": null }
```

The stale append threw **before** running the mutate closure (`append` checks then calls,
`transcript-fence.ts:83-87`), the superseded run's `release(A)` was a no-op, and after the
real release the append throws with no active writer. Verdict PASS.

## (6) runId correlation via `AgentRunRegistry` / `BaseAgent.waitForRun` — **PASS**

Registry (`agent-run-registry.ts:46-89`): waiting on two live runs, finishing `b` first
resolved only `b`; `a` stayed pending until its own finish:

```json
"before": [],
"afterB": [ "b:error" ],
"afterA": [ "b:error" ],
"terminalA": { "runId":"a","status":"ok",  "startedAt":1791552926543,"endedAt":1791552926825 },
"terminalB": { "runId":"b","status":"error","startedAt":1791552926543,"endedAt":1791552926790,"error":"B-failed" }
```

Real `BaseAgent` (`startRun` → `waitForRun`, `base-agent.ts:240-276`): a failing backend
yields the correlated terminal state:

```json
"failTerminal": { "runId":"50399eec-...","status":"error","error":"boom-42" },
"runIdMatches": true,
"currentRunIdAfter": null
```

Guards (`probe4.ts`): `{"beginLive":"Agent run live is already active","finish1":"ok","finish2":"Agent run live already finished"}`;
`wait('never')` rejects with `Agent run never was never begun` (a typo can't hang a wait).

**Observation (not a steering defect).** In a bare process the *first* `BaseAgent.chat()`
blocks ~36–54 s inside session setup before `chatImpl` runs (`probe2.ts`:
`startRun` at `+1ms`, `chatImpl enter` at `+36288ms`), because `extractSkillPaths` →
`loadAllSkills` (`base-agent.ts:1017`) provisions bundled skills into the config dir on
first use. `startRun` still hands out the `runId` immediately, so `waitForRun` latency —
not the registry contract — carries that one-time cost.

## (7) BREAK attempt: two concurrent sends + an interrupt while a followup is queued — **PASS**

Lane `session:C`: `L1` active, queued `L2(followup) L3(collect) L4(followup)`; then in one
synchronous tick a `steer` (`X`), a `collect` (`Y`) and an `interrupt` (`INT`):

```json
"X_steer":   { "disposition":"steered","targetId":"L1" },
"Y_collect": { "disposition":"enqueued" },
"INT":       { "disposition":"preempted","dropped":["L2","L3","L4","Y"],"abortedActiveId":"L1" }
```

`X` was delivered into the active run (never reordered it), the interrupt dropped **every**
pending entry including the just-enqueued `Y` (in submission order) and aborted `L1`; the
dropped ids produced no `START` line. Nothing interleaved. The same shape over the real
SessionManager (`v10-interrupt`) aborted via `forceAbort(user_stop)` and dropped both
queued ids (see §4).

---

## Findings

1. **No functional FAIL** on any of the seven claims. Every verb/disposition, the lane
   serialization, the writer fence and the runId correlation behaved exactly as the
   module contracts state.
2. **`SessionManager`'s per-session lane executor is a no-op**
   (`SessionManager.ts:1483`). `QueueSteering` session lanes are exercised only by the
   global lane (`runGlobal`, `:3762`); session turn exclusivity still comes from
   `isProcessing`/`messageQueue`. Not a bug, but the `queue-steering` lane machinery is
   dead weight for session work — the "lane serialization" guarantee should be attributed
   to the lane executor only.
3. **Interrupt drop is reported twice with different sources**: the kernel returns the
   dropped ids, but the real SessionManager clears the queue itself
   (`SessionManager.ts:7693-7697`) and calls the kernel on an already-empty queue, so the
   kernel's `dropped` is `[]` there. The authoritative drop list in the server path is the
   SM's own log line (observed). Harmless, but the kernel result is ignored on that path.
4. **First-call `BaseAgent.chat()` setup** costs ~36–54 s in a fresh process (bundled-skills
   provisioning). Environmental, orthogonal to the steering substrate; noted because it
   dominates `waitForRun` end-to-end latency in the harness.