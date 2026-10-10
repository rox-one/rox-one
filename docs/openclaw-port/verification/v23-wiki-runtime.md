# V23 — Memory wiki runtime verification (row c1.7)

- Repo: `/Users/t/Projects/rox-w3-int` @ HEAD `98e1e5cc4` (branch `port/w3-int`)
- Runtime: `bun 1.4.2` (macOS arm64). A passing unit test was NOT used as evidence.
- Method: a **real `WsRpcServer`** (`packages/server-core/src/transport/server.ts`) listening on an
  ephemeral loopback port with the **real registered memory handlers**
  (`registerMemoryHandlers`), driven by a **real `WsRpcClient`** (`ws@8` upgrade, real JSON-RPC over
  WebSocket). `memory:wikiApply` / `memory:wikiList` / `memory:wikiGet` / `memory:wikiLint` were all
  invoked over that socket. `memory:search` (same socket) supplied a real chunk id. The prompt-path
  claims (`buildMemoryBlocks`, the `wiki_apply` tool callback) were driven against the same real
  workspace through the product APIs `MemoryService` and `buildMemoryToolCallbacks`.
- Workspace: a **real temp dir** `/tmp/v23-wiki/run-1/ws` with `memory/context.md` on disk, registered
  through the real `saveConfig` (`ROX_CONFIG_DIR` honoured). Unique markers: `V23WIKIMARK` (indexed
  memory), `V23ALPHA` / `V23BETA` / `V23TOOLMARK` (wiki claims).
- Hermetic: `ROX_CONFIG_DIR=CRAFT_CONFIG_DIR=/tmp/v23-wiki/run-1`; no writes to `~/.craft-agent`.

Reproduce (harness at `/tmp/v23-wiki/harness.ts`, throwaway — no repo file touched):

```bash
cd /Users/t/Projects/rox-w3-int \
  && ROX_CONFIG_DIR=/tmp/v23-wiki/run-1 CRAFT_CONFIG_DIR=/tmp/v23-wiki/run-1 \
     timeout 180 bun /tmp/v23-wiki/harness.ts > /tmp/v23-wiki/out.txt 2>&1; echo exit=$?
# exit=0
```

Raw output: `/tmp/v23-wiki/out.txt` (reproduced below in full at the points cited).

---

## (a) `wikiApply` (evidence + contradicting second claim) then `wikiList`/`wikiGet`/`wikiLint` — **PASS**

Two claims were applied over the real socket; `claim-beta` carries a contradiction edge to
`claim-alpha`. `memory:search` returned the real chunk id `8ae87b73a594bf924481` (of
`memory/context.md`), used as the evidence source:

```
searchHits = [{"path":"memory/context.md","chunkId":"8ae87b73a594bf924481","score":0.2877}]
applyAlpha = {"id":"claim-alpha","revision":1,"status":"active","evidence":1}
applyBeta  = {"id":"claim-beta","revision":1,"contradicts":["claim-alpha"]}
wikiList   = [{"id":"claim-alpha","status":"active","revision":1,"contradicts":null},
              {"id":"claim-beta","status":"active","revision":1,"contradicts":["claim-alpha"]}]
wikiGetAlpha = {"id":"claim-alpha","text":"V23ALPHA the deploy pipeline runs through vercel.",
                "evidence":[{"source":"8ae87b73a594bf924481","locator":"memory/context.md:2",
                             "ts":"2026-01-01T00:00:00.000Z","quote":"deploy pipeline runs through vercel"}]}
lint1 = {"claimsChecked":2,"findings":[
          {"severity":"info","code":"contradiction-cluster","message":"Contradicting claims: claim-alpha, claim-beta."},
          {"claimId":"claim-alpha","severity":"info","code":"low-confidence", ...},
          {"claimId":"claim-beta","severity":"info","code":"low-confidence", ...}]}
```

The contradiction edge round-trips on `wikiList`/`wikiGet`, and `wikiLint` clusters the pair
(`contradiction-cluster`). All four channels were invoked through the real WS handler surface.

