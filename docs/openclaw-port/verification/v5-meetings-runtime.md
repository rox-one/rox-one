# V5 — Meetings runtime (slice S6) — real-surface verification

Rows: d2.1 / d2.3 / d2.4 / d2.8
Repo: `/Users/t/Projects/rox-one-port` (worktree `port/openclaw-features`)
HEAD at verification: `cdcd4c50f`
Date: 2026-10-09

## Method

A single throwaway harness (`/tmp/v5-meetings-harness.ts`, not committed) statically imports the
**real** modules and drives a synthetic caption stream over an injected clock:

- `packages/server-core/src/meetings/{observe,session-runtime,journal,session-transcript-store,observation-provenance,summary-cadence,summary-heuristic}.ts`
- `packages/shared/src/meeting-agents/summaries.ts`
- `packages/core/src/meetings/index.ts`

It seeds a real `MeetingJournal` on a temp dir, runs `MeetingObserveCoordinator` with
`now()` bound to a mutable clock, appends a 132-line / ~11-minute caption stream, generates
rolling summaries at real 5-minute window boundaries, then reads back the persisted journal
snapshot. No unit test was executed.

Run:

```
cd /Users/t/Projects/rox-one-port && timeout 180 bun /tmp/v5-meetings-harness.ts
```

Result: `TOTAL=29 PASS=29 FAIL=0` (0.17 s).

## Fed stream

- Session `m1`, transport `mic`, mode `observe`; clock `t` starts at 0.
- 132 caption lines at `at = i*5000` (0 … 655 000 ms), rotating speakers `Иван` / `Alice` / `''`,
  with decision/action/risk-bearing text at lines 4/40/80 (`решили выпустить релиз в пятницу`,
  `надо проверить бюджет`, `есть риск сорвать сроки`).
- Summaries generated at `t = 299 000` (window 0), `t = 301 000` (window 1), `t = 900 001`
  (empty window 3); plus a dedicated `m2` scenario at `t = 299 000` / `t = 299 500`.
- `stop()` at `t = 1 000 000`.

Observed session transitions (real `MeetingSessionRuntime`): `start` → `open()` → `joining`,
`transition(in_call)` → `in_call` (`observing=true`); `stop()` → `ended`. Journal snapshot after
stop: `states=["ended"]` (check `e3`).

## Verdicts

### (a) Per-line provenance + honest `ownEcho` — **PASS**

Real `applyObservationProvenance` / `classifySelf` / `resolveOwnEcho`:

| feed | self | ownEcho |
|---|---|---|
| asr-stream / microphone speaker `Alice`, selfSpeaker `Me` | `other` | `undefined` (unset) |
| asr-stream / microphone speaker `Me` == selfSpeaker | `self` | `undefined` (**never guessed true**) |
| asr-stream / microphone, explicit `self:'self'` (adversarial) | `self` | `undefined` |
| browser-caption / room, `self:'self'` | `self` | `true` |
| asr-stream / system, `self:'self'` | `self` | `true` |

Store keeps speaker + `ownEcho` per line (`a7`: speakers `["Alice","","Me"]`, ownEcho `[null,null,true]`).
Mic-only capture never claims its own TTS echo. Honesty confirmed.

### (b) 5-minute summary cadence / strict JSON / heuristic fallback — **PASS**

- Window anchored at session start: `summaryWindow(300000,0,300000)` = `{0,300000,index:1}` (`b9`).
- Model path at a real 5-min boundary: `generator=model`, `window=0-300000`, citations validated
  against the window's keys (`b1`,`b2`).
- Same window + same revision → cached, model **not** re-invoked (`b3`, calls=0).
- Next window (index 1) → model fires again (`b4`, win=300000).
- Empty window → no model call, deterministic heuristic (`b5`).
- Model throws → heuristic: `generator=heuristic`, `text="решили выпустить релиз • надо проверить бюджет"`
  citing real line keys (`b6`).
