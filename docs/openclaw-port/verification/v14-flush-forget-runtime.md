# V14 — flush + forget runtime verification (crash-safe flush under a real kill; forget purges every surface)

Rows: **c1.8** flush turn (durable-write-intent + idempotent replay) and **c1.8** forget (content purge + hash-only lineage).
Targets: `packages/server-core/src/memory/flush-turn.ts`, `.../MemoryProposalStore.ts`,
`.../approve-memory-proposal.ts`, `.../forget.ts`, `.../episodic-memory.ts`.
Verifier: `w2-verify-6`. Date: 2026-10-09. Tree: `/Users/t/Projects/rox-one-port` @ `cfb1f1b8d`
(`main` tip; deps installed). Runtime: **bun 1.4.2** (macOS arm64). Unit tests were NOT used as evidence.

## Surface driven (real processes / real SIGKILL / real files)

- **Flush**: the product's own module chain is driven in **real separate processes** over **real files**:
  `flushMemoryWrites` (`flush-turn.ts:49`) → `approveMemoryProposalDurably`
  (`approve-memory-proposal.ts:60`) → `LessonStore.add` / `MemoryIndexService.rebuild`.
  The crash is a genuine **`SIGKILL` delivered by a parent process to the child while the child is
  executing the flush loop** (the child is a distinct OS process; no in-process catch).
- **Forget**: the product APIs are driven against a real workspace with real `context.md`,
  `memory/history/<day>.md`, `lessons.jsonl`, the real **FTS5** chunk backend (`bun:sqlite`), and a
  real `episodic.jsonl` with embeddings written to disk.
- All state isolated under `/tmp/v14/`; no repo files touched. Harnesses: `/tmp/v14/child-flush.ts`,
  `/tmp/v14/recover.ts`, `/tmp/v14/run-flush.ts`, `/tmp/v14/forget.ts`.

Reproduce:

```bash
cd /Users/t/Projects/rox-one-port
timeout 300 bun /tmp/v14/run-flush.ts   # flush crash + recovery   -> /tmp/v14/out-flush.txt
timeout 180 bun /tmp/v14/forget.ts      # forget purge             -> /tmp/v14/out-forget.txt
```

### How the pending write-intents are created (real product code, real crash)

`approveMemoryProposalDurably` persists the durable write-intent **before** the corpus write
(`approve-memory-proposal.ts:98-99` `input.store.save(pending)`) and the receipt **after** it
(`:131` `store.save({ ...next, approval: { ...approval, target, writtenAt } })`). The child seeds
proposals whose write-intent exists with **no `writtenAt`** (the exact state a crash between the two
`store.save` calls leaves behind), then the parent `SIGKILL`s the child mid-`flushMemoryWrites`. The
intent-only state was produced through the same `store.save(pending)` line production uses, via the
documented crash seam (`approve-memory-proposal.ts:25-31`); the kill itself is external.

---

## (a) real SIGKILL mid-flush → pending intents survive, no partial state — **PASS**

```
### PHASE B: spawn crash child (N=120 pending write-intents), SIGKILL mid-flush ###
seed.done: pendingWriteIntents=120
exit: {"code":null,"signal":"SIGKILL"}  (lessons.jsonl lines observed at kill = 1/120)
child stderr: (empty)
flush.done present: false
crashed state: proposals=120 withReceipt=0 pendingIntentNoReceipt=120 corpusLines=1
crashed corpus content: "{\"ts\":\"2023-11-14T22:13:21.000Z\",\"rule\":\"Always use the ZEPPELINFLAG deploy flag for release build p-0000\",\"category\":\"workflow\",\"scope\":\"workspace\",\"source\":{\"sessionId\":\"v14-session\",\"trigger\":\"explicit\",\"proposalId\":\"p-0000\",\"consentEventId\":\"consent_p-0000_workspace\"}}\n"
```

The child died by signal `SIGKILL` (`code:null`), `flush.done` absent. The crash landed **after** the
first corpus line was written but **before** its receipt: `withReceipt=0`, `pendingIntentNoReceipt=120`,
`corpusLines=1`. So the intent survived and the corpus is the only partially-written artifact — never a
half-written one. Verdict: **PASS**.