### (a.1) Session-tool facades `wiki_apply` / `wiki_search` / `wiki_get` — **PASS**

The `packages/session-tools-core/src/handlers/wiki-*.ts` facades were driven directly
(`handleWikiApply`/`handleWikiSearch`/`handleWikiGet`) against the same real store via the real
`buildMemoryWikiCallbacks` seam:

```bash
cd /Users/t/Projects/rox-w3-int \
  && ROX_CONFIG_DIR=/tmp/v23-wiki/tools-1 CRAFT_CONFIG_DIR=/tmp/v23-wiki/tools-1 \
     timeout 60 bun /tmp/v23-wiki/harness-tools.ts   # exit=0
```

```
handleWikiApply.upsert      = {"isError":false,"text":"## Wiki apply\nStored claim tool-1 (revision 1, status active)."}
handleWikiApply.emptyText   = {"isError":true,"text":"[ERROR] wiki_apply upsert requires a non-empty claim \"text\"."}
handleWikiApply.badOp       = {"isError":true,"text":"[ERROR] wiki_apply requires \"op\" to be \"upsert\" or \"retract\"."}
handleWikiSearch            = {"isError":false,"text":"## Wiki search: \"vercel\"\n1 of 1 claim(s)\n\n1. [tool-1] active —
                               V23TOOLHANDLER deploys go through vercel. (revision 1)\n   evidence: 1\n   - memory/context.md @ context.md:1 — \"vercel\""}
handleWikiGet               = {"isError":false,"text":"## Wiki claim tool-1\nstatus: active · revision: 1\n\nV23TOOLHANDLER deploys
                               go through vercel.\n\nevidence:\n   - memory/context.md @ context.md:1 — \"vercel\""}
handleWikiGet.missing       = {"isError":false,"text":"No wiki claim with id not-there."}
handleWikiSearch.unwired    = {"isError":true,"text":"[ERROR] wiki_search is unavailable in this backend (no workspace wiki wired)."}
```

Unknown op / empty text / missing id return truthful typed results, and an unwired backend reports the
typed "unavailable" rather than fabricating a claim.

## (b) `claims.jsonl` and `WIKI.md` exist with the expected content — **PASS**

`WikiClaimStore.filePath` = `{workspaceRoot}/memory/wiki/claims.jsonl`; `compileWikiDigest` writes
`{workspaceRoot}/memory/wiki/WIKI.md`. Both exist on disk after the RPC calls:

```
claimsJsonlExists = true
claimsJsonl =
{"id":"claim-alpha","revision":1,"text":"V23ALPHA the deploy pipeline runs through vercel.","status":"active",
 "evidence":[{"source":"8ae87b73a594bf924481",...}],"createdAt":"2026-10-09T15:51:48.914Z","updatedAt":"2026-10-09T15:51:48.914Z"}
{"id":"claim-beta","revision":1,"text":"V23BETA the deploy pipeline runs through netlify instead.","status":"active",
 "evidence":[{...}],"createdAt":"...","updatedAt":"...","contradicts":["claim-alpha"]}
digestPath   = "/tmp/v23-wiki/run-1/ws/memory/wiki/WIKI.md"
wikiMdExists = true
WIKI.md =
# Workspace memory wiki

Claims: 2

## Claims

- [claim-alpha] V23ALPHA the deploy pipeline runs through vercel. (status active; revision 1; evidence 1)
- [claim-beta] V23BETA the deploy pipeline runs through netlify instead. (status active; revision 1; evidence 1; contradicts claim-alpha)

## Contradiction clusters

- claim-alpha ↔ claim-beta

## Lint

- [info] contradiction-cluster: Contradicting claims: claim-alpha, claim-beta.
- [info] low-confidence (claim-alpha): Claim is backed by a single evidence entry.
- [info] low-confidence (claim-beta): Claim is backed by a single evidence entry.
```

