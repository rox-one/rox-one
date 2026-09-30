# Открытые вопросы, рабочие defaults и способы закрытия

Baseline Macro `c966b79d40798c6c726a3b15fe90517941fc6e61`; ROX `f63294ba4fffa7238b46b24e918925a313ad0b12`. Это executable research backlog к Revision 2, не новая approval stage. Независимые implementation slices продолжаются по defaults; unknowns ограничивают конкретное действие/claim, а не весь проект. Coding agent закрывает вопрос наблюдением, runnable spike или документированным external decision с owner/evidence.

## 1. Decisions с существенной неопределённостью

| ID / owner | Что ещё неизвестно | Рабочее решение | Проверка / artifact / closure | Packages affected |
|---|---|---|---|---|
| **L1 — license owner** | Macro root `LICENSE.txt` AGPLv3 против web `apps/web/LICENSE` all rights reserved; scope отдельных imported files | **BEHAVIOR_REIMPLEMENTATION**; zero literal Macro source copy. Independently licensed upstream dependencies проверяются отдельно | file-scoped origin history, copyright/notices, exact package SBOM; qualified licensing review или explicit rights grant для literal copy. Closure artifact `component→origin SHA→license→changes→decision` | WP-48; любой PORT_SERVICE/literal adaptation |
| L2 — release owner | exact resolved dependency licenses; LiveKit/plugin/model/transcriber/ffmpeg build terms | Dependency-only upstream, preserve notices, никаких blanket MIT inference | lockfile+artifact digest SBOM и resolved LICENSE/NOTICE; codec build flags/model commercial terms проверены для deploy bytes | WP-10/31…34/42/47/48 |
| I1 — identity owner | canonical mapping local profiles, RoxCloud subjects, imported Macro users | Principal UUID + verified auth aliases; CRMContact/email остаются business identity | dry-run mapping counts/collisions; same human multiple devices fixture; quarantine ambiguous aliases, reversible mappings | WP-01/02/23 |
| I2 — migration owner | PersonalTask TaskProject и workspace ProjectConfig могут иметь одинаковые имена/разные IDs | Сохранять оба legacy alias до explicit mapping; no merge by title | inventory hashes/counts; migration report показывает authoritative project relation каждого task; collision fixture proves quarantine | WP-11…14/23 |
| D1 — architecture owner | deploy topology shared workspace: managed/self-host, server auth issuer, availability goals | New modular TS workspace service + Postgres/outbox; isolated local self-host test environment; standalone personal mode сохраняется | minimum private Project A/B/X through native RPC+HTTP + restart/readback; topology runbook with endpoints/issuer/secrets/TLS/backup | WP-01…05/47 |
| D2 — domain owner | workspace assignment для config-dir personal tasks, notes/mail local records | Не отправлять автоматически в shared workspace; personal namespace/explicit authority mode | inventory exposes unknown workspace; deterministic migration map and import provenance; personal regression suite passes | WP-05/11/16/17 |
| C1 — collaboration owner | React editor/CRDT schema/undo/cursor combination | Interface-first Loro candidate + independently licensed upstream; artifact Page renderer сохраняется | runnable two-user list/move/text/undo/offline/reload spike, schema version export, WAL quota/ACL revoke negatives; compare plain Markdown fallback | WP-10/15 |
| C2 — realtime owner | per-principal revocation propagation and maximum allowed lag | Server current ACL + policy epoch; synchronous denial/room eviction; projections async | revoke during awaiting append/send/read test; stale grants can't receive new payloads; metric/p95 budget recorded | WP-03/05/10 |
| C3 — product/domain owner | retained local plaintext/drafts после revoke/expiry | No future fetch/edit/merge; private quarantined draft export; already-read plaintext cannot be remotely un-read | explicit local cache/draft policy, signout/account-switch purge tests, expired WAL never silently deleted | WP-05/10/46 |
| M1 — messaging owner | legacy comments/channel facade migration completeness и generic discussion indexing | One common Message service, parent ACL; typed compatibility facade | compare old/new counts, tombstones/anchors/root mapping, CRM message search and agent read; event topic bridge replay | WP-08/09/15/25 |
| P1 — mail owner | providers needed for initial release и capability differences | Preserve current JMAP; provider-neutral contract; Gmail/Microsoft/IMAP adapters staged without false support | per-provider supported action matrix, isolated actual account read-back, token/cursor refresh failure suite | WP-17…21 |
| P2 — calendar owner | Google write scope, sync strategy, recurrence/availability semantics | Native Calendar domain; Google adapter with durable saga/etag; unavailable capabilities explicit | create/move/resize/RSVP read-back, token expiry/full sync, DST/series exceptions; fixtures can't satisfy live state | WP-27…30 |
| P3 — media owner | LiveKit hosting/TURN/egress/transcription vendor, guest security | Provider adapter, same Principal/Channel ACL; self-host viable topology evaluated; queued processing explicit | actual multi-user remote media test, egress object/readback, speaker mapping and guest denied asset; measured costs/limits | WP-31…34/47 |
| R1 — data-governance owner | retention periods for email, call media, transcript, search/memory, audit | Configurable typed policy; recordings opt-in, no silent indefinite retention assumption; no deletion of existing user data in planning | policy metadata fixture, retention dry-run report, restore/legal hold behavior, deletion cascade/index/memory purge tested | WP-26/33/34/39/47 |
| R2 — calls product owner | recording consent by participant/guest, withdrawal behavior and jurisdiction/deployment requirement | Visible recording indicator + explicit consent policy; consent state auditable; declined fixture has no recording assets | product policy and appropriate deployment/legal review; start/decline/withdraw/join-late acceptance; egress cannot bypass gate | WP-32/33 |
| S1 — search owner | initial full-text backend/scale; vector search justified by actual use | Postgres FTS shared, existing specialized Memory FTS preserved; SearchProvider port allows later backend | authorized name/content/task-property/transcript queries, latency/load/restore measurement; add vector only with measured relevant gain | WP-06/25/34/38/47 |
| S2 — event owner | ordering/delivery under outbox+consumer concurrency | At-least-once durable transport, idempotent effects; per-aggregate revision; inbox receipts/DLQ | crash matrix between persist/dispatch/consume/ACK, replay, stale revision controls; broker choice follows measured throughput | WP-04/06/07/37 |
| A1 — agent owner | host-specific outbound confirmation policies и provider pending/result mapping | Existing ROX execution safety plus common ACL; triad prevents fake completion; preview bound to intent/revision/epoch | rejected/pending/reviewed commands through native tool/MCP; allow-all viewer remains denied; provider timeout no duplicate send | WP-36/37 |
| A2 — memory owner | source-aware provenance/retraction model for existing Memory | Extend current Memory; source refs/revisions/current ACL; no replacing with Macro single profile blob | revoke/delete/edit source fixture rejects stale cached content; rebuild/provenance queries; bounded Company context | WP-06/36/38 |
| UI1 — surface owner | final Calendar/CRM/Channels placement within existing navigation | Extend existing destination/EntityResolver; no Macro-specific duplicate Tasks/Pages/Meetings | actual navigation/deep-link/panels prototype with capability gating; current destinations regression | WP-12/24/28/31/40 |
| UI2 — mobile owner | supported mobile/web clients and offline media/editor limits | Same contracts, explicit capability flags; desktop surfaces preserved | target-device matrix and real viewport interactions/background/reconnect; unavailable native capture explicitly labeled | WP-46 |
| E1 — evaluation owner | real production-scale SLO/cost boundaries | deterministic local test budgets only; production thresholds measured | load envelope, latency/backlog/storage/provider quota/cost evidence on chosen topology, not subjective scores | WP-41/47 |