## (b) recovery flush is deterministic-id-ordered and completes the job — **PASS**

```
### PHASE R1: fresh recovery process runs the real flush ###
recover#1 exit=0 flushed=120 failed=0
  flushed order: [p-0000, p-0001, p-0002 ... p-0118, p-0119]
  first flushed id: p-0000  last flushed id: p-0119
after recover#1: corpusLines=120 pendingIntentNoReceipt=0 withReceipt=120
```

The intents were seeded in reverse id order; `pendingWriteIntents()` sorts ascending by id
(`MemoryProposalStore.ts:49-53`), so replay processed `p-0000 … p-0119` in id order. All 120 resolved
(`flushed=120 failed=0`), every intent produced a receipt. Verdict: **PASS**.

## (c) replay is receipt-idempotent and never duplicates the corpus line — **PASS**

```
### PHASE R2: second flush must be a no-op (receipt-idempotent) ###
recover#2 exit=0 flushed=0 failed=0
  corpusLines after recover#2: 120

### VERIFY ###
corpus lines: 120; parseable=120; uniqueRules=120
duplicate corpus lines: 0
corpus appended in deterministic id order: true (first=0 last=119)
crash wrote a p-0000 corpus line before dying; occurrences of p-0000 in final corpus = 1 (expect 1)
```

The hard case is `p-0000`, whose corpus line **survived the crash without a receipt**. On replay
`approveMemoryProposalDurably` finds the already-stored lesson by
`source.proposalId === current.id && lesson.source.consentEventId === consentEventId && rule match`
(`approve-memory-proposal.ts:115-116`), skips the `add`, and only writes the receipt — so the line is
**not duplicated** (exactly 1 occurrence). A second replay is a pure no-op (`flushed=0`), i.e.
receipt-idempotent: intents carrying `writtenAt` are excluded by `pendingWriteIntents()`
(`MemoryProposalStore.ts:51`). Verdict: **PASS** (no partial line, no duplicate line).

## (d) no orphan chunk rows after recovery — **PASS**

```
index status: {"state":"ready","chunks":120,"updatedAt":1791553230465,"capability":{"fts5":true,"vector":false},"indexIdentity":"v1:local/lexical-bm25","chunkingVersion":1,"backend":"fts5"}
chunk rows=120 (expect 120 lessons); orphanRows(not in corpus)=0
pendingWriteIntents after recovery: 0
```

The FTS5 back end holds exactly one row per flushed corpus line (`120`), and every row's text is
present in the corpus (`orphanRows=0`). Nothing references a line that was never written.
Verdict: **PASS**.

---

## (e) forget removes the md block, the lessons line, chunk rows and embeddings — **PASS**

Fixture (`/tmp/v14/ws-forget`): `memory/context.md` and `memory/history/2026-01-02.md` each carry a
1400-char filler line, so the chunker (`MAX_CHUNK_CHARS=1200`, line-aligned) puts the target line in
its **own** chunk; `memory/lessons.jsonl` holds the target rule + a keep rule; two episodes are stored
with embeddings backfilled to disk.

Before:

```
index rebuilt: {"state":"ready","chunks":8,...,"backend":"fts5"}
search(REMEMBERME14) hits=[{"chunkId":"470e68937ff2ee5112a8","path":"memory/history/2026-01-02.md","text":"Deploy note: REMEMBERME14 flagged for removal.\n"},{"chunkId":"65875c006d30e8e2c7cc","path":"memory/lessons.jsonl","text":"REMEMBERME14 must always be persisted in the deploy notes."},{"chunkId":"c2b4f7b286ea3c932984","path":"memory/context.md","text":"REMEMBERME14 must always be persisted in the deploy notes.\n"}]
forget ids: ["470e68937ff2ee5112a8","65875c006d30e8e2c7cc","c2b4f7b286ea3c932984"]
episodic.jsonl before forget (embeddings backfilled):
{"id":"eaa1efa7-9997-400a-9d36-ec42417d785a",...,"text":"REMEMBERME14 must always be persisted in the deploy notes.","embedding":[1.2727...,1.3076...]}
{"id":"8d8a5be3-9e68-4f21-af69-68df8542b8ab",...,"text":"Keep the ZEPPELINFLAG release cadence weekly.","embedding":[1.0909...,1.7692...]}
```