The content is exactly the two applied claims (text/status/revision/evidence/edge) and the digest
renders each claim plus its contradiction cluster and lint findings.

## (c) Digest byte-identical across two runs — **PASS**

`memory:wikiLint` was invoked twice; the `WIKI.md` bytes were hashed after each run:

```
digestSha_run1 = "191623961d70b933b3e6773b21ebac5b1fb7e9e762fdf328803f2c4d8a511b52"
digestSha_run2 = "191623961d70b933b3e6773b21ebac5b1fb7e9e762fdf328803f2c4d8a511b52"
digestByteIdentical   = true
lint1EqLint2Findings  = true
```

`renderWikiDigest` carries no wall clock (`generatedAt` lives only in the RPC report, not in the
file), so the second run rewrites byte-identical markdown. Deterministic as designed.

## (d) Dangling contradiction id and empty text are rejected — **PASS** (RPC/contract surface)

Both mutations were pushed through the real `memory:wikiApply` handler; the store threw and the RPC
round-tripped the rejection as an error (the store was not mutated — `wikiList` still shows 2 claims):

```
danglingRejected     = "wiki apply: dangling contradiction id \"nope-does-not-exist\""
emptyTextRejectedRpc = "wiki apply: claim text is required"
```

Rejection is at `WikiClaimStore.upsert` (`WikiClaimStore.ts:250` empty text, `:259-261` dangling
edge). The empty-text rejection is also enforced on the tool-callback surface
(`buildMemoryWikiCallbacks.apply` → `errorResponse`):

```
emptyTextRejectedTool = {"isError":true,"text":"[ERROR] wiki_apply failed: wiki apply: claim text is required"}
```

**Nuance (not a defect):** on the tool-callback path the `contradicts` field is not part of the tool
schema (`WikiClaimSchema`, `tool-defs.ts:492-501` has no `contradicts`), so
`buildMemoryWikiCallbacks.apply` builds the mutation from id/text/status/evidence/scope/revision only
and a `contradicts` key supplied by a tool caller is silently dropped — a claim is stored with no
edge:

```
danglingRejectedTool = {"isError":false,"text":"## Wiki apply\nStored claim d2 (revision 1, status active)."}
```

No dangling edge can arise through the tool path (the edge is simply not expressible there), and the
only surface that *can* express an edge — the RPC mutation — rejects a dangling id as shown above.
So the "dangling id rejected" guarantee holds on every surface that can carry an edge.

## (e) `wiki_apply` via the real tool callback; `buildMemoryBlocks` BYTE-IDENTICAL across wiki writes — **PASS**

`buildMemoryToolCallbacks(index, forgetExec, wikiStore).wiki.apply(...)` stored `claim-tool` (real
`WikiClaimStore` write, confirmed on disk), and `MemoryService.buildMemoryBlocks()` was called on the
same workspace immediately before and after that write:

```
blocksBeforeSha = "6f8ce81b1f2fc05ada85dc036e2b5c8d063488c1ca9b9119b51cdd06769dfe61"  (len 551)
toolApplyContent = "## Wiki apply\nStored claim claim-tool (revision 1, status active)."
toolClaimPersistedOnDisk = true
blocksAfterSha  = "6f8ce81b1f2fc05ada85dc036e2b5c8d063488c1ca9b9119b51cdd06769dfe61"  (len 551)
blocksByteIdentical  = true
wikiTextNotInBlocks  = true
```

The wiki write really landed (`claim-tool` present in `claims.jsonl`) yet the assembled prompt blocks
are byte-for-byte identical and contain neither the claim id nor the claim text. Confirmed in-tree
why: the workspace chunk index (`collectMemorySourceDocs`, `MemoryIndexService.ts:113-178`) reads only
`memory/context.md`, `memory/history/*.md`, `memory/lessons.jsonl` and `projects/*/MEMORY.md` — it
never reads `memory/wiki/**`, and `buildMemoryBlocks` never references the wiki store. The wiki is a
document surface, never injected, as the design states.

