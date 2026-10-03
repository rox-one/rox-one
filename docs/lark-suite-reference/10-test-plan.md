# Verification, expected results и Definition of Done

**План runtime проверки — ещё не исполнен.** Дата 2026-09-30. Исполненные проверки исследования перечислены отдельно в [README](README.md) и validation report. Исходники ROX `e953786ba7e30fb5da5dca7e88e20e324d5aebab`; новый код Docs/Bases не реализован этим пакетом.

## 1. Proof contract

Для каждого work package coding agent приносит: input source/spec digest; output commit; изменённые paths; build/test commands и exit/status; expected/observed values; test seeds; runtime identity/environment; UI screenshots/video hashes; API/DB receipts без private content; failure/recovery observations; regression proof; independent evaluator verdict. Fixtures, simulated provider output и статические screenshots имеют отдельный статус, не production pass.

Обязательные уровни: unit/property для invariants; integration для persistence/authorization/event delivery; actual UI для пользовательских взаимодействий; provider sandbox для provider ACK; two-client E2E для concurrency/reconnect. Нельзя заменить E2E утверждением «есть компонент», а ACL — disabled кнопкой. Private тестовые данные синтетические и scoped; customer captures исследования не входят в CI fixtures.

## 2. Набор сценариев

| ID | Setup / input | Action | Expected result | Negative control |
|---|---|---|---|---|
| LT-01 | Existing note ID + backlinks + old view | Migrate/open/reload | Same ID/content/route, view v1 still decodes | Broken alias changes ID → reject |
| LT-02 | UTF-8/BOM/CRLF/YAML/prose/table/code/unknown metadata | No-op save and edit one list item | no-op byte-identical; only intended range changes | Whole-file newline normalization → fail |
| LT-03 | Unsupported prose + malformed map geometry | Open map | readable prose retained; metadata warning; no overwrite | Empty geometry rewrite → fail |
| LT-04 | Conversion preview revision R | External edit before confirm | conflict/new diff, no overwritten source | Ignore expectedRevision → fail |
| LT-05 | Same note Document/Map/Outline | Add child, sibling, marks and checkbox | same content/IDs after each view/reload | Independent map text store → divergence detected |
| LT-06 | Node branch + attached prose | Reorder/reparent/undo | subtree and prose preserved; ancestor cycle denied | Allow self-descendant drop → fail |
| LT-07 | Two users same aggregate revision | A text edit, B branch move/delete ancestor | valid tree + text at stable node or explicit conflict | Drop late text/auto resurrect branch → fail |
| LT-08 | Offline queued structural intent | Other user reparents same node; reconnect | draft retained, valid rebase or review conflict | Blind replay old line offsets → fail |
| LT-09 | Authority epoch changes | Retry stale mutation | rejected before apply/rebase | Check revision only → fail |
| LT-10 | Local edits + remote edits | Undo/redo | inverse only local semantic action; remote preserved | Snapshot rollback wipes remote → fail |
| LT-11 | IME composition + map shortcuts | type Japanese/Russian, arrows/tab | composition/caret owns keys in editor | global shortcut captures composing Enter → fail |
| LT-12 | Keyboard-only / 200% zoom / light+dark | traverse library/editor/docks | visible focus, labels, no trapped panel/overflow | Remove focus style → evaluator rejects |
| LT-13 | Touch 390×844 + reduced motion | outline drag/indent/style, pinch/zoom | ≥44px controls, alternate buttons, no motion dependence | pointer-only handle → fail |
| LT-14 | Selected text with duplicate quote elsewhere | create comment, move block | same stable anchor after revision/reload | quote-only first-match anchor → fail |
| LT-15 | Anchored block deleted | inspect/resolve/re-anchor | orphan retained, explicit reanchor receipt | silent deletion or guessed reattach → fail |
| LT-16 | Mention teammate without target/source read access | submit comment | body stored under source ACL; recipient not leaked/notified | fanout before ACL → fail |
| LT-17 | Same comment idempotency key retry | crash after ACK, resend | one message/event/notification | new key per retry → duplicate fail |
| LT-18 | Editor loses permission while open/offline | edit/reconnect/search/cache query | denied, protected data removed, draft quarantine per policy | cached ACL replay → fail |
| LT-19 | Legacy private Markdown comment | migration preview | visibility shown, no auto team publication | all comments shared by default → fail |
| LT-20 | Highlight selection with nested link/HTML | mark/custom color/unhighlight/export | only mark changed; link preserved, safe style | strip all HTML / script retained → fail |
| LT-21 | Tabs/columns with embedded TaskRefs | edit/reorder/delete/undo/index/export | semantic children retain IDs; tasks discoverable | parse code fence only → missing task fail |
| LT-22 | Code block hide/group/highlight/export | copy/print/accessibility | raw code retained, hide not redaction, all tabs exported | hidden lines omitted as 'secure' → fail |
| LT-23 | Imported command button with unsafe payload | open note then click | passive inert; registered validated command only | open executes JS/shell → fail |
| LT-24 | Chain step2 fails after step1 committed | run/retry/cancel | per-step receipts; explicit partial effects; idempotent retry | pretend rollback completed → fail |
| LT-25 | Base source native Task | edit due/owner/status in Table/Board | same native Task revision as Tasks page | writes CustomRecord duplicate → fail |
| LT-26 | Two source stores/workspaces same native taskID | query/link/update | owner+source bindings isolate refs | globalID-only lookup → leak fail |
| LT-27 | Old formula taskCount and promoted checkbox | migration + relation count | old checkbox meaning unchanged, unified count no duplicate | swap builtin semantics silently → fail |
| LT-28 | 18 typed fields incl decimal/date/null/invalid | edit/import/export | roundtrip valid types, clear errors; decimal exact | money Number coercion → precision fail |
| LT-29 | Relation cycles/large inputs/unsafe formula | validate/evaluate | typed errors, budget stop; no eval/network | arbitrary JS formula accepted → fail |
| LT-30 | Viewer hides related rows/fields | rollup/chart/export/cache | totals only permitted data; no owner cache leak | owner aggregate reused → fail |
| LT-31 | View version changes while paginating | sort/filter/cursor next | revision-bound consistent results or reset | old cursor silently duplicates/skips → fail |
| LT-32 | Bulk mixed allowed/denied/stale rows | update/move/export | per-entity receipts, no fake atomicity | one success status masks partial → fail |
| LT-33 | Gallery media unauthorized/missing | image load/carousel | safe derivative authorization and placeholder | public raw file URL leak → fail |
| LT-34 | Board drag / Calendar day / Timeline resize | edit native source fields | typed command, constraints, durable reload | visual move only → fail |
| LT-35 | Published Base form with validated required fields | submit same request twice | one response/native record, receipt and event | retry creates two rows → fail |
| LT-36 | RRULE + materialized occurrence | completion/reschedule/exceptions | one occurrence keyed by parent+date, provider state explicit | virtual+materialized duplicates → fail |
| LT-37 | ICS read-only / Google-Microsoft writable adapters | planner drag | ICS rejects edit; writable shows queued then ACK/conflict | optimistic local toast claims provider success → fail |
| LT-38 | Time tracker across devices/process restart | start/stop/resume | chosen one-active policy; durable segments | double active segments unnoticed → fail |
| LT-39 | Automation event duplicated/crash after effect | restart/resume | same immutable workflow+step key, one effect | new effect key after restart → fail |
| LT-40 | Schedule DST fold/gap + missed runs | next5/catch-up/run | documented timezone policy and bounded occurrences | server local timezone only → fail |
| LT-41 | Workflow permission revoked/payload changed | resume approved run | denied or reapproval; no stale capability | old approval permits new payload → fail |
| LT-42 | Personal/shared views/settings | device2 open/reload | shared config durable, personal viewport separate | localStorage-only shared save → fail |
| LT-43 | Search/memory stale event order | latest then older event delivered | revision fence rejects stale projection; freshness visible | old event reverts title/content → fail |
| LT-44 | Agent tool same actor vs privileged direct handler | read/update/export | same ACL/validation/revision as UI | MCP bypass accepted → fail |
| LT-45 | Custom imported relationship/evidence graph | branch export/merge | provenance and privacy preview, no User/contact merge by name | import surname overrides identity → fail |
| LT-46 | Document revision approved/signed then edited | approval/signature display | exact digest pins revision; changed version flagged | prior signature shown for new content → fail |
| LT-47 | Domain file write crash before event checkpoint | restart | recover atomic content/receipt/outbox or explicit repair | durable content missing event forever → fail |
| LT-48 | Cloud task spec unresolved/digest stale | scheduler launch preflight | reject missing package revision/ownership/proof contract | baseline-only checkout called ready → fail |
| LT-49 | Project repo with excluded secrets + escaping symlink | scan/search/generate | only approved source read; no hooks/scripts run | follow symlink or execute package script → fail |
| LT-50 | Dirty working copy differs from parent commit | search/wiki citation | manifest-digest snapshot and local authorized citation; not false Git SHA evidence | cite parent commit changed line → fail |
| LT-51 | Repo aliases/repeated wiki/Groma import same digest | retry/import | same generated artifact mapping, human page/model preserved | duplicate pages or overwrite curated model → fail |
| LT-52 | Claim cites existing file but asserts unsupported fact | claim support check | unverified/disputed/inferred, never Source-verified | URL existence-only verification → fail |
| LT-53 | OpenWiki page job interrupted then source moves | resume/finalize | checkpoint retained; drift quarantined/replanned, stale publish blocked | old page labelled latest snapshot → fail |
| LT-54 | GitDiagram inferred edge/scanner uncovered language | inspect diagram | inference/method/coverage explicit; no false verified absence | endpoint existence marks edge verified → fail |
| LT-55 | Groma initialized empty repo or failed scanner | architecture overview | empty/unknown/failure with receipt; no architecture quality pass | setup success labelled audited → fail |
| LT-56 | Private repo access revoked / offline lease expired / provider send disallowed | cached search/wiki/diagram/answer/reconnect | default no remote-private offline read; bounded enabled lease expires fail-closed; reconnect invalidates; no unapproved source transmission | unbounded cache/lease renewal offline or repo prompt bypass → fail |