After `forgetMemoryChunks({ index, workspaceRoot, audit, ids, by:'user', episodic })`:

```
### content after forget ###
context.md: "# Workspace context\nProject V14 uses the ZEPPELINFLAG deploy pipeline.\nFILLERPAD14 xxx…(1400 x's)…
history:    "# 2026-01-02\nSession morning notes.\nFILLERPAD14 xxx…(1400 x's)…
lessons rules: ["Keep the ZEPPELINFLAG release cadence weekly."]
md block gone: context=true history=true
non-target content retained: header=true filler=true historyHeader=true
lessons line gone: true ; keep line remains: true

### index after forget ###
status: {"state":"ready","chunks":5,...,"backend":"fts5"}
search(REMEMBERME14) hits after forget: []
chunk rows: 5; rows still containing REMEMBERME14: 0
index.get(forgotten ids) all null: true

### embeddings after forget ###
episodic.jsonl: "{\"id\":\"8d8a5be3-9e68-4f21-af69-68df8542b8ab\",...,\"text\":\"Keep the ZEPPELINFLAG release cadence weekly.\",\"embedding\":[1.0909090909090908,1.7692307692307692]}\n"
target episode (id eaa1efa7-9997-400a-9d36-ec42417d785a) gone: true ; marker text gone: true
keep episode (id 8d8a5be3-9e68-4f21-af69-68df8542b8ab) remains: true
```

Every target surface is purged and the surrounding content is retained (the filler/header lines stay,
so the removal is surgical, not a whole-file wipe):

- **md block** — `context.md` and `history/2026-01-02.md` no longer contain `REMEMBERME14`; their
  headers/filler remain (`forget.ts:59-71` `withoutBlock`).
- **lessons.jsonl line** — target rule gone, keep rule intact (`forget.ts:78-96` `withoutLessonLine`).
- **chunk rows** — rebuilt index down to 5 rows, **0** containing the marker; `index.get()` null for all
  three forgotten ids; `memory_search` returns `[]` (`forget.ts:159` `index.rebuild()`).
- **embeddings** — the target episode and its cached embedding are gone; the unrelated episode keeps its
  embedding (`episodic-memory.ts:244-254` `forget`).

Verdict: **PASS**.

## (f) AuditLog lineage is hash-only and never injected — **PASS**

```
### lineage record ###
forget entry: {"ts":"2026-10-09T13:40:30.688Z","actor":"user","action":"forget","target":"c2b4f7b286ea3c932984,470e68937ff2ee5112a8,65875c006d30e8e2c7cc","detail":"{\"reason\":\"user requested removal\",\"entries\":[{\"chunkId\":\"c2b4f7b286ea3c932984\",\"path\":\"memory/context.md\",\"textHash\":\"c48885a6c643d04f77ec5c852da3ac768e42af27\"},{\"chunkId\":\"470e68937ff2ee5112a8\",\"path\":\"memory/history/2026-01-02.md\",\"textHash\":\"68cd83e19fcf4d4143503edbf5f00172bfb77b46\"},{\"chunkId\":\"65875c006d30e8e2c7cc\",\"path\":\"memory/lessons.jsonl\",\"textHash\":\"28d4378db979d99e35bd8ded56ba184ffe448d0c\"}]}","scope":"workspace"}
sha1(TARGET_RULE)=28d4378db979d99e35bd8ded56ba184ffe448d0c ; in audit entries: true
plaintext marker in audit.jsonl: false (expect false)
plaintext target text in audit.jsonl: false (expect false)
collected memory source paths: ["memory/context.md","memory/history/2026-01-02.md","memory/lessons.jsonl"]
audit.jsonl is a collected source: false (expect false)
marker in any collected doc content: false (expect false)
sha1 hash in any collected doc content: false (expect false)
post-forget rebuild chunk rows: 5
search(sha1) hits: []
```