## 2. Что source audit уже разрешил

1. **Root LICENSE Macro найден.** AGPLv3, не «LICENSE отсутствует». History commit `57a6c390927c774576d51d9e4fa94daeb04d5d32` заменил BSL. Web notice `apps/web/LICENSE` остаётся отдельной существенной ambiguity. Evidence и inventory в 18-licensing; source fact не равен blanket transfer permission.
2. **ROX unified contract уже существует.** Расширять `packages/core/src/rox2/platform-contract.ts:Rox2EntityRef,Rox2Relation,Rox2Event`; не новый competing EntityRef store. Typed seam не доказывает implemented distributed auth. ROX SHA выше, lines 107–141/218–239.
3. **Pages не rich-text editor на baseline.** `packages/core/src/types/page.ts:PageKind:1–35` описывает sandbox HTML artifacts. Добавить document representation, сохраняя artifacts; это target requirement.
4. **Tasks не один runtime.** PersonalTask recurrence/checklist/source существует (`packages/core/src/tasks/personal/types.ts:42–75`); Conductor YAML agent execution отдельно (`handlers/rpc/tasks.ts:1–47`). Их нельзя слить простым rename.
5. **Bro не полноценный distributed editor.** Server-resolved account identity есть; `packages/shared/src/collaboration/store.ts:BroInviteStore:23–86` использует process-local Maps и revoke не evicts joined presence.
6. **Macro unified messaging уже parent-aware.** `crates/messages/src/domain/models.rs:MessageParent:43–54` и current CRM parent migration поддерживают Company/Contact discussions; это разумный reuse semantics pattern.
7. **CRM search не отсутствует и не полностью OpenSearch.** `crates/search_service/src/api/search/crm_company.rs:resolve_crm_team_receipt:43–74` — PostgreSQL opt-in name/domain slice; полноценный Contact/message content projection требует отдельного target work.
8. **Macro Memory не generic entity fact graph.** `crates/memory/src/domain/service.rs:get_or_generate_memory:100–143`, `outbound/pg_memory_repo.rs:save_memory:20–39` — per-user generated profile/24h refresh/upsert. Это не причина заменять существующие ROX memory workflows.