## 3. Property-based generation

Generate deterministic Markdown with mixed newlines/BOM/frontmatter/nested lists/opaque blocks/duplicate quotes/unicode. Invariants: parse/serialize no-op stable, edit preserves untouched spans, unique IDs, no parent cycles, map/outline equivalent, undo reversible under specified revision. Generate random typed filters/formulas/relations with bounded graph; permissions monotonic under revocation; a less privileged actor never sees extra fields/counts. Seeds and minimized failing inputs stored with output commit.

Mutation sensitivity: seed whole-file normalizer, ignore CAS/epoch, first-quote anchor, unsafe formula eval, owner cache reuse, missing event dedup, global taskID lookup. Each must fail the intended assertions. Infrastructure failure does not count as mutation caught. Optional broad suites rerun only for concrete risk or project gate.

## 4. Actual UI acceptance routes

1. **Doc→Outline→Map:** create doc from template, add child/sibling from keyboard, format, fold/focus/find, switch views, close/reload, export/open raw Markdown. Expect preserved exact IDs/content. Run native font and reduced-motion check.
2. **Two users and comments:** A edits, B comments selected range; A moves source; both see anchor. Revoke B while offline; B reconnects gets denied, no notification/search leak. Preserve orphan after source deletion.
3. **Task→Base→Planner:** edit existing task in Base Board, open Tasks same ID/revision, schedule from Planner, provider ACK if configured, index/agent context backlinks. Read-only ICS deliberate failure.
4. **Company→Base→Doc:** Company native projection with Contacts/Mail/Tasks; embed filtered view in Doc; restricted viewer sees permitted subset and aggregate; export matches same scope.
5. **Form→Automation:** form submits typed fields; creates existing Task; assignee notification; duplicate delivery one result. Crash executor then resume. Agent step produces reviewable proposal, no unauthorized write.
6. **Action→Approval→Signature:** button pins doc revision; approval waits; edit document invalidates request; receipt visible in common Activity; revision-based export verified.

## 5. Release gates

- **Artifact gate:** schemas/refs/DAG/source paths valid; no raw customer captures; exact doc digest and delivery SHA recorded.
- **Implementation gate:** source revision/work ownership known, build + targeted tests pass, seeded negative controls prove sensitivity.
- **Product gate:** real app happy/failure/reload/concurrency proof, font, keyboard/touch accessibility, loading/empty/error/denied states.
- **Provider gate:** sandbox OAuth/scopes and actual remote readback; missing credentials marked dependency, no synthetic PASS.
- **Delivery gate:** output commit/push/remote byte readback, reviewer result, migration/rollback receipt, deployment only if separately in authorized execution scope.

Feature checklist: UI/routing/domain/persistence/commands/queries/realtime/permissions/sharing/search/mentions/notifications/activity/agent/API/observability/tests/docs/failure/loading/empty/offline/reconnect. A deliberate not-applicable item requires domain reason; unchecked required item prevents complete status. Current pack is **PREPARED_NOT_LAUNCHED**.