The single `audit.jsonl` record stores only `chunkId` + `path` + `sha1(text)` (`forget.ts:98-100,138,150`):
the SHA-1 of the removed rule is present, the plaintext is **not** anywhere in the file. `audit.jsonl`
is not a memory source: `collectMemorySourceDocs` only returns `context.md`, `history/*.md`,
`lessons.jsonl`, `projects/*/MEMORY.md` (`MemoryIndexService.ts:113-179`), so the lineage record can never
enter the chunk index or any prompt block; the SHA-1 string yields **0** search hits and is absent from
every collected document. Verdict: **PASS** (auditable, non-retrievable, never injected).

## (g) forgetting an already-forgotten id is a clean no-op — **PASS**

```
### re-forget no-op ###
forgotten=[] alreadyForgotten=["470e68937ff2ee5112a8","65875c006d30e8e2c7cc","c2b4f7b286ea3c932984"] lineage=null
audit lines 1 -> 1 (expect unchanged)
```

Re-forgetting the same ids resolves to nothing (`forgotten=[]`, `lineage=null`) and appends **no** new
lineage record. Verdict: **PASS**.

---

## Verdict summary

| Claim | Verdict | Evidence |
|---|---|---|
| (a) SIGKILL mid-flush leaves pending intents, no partial state | **PASS** | child `signal:"SIGKILL"`; `withReceipt=0`, `pendingIntentNoReceipt=120` |
| (b) recovery replays in deterministic id order, completes | **PASS** | `flushed=120`, order `p-0000…p-0119`, `failed=0` |
| (c) receipt-idempotent; no duplicated/partial corpus line | **PASS** | 2nd flush `flushed=0`; `p-0000` occurs exactly once |
| (d) no orphan chunk rows after recovery | **PASS** | `chunk rows=120`, `orphanRows=0` |
| (e) forget purges md block + lessons line + chunk rows + embeddings | **PASS** | marker gone from all 4 surfaces; keep content retained |
| (f) lineage record hash-only, never injected | **PASS** | SHA-1 present, plaintext absent, `audit.jsonl` not a source |
| (g) re-forget is a no-op | **PASS** | `lineage=null`, audit lines unchanged |

**No FAILs.** All seven claims are CONFIRMED on real processes / real files (real `SIGKILL`, real FTS5
index, real jsonl stores). No defect found in the target modules, so no fix is proposed.

## Observations (non-blocking, not part of the claims)

- **Corpus cap is real.** With >200 pledged intents the workspace lesson store prunes the oldest beyond
  `LESSON_LIMITS.total=200` (`LessonStore.add`), so a flush of 300 intents leaves the last 200 corpus
  lines. This is intended product behavior, not a crash-safety defect; the run above uses 120 to stay
  under the cap and prove exact persistence.
- **The proposal RPC surface is local-binding gated.** A remote, token-authenticated WS client gets
  `CHANNEL_NOT_FOUND` for `memory:extractProposals` / `memory:listProposals` while `sessions:get` and
  `memory:indexStatus` succeed — `nativeOrLocalElectron` channels are masked unless the caller has a
  current local binding (`transport/server.ts:1311`). This is the intended security mask; the "real RPC"
  surface for the durable approval is the local Electron client, so the flush was driven through the real
  product modules in real processes instead.
- The embedder in the forget fixture is an injected deterministic DI seam (`episodic-memory.ts:70-72`);
  the real `@xenova/transformers` download path was not exercised (out of scope for a purge test).

## unproven

- Nothing in the target claims was left unproven.
- Natural (seam-free) crash timing — the crash lands in the same window (`store.save(pending)` at
  `approve-memory-proposal.ts:99` … receipt at `:131`) that the child reproduced; a wall-clock race with
  no crash injection was not additionally driven.