Каждый code reference относится к baseline указанного repository; полные immutable permalinks/symbol ranges в `plans/macro-integration/evidence-*.json` и соответствующих 03/07…18 docs.

## 3. Вопросы, которые не превращаются в новые approval gates

Выбор рабочих port interfaces, adapter directory, test framework, local fixture topology, deterministic IDs, JSON schema version и outbox implementation — engineering decisions внутри уже разрешённого scope. Их принимает assigned owner, пишет rationale и проверяет relevant slice. Не спрашивать пользователя, какую surface исследовать или реализовать следующей; dependency DAG определяет очередность.

Exact public deployment endpoint/production credentials/customer export/recording policy требуется получить из текущего configured environment или ответственным owner. Пока эти внешние сведения отсутствуют, выполняются domain implementation, isolated provider contract tests и test-account spike; production claim не делается. Missing provider credential не отменяет готовые canonical entity/ACL/Message/task slices.

L1/L2 останавливают literal copying/release конкретного uncleared artifact, а не behavior reimplementation. Process boundary service deployment не доказывает юридическую независимость combined work. ADR должен описывать exact artifact/origin/deployment/reviewer decision; no “all open source therefore copy allowed”.

## 4. Identity/data migration decisions до переключения writer

Migration lead создаёт dry-run `migration-report` с source artifact hashes, schema versions, counts, immutable aliases и quarantines. Решения не выводятся из совпадения title/email/path:

- Macro `macro|email` сохраняется external identity alias; authentication merge требует verified subject.
- Provider contact email/domain создают CRM identities/provenance; они не workspace members автоматически.
- File path/Notes hash mutable/derived; registry ID стабилен через rename/content edit.
- Calendar recurring occurrence и series — distinct provider binding, нельзя key только title/start.
- Call provider room ID и Call entity ID — разные identities, recording/transcript не вторые Calls.
- Existing `MEETING_KIND='call'` compatibility сохраняется; независимый Meeting aggregate вводится только при доказанной lifecycle необходимости.
- Personal TaskProject→ProjectConfig ambiguity quarantines; old IDs и reverse map сохранены.

Closure: shadow reads совпадают по content/ref/ACL/link; writer переключается один раз; backfill/outbox replays idempotent; rollback routing не теряет новые writes. Production dataset не был мигрирован этим audit.

## 5. Retention, consent и deletion semantics

До live recording rollout policy определяет: кто вправе начать запись; как увидят indicator/newly joined guest; что происходит после decline/withdraw; кто читает recording/transcript; сколько хранятся raw media и derived assets; legal hold/backup expiration. Default тесты используют synthetic opted-in participants. Architecture не трактует media token как consent или recording read access.

Delete/hide/archive/retention — отдельные commands. Hide CRM не уничтожает email evidence; archive Task/Call не означает object erasure. Retention job применяет rule version, пишет receipt и обрабатывает object-store/search/memory/provider effects saga с retry. Already-read plaintext не cryptographically un-read; future access запрещается немедленно, caches/projections очищаются согласно policy. Metadata required audit может сохраняться отдельно от content с обоснованным retention rule.

## 6. Closure format и продолжение работы

Каждый вопрос получает owner, status `open|spike_running|resolved|external_dependency`, evidence artifact, decision/default, affected WP IDs, verification SHA и revisit trigger. При resolved вывод обновляет domain doc/DAG/WP acceptance; прежний PASS не переносится на изменившийся requirement. External dependency записывается конкретно: missing test account/scope/endpoint/right-to-copy/policy owner, а не «это сложно».

Порядок действий сейчас: WP-01 private shared Project actor boundary → registry/ACL/transaction primitive slices → runnable Page collaboration и Message→Task → provider mail/calendar/CRM → real shared call/media archive → whole Company account graph. License/provider/editor spikes идут параллельно той части, которая от них не зависит. Критическая проверка — все семь E2E сценариев 22-test-plan на implementation revision и preserved personal behavior, без UI-only claims.
