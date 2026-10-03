# ROX compound workspace: active implementation

## Scope and revision

Branch: `feat/rox-compound-workspace-20260930`; starting product revision: `b922e52ed96425732776ff771fdb4fec09fc99b6`. Normative specification revision: `242492868a11b4d9af1c1011f20b31a346875f0a`. The program contains 143 packages: 52 Macro, 30 existing Suite issues and 61 Lark/Docs/Code Intelligence extensions. Publication of specifications did not implement the product.

Current package state is in `plans/compound-implementation/progress.json`. Full features close only after their native domain, UI, persistence, permission, projection and applicable provider lanes pass. Partial evidence remains labeled with the exercised lane.

## First native wave

| Existing screen | Changed user behavior | Mechanism | Evidence boundary |
|---|---|---|---|
| Главная → Трекер задач | Subtle filled focus row and inset accent. Thin keyboard marker. IME Enter does not submit unfinished text; creation failure retains the draft. | Existing inbox bridge, new QuickTaskInput, actual app theme/font. | Browser component proof across themes, zoom, error, keyboard and IME. Product Home/inbox proof recorded separately. |
| Заметки → editor | Native authority badge; source-bound revisioned saves. Conflict, revoked access and source changes preserve the draft. Copy, retry and reload controls support recovery. Reload confirms draft loss. | Scoped resolver, source binding, serialized command queue, durable operation ID and filesystem WAL. | Actual WebSocket, persistence, concurrency, crash and source-revocation tests; Electron proof recorded separately. |
| Заметки → properties | Supported scalar edits preserve unrelated YAML and body bytes. Header conversion exposes exact До / После. Malformed YAML and opaque conversions are rejected. | Retained UTF-8, CST field patches and hash-bound preview. | Real gray-matter unknown-tag fixture and byte-exact assertions. |
| Проекты → Project → Ресурсы | Capture immutable repository snapshot, select file and read bounded source lines. Freshness is checked separately; local changes never rewrite an older excerpt. | Existing Project directory, Git snapshot store, local RPC and hash-bound FileSpan. | Actual Git, WebSocket, disk/restart tests; mounted Electron proof recorded separately. |

## Native document contract

A commit includes `workspaceId`, `noteId`, `sourceStoreId`, `expectedRevision`, `authorityEpoch`, `operationId` and `content`. The current server issues the source binding; it is a precondition and conveys no grant. Electron-main supplies the actor and current workspace/window ownership. Native Notes READ, SAVE and UPDATE_PROPERTIES are local-only in this wave. Shared/cloud clients need the authenticated domain transport planned by WP-01 through WP-05; device ownership is not a shared-user identity model.

Source root/window checks span awaited reads and the return boundary. When a write is durable but safe readback fails, `DOCUMENT_RESULT_UNAVAILABLE` preserves the exact operation and local draft for reconciliation. Historical receipts do not authorize replacing a newer source body.

WAL publication fsyncs prepared state, publishes via temporary file/rename, then persists a committed receipt. Replay validates actor/workspace/note/operation and fingerprint. Workspaces sharing one vault use a physical-file lease. Strict native owners refuse execution of older prepared journals lacking a source fence; generic stores retain their explicit legacy contract.

## Known limits and required next work

- Native identity is the current OS/Electron owner. Multi-user membership, resource grants and revocation transport require WP-01–WP-05.
- Native rename, daily generation, create/delete, folder lifecycle and Markdown attachment backlinks now share WAL/CAS. Binary attachment bytes retain their existing persistence mechanism. Durable invalidation acceptance is local callback acceptance, not client delivery ACK.
- A non-cooperating external process can change a file between final hash check and rename. This is not filesystem-level compare-and-swap against arbitrary processes.
- Dead-owner claim elections and synced owner publication are verified through real subprocess interruption. No timeout grants ownership of a live or SIGSTOP process. Windows directory fsync remains unverified.
- Map/Outline now use native committed stable tree and reviewed marker insertion. Editing every rich block through Map/Outline and lossless Tiptap round-trip remain later Docs gates; source previews do not close those packages.
- Epoch 1 represents native Markdown authority. A local path-bound source ID does not replace the later durable shared registry.
- New keys have parity across all 12 catalogs. RU/EN are authored; remaining catalogs use English fallback text for this wave.
- Full typecheck/i18n are not wholly green. Baseline diagnostics and the existing Russian wrap assertion failure are recorded separately.
- Repository snapshots do not establish running OpenWiki, GitDiagram, Groma or provider jobs. Runtime readiness and data-egress policy remain separate.

## Execution and continuation

The dispatch compiler binds packets to spec hashes, exact implementation revision, owned paths, runner profile and runtime source. It verifies actual nonempty Bun tests; unresolved gates fail explicitly.

The reviewed WP-01 contribution has two isolated Harness nodes: implementation and independent verification. Shared RPC/HTTP/Electron integration remains lead-owned and required before promoting EG-IDENTITY.

Seventy actual external OMP GPT 6.1 Sol/high sessions completed source preflight with revision/hash-bound reports. This is local execution, and no report closes a feature. The local Harness is supported; a generic cloud coding executor is not provisioned. A packet, checkpoint, queued native task and completed cloud deployment are separate states. Launch receipts and actual results must be read back.