- Model over budget (5 ms timeout, never resolves) → heuristic (`b7`).
- Strict-JSON gate: payload with a citation that does not exist in the window is rejected
  (`parse=null`, `b8`); a valid citation is accepted (`b8b`).

### (c) Revision invalidates the stale summary — **PASS**

`m2`: model summary at revision 1 (`"модель A"`); a corrected line appended (revision → 2) and
`generateSummary` re-run **in the same window** → returned summary keeps `text="модель A"` and
original `revision=1`, sets `invalidatedByRevision=2`, and the model is **not** re-invoked
(`modelCalls=1`) (`c1`). The stale summary is marked, never silently kept.
Persisted summaries are journal-canonical (`c2`: keys `observe-m1-0:{0,300000,900000}`).

### (d) Caps enforced with eviction signals — **PASS**

Real `MeetingTranscriptStore` (default caps):

- **2000 lines**: pushing 2001 → `lineCount=2000`, `isEvicted=true`, `drainEvictions()` returns one
  `{reason:'line-cap', evictedKeys:['L0']}` (`d1`).
- **tail 64**: cursor trimmed to 64, newest last → `first=L1937 last=L2000` (`d2`).
- **4 ended sessions**: 5 sessions appended + `markEnded` → oldest (`e0`) evicted with
  `{reason:'ended-cap', sessionId:'e0'}`, remaining ended = `e1..e4` (`d3`).
- An ended buffer rejects further lines: `{accepted:false, code:'session-ended'}` (`d4`).

Note: the 64-tail trim also flags `isEvicted=true` (design: any cursor drop is surfaced as an
eviction signal).

### (e) No audio/video recording written anywhere — **PASS**

- After driving a full session (start → 132 lines → summaries → stop), the only files under the
  persist root are `meetings/m1/{journal.jsonl,snapshot.json}` and `meetings/m2/...`; zero media
  files (`.wav/.webm/.mp4/...`) (`e1`). No recorder API exists in the meetings modules — grep:

  ```
  grep -rniE "mediarecorder|audiorecord|videorecord|\.webm|\.wav|\.mp4|createWriteStream" \
    packages/server-core/src/meetings packages/core/src/meetings packages/shared/src/meeting-agents
  ```

  → only journal/proposal/note/artifact JSON writers; no audio/video capture.
- Per-line transcript text is **not** journaled: `journal.jsonl` contains neither `line-100` nor
  `решили выпустить релиз` (`e2`).

## Unproven / caveats

- Everything above is an **in-process module** run (lab evidence) with a synthetic stream. No real
  OS microphone, provider websocket, or renderer surface was exercised — no provider audio means the
  `ownEcho=true` branch was driven by injected provenance, not by a real browser-caption feed.
- `MeetingObserveCoordinator` was driven with an injected clock; no wall-clock 5-minute wait was
  observed (cadence is proven by window math + boundary-triggered invocation, not by real elapsed time).

## Harness (key excerpts)

```ts
let t = 0
const coordinator = new MeetingObserveCoordinator(() => root, () => t)
const started = coordinator.start({ workspaceId: 'ws', meetingId: 'm1', transport: 'mic' })
for (const [at, speaker, text] of stream) { t = at; coordinator.appendLine(sessionId, { key: `k${at}`, speaker, text, at }) }
t = 299_000
const modelSummary = await coordinator.generateSummary({ workspaceId: 'ws', meetingId: 'm1',
  model: async (a) => JSON.stringify({ text: 'модель: релиз в пятницу; риск по срокам', sourceSegmentIds: [a.lines[0]!.key] }) })
// d1/d2 caps
const capStore = new MeetingTranscriptStore()
for (let i = 0; i < 2001; i += 1) capStore.append('capS', { key: `L${i}`, speaker: 'x', text: `t${i}`, at: i })
// e1 no media files
const mediaFiles = walk(root).filter((f) => MEDIA_EXT[extname(f).toLowerCase()] === true)
```

Per-claim verdicts: (a) PASS · (b) PASS · (c) PASS · (d) PASS · (e) PASS.