## (f) Forget the referenced memory → lint reports `evidence-missing`, claim survives — **PASS**

`claim-alpha`/`claim-beta` reference chunk id `8ae87b73a594bf924481`. Before forget, the liveness
resolver reports the evidence as live (no `evidence-missing`); after forgetting that chunk through the
real `memory_forget` tool callback (`buildMemoryToolCallbacks.forget`, wired to
`forgetMemoryChunks`), the id no longer resolves and the RPC lint flags `evidence-missing` for both
claims without throwing:

```
lintPreForgetEvidenceMissing = []
forgetResult = {"isError":false,
  "text":"## Memory forget\nForgotten 1 chunk(s); removed from corpus, index and embeddings.\n- 8ae87b73a594bf924481\nLineage recorded at 2026-10-09T15:51:48.953Z by agent."}
chunkResolvesAfterForget = false
lintPostEvidenceMissing = [
  {"claimId":"claim-alpha","severity":"warning","code":"evidence-missing",
   "message":"Evidence source \"8ae87b73a594bf924481\" no longer resolves."},
  {"claimId":"claim-beta","severity":"warning","code":"evidence-missing",
   "message":"Evidence source \"8ae87b73a594bf924481\" no longer resolves."}]
claimAlphaSurvives = {"id":"claim-alpha","status":"active",
  "evidence":[{"source":"8ae87b73a594bf924481","locator":"memory/context.md:2","ts":"2026-01-01T00:00:00.000Z",
               "quote":"deploy pipeline runs through vercel"}]}
```

The lint completed with a normal report (no crash); the claim and its evidence entry survive intact
(status still `active`, evidence list unchanged) pointing at the now-dead chunk id. The digest was
also rewritten to include the warnings (see `lintPostFindings`, which additionally lists
`unsupported-claim` for the evidence-less `claim-tool`/`d2` claims).

---

## Verdict summary

| Claim | Verdict | Evidence |
|---|---|---|
| (a) wikiApply (evidence + contradicting claim) → wikiList/wikiGet/wikiLint over real WS RPC | **PASS** | `applyAlpha/applyBeta/wikiList/wikiGetAlpha/lint1` transcripts |
| (a.1) session-tool facades `wiki_apply`/`wiki_search`/`wiki_get` | **PASS** | `handleWiki*` transcripts (`/tmp/v23-wiki/out-tools.txt`) |
| (b) `claims.jsonl` + `WIKI.md` exist with expected content | **PASS** | on-disk contents printed |
| (c) digest byte-identical across two runs | **PASS** | identical sha256 `1916…` both runs |
| (d) dangling contradiction id + empty text rejected | **PASS** | RPC errors quoted; empty text also on tool path |
| (e) `wiki_apply` tool callback; `buildMemoryBlocks` byte-identical, wiki never injected | **PASS** | `blocksBeforeSha == blocksAfterSha`; claim on disk; text absent from blocks |
| (f) forget → lint `evidence-missing`, no crash, claim survives | **PASS** | `lintPostEvidenceMissing` + `claimAlphaSurvives` |

**All six claims CONFIRMED on the real surface** (real WS RPC, real files, product APIs).
`allPass = true` (harness self-check: files exist, digest identical, blocks identical, both
rejections raised, `evidence-missing` present, claim survived).

### Not proven / observations
- Only one `owner`-less scope ('workspace') was exercised; per-owner wiki isolation
  (`WikiClaimStore` owner filtering) was not driven over the socket.
- The 200-claim cap / 20-evidence cap / 2048-char truncation (`WIKI_LIMITS`) were not exercised.
- Claim overflow pruning and `retract` over RPC were not part of this row's claims (retract is covered
  by the slice's unit tests, not re-verified here).
- Tool-path nuance (d): `contradicts` is not part of the tool schema, so a tool caller cannot create a
  contradiction edge; the dangling-id guarantee is enforced on the RPC mutation that can.
- No failures reproduced; nothing left unproven within the row's scope.