# Критическая проверка Specs, work packages и Code Intelligence

**Статус: COMPLETE_ARTIFACT_REVIEW — CR-01–12 разрешены в сохранённых спецификациях, execution contracts и publisher source.** Реализация нового UI, cloud launch и GitHub publication не проверялись. Дата: 2026-09-30. Product baseline: **e953786ba7e30fb5da5dca7e88e20e324d5aebab**. Review author: /root/rox_knowledge_design. После содержательных изменений lead повторяет artifact gates на окончательной delivery revision.

## 1. Объём и результат

Прочитаны фактические [01 live audit](01-live-product-audit.md), [05 Bases](05-rox-bases-design.md), [06 Docs](06-rox-docs-design.md), [07 entity model](07-domain-entity-model.md), [08 automations](08-automation-integration.md), весь [09 implementation plan](09-implementation-plan.md), [10 tests](10-test-plan.md), [11 decisions](11-decisions-open-questions.md), [13 Code Intelligence source audit](13-code-intelligence.md), [14 Code Intelligence UI](14-code-intelligence-ui.md), [work packages](../../plans/lark-suite-reference/work-packages.json), [DAG](../../plans/lark-suite-reference/dependency-dag.json), [CI catalog](../../plans/lark-suite-reference/code-intelligence.json) и [artifact tool](../../tools/lark-suite-reference.mjs). Сверка Obsidian claims использовала завершённый [04 audit](04-obsidian-reference-audit.md) и [source manifest](../../plans/lark-suite-reference/obsidian-sources.json); дополнительно просмотрен 03 business catalog.

**Архитектурные противоречия и CR-01–12 разрешены.** Native Tasks не становятся Base rows с независимым owner; Docs/Map/Outline имеют одно содержимое и один aggregate revision; вычисления фильтруются текущим ACL до derived operations; Code Intelligence source, inferred graph, curated C4 и generated Wiki различаются по authority/provenance. Следующая проверка CR-08–11 улучшила persistent validator, combined execution pack и baseline capability reuse. В конце прочитаны 09§11, 61 prepared issue draft и исправленный [publisher source](../../tools/publish-lark-issues.mjs). Проверка не доказывает будущий product runtime или actual GitHub publication.

## 2. Findings и фактические исправления

| ID | Приоритет | Состояние после readback | Evidence / принятое решение |
|---|---|---|---|
| CR-01 | Высокий | **RESOLVED_IN_SPEC** | 07§2: PersonalTask origin (sourceStoreId, ownerPrincipalId, nativeId); explicit workspace binding, no UI-workspace guess. LSX-002/004 и LT-26 проверяют wrong principal и ID collision. |
| CR-02 | Средний | **RESOLVED_IN_SPEC** | 07§6 и LSX-008/013/037 сохраняют legacy.markdownTaskCount.v1 / legacy.markdownOpenTaskCount.v1; relation.nativeTaskCount.v1 отдельна. Fixture 3 checkboxes/2 open + native1 остаётся legacy3/2, native1. |
| CR-03 | Высокий | **RESOLVED_IN_SPEC** | 06§10–11: один expectedRevision покрывает text/tree/epoch; epoch проверяется первым; structureRevision diagnostic. Shortcut/sequence совпадают с envelope. LSX-028/039 и LT-07/09 запрещают lost edit и subtree resurrection. |
| CR-04 | Средний | **RESOLVED_IN_SPEC** | 07 V2 расширяет actual Rox2EntityRef поля workspaceId/entityId/revisionId/accountNamespace. Parsed kind page + proposed contentKind=document/base/record, legacy note aliases; отдельный kind/id wire contract убран. |
| CR-05 | Средний | **RESOLVED_IN_SPEC** | 13§9/CI-002 и 14§3: remote-private offline default denied; optional signed actor/workspace/source lease expires fail-closed; reconnect invalidates. Немедленный remote revoke при disconnect не обещан. |
| CR-06 | Средний | **RESOLVED_IN_SPEC** | 13§6/9/CI-001/008 и 14§5: dirty working-copy digest отдельно от parent commit; changed bytes не получают точную parent-commit citation; source connection/repo/snapshot/tool/artifact digest задают idempotent import identity. |
| CR-07 | Средний | **RESOLVED_AND_SOURCE_CHECKED** | Registry ранее указывал первые comment/import mentions. Теперь PersonalTaskPersistStore:74, registerExternalBinding:336, PageConfig:294 и все остальные anchors сверены: 37 baseline blob hashes, 84 source lines, 0 comment/import anchors. |
| CR-08 | Средний | **RESOLVED_ARTIFACT_READBACK** | Persistent validator теперь проверяет baseline hashes/anchors, persisted DAG/topo, CI refs, combined ownership, normative worker/cloud allowlists, proposed-path absence и false launch states. Final report rejects11 corruptions. |
| CR-09 | Средний | **RESOLVED_PREPARED_CONTRACT** | Combined execution-packages/execution-dag:61 packages,161 edges,3 cross-program prerequisites, one integration-owner на66 shared paths; no executor launched. |
| CR-10 | Средний | **RESOLVED_PORTABILITY** | Absolute Mac Markdown links в13:56→0; catalog/source links переносимы. Local checkout остаётся metadata. |
| CR-11 | Высокий | **RESOLVED_SOURCE_RECHECK** | Validator обнаружил existing proposed types.ts. Новый audit покрывает6-file headless pack, registry/renderer/tests/callers; existing types/export moved to integration-only paths, actual40 seam hashes проверены. |
| CR-12 | Средний | **RESOLVED_PUBLISHER_SOURCE_READBACK** | Publisher заменил search index на paginated repository issues API, проверяет stable marker перед edit, packageCommit+Digest equality и local exclusive PID lock. Immutable body/input gates сохранены. Controlled retry и actual remote publication не исполнялись review. |

RESOLVED_IN_SPEC означает согласованный контракт и будущие проверки. Это не статус implemented/verified/deployed.

### CR-08 — Persistent validator: исходный gap и исправление

Первый snapshot tools/lark-suite-reference.mjs --validate проверял aliases/live refs, entity refs, JSON parse/Markdown links и DAG, **выведенный из WP dependencies**; persisted DAG/CI/cloud/ownership/source checks отсутствовали. После review добавлены persisted edge equality/topo, exact37 source hashes/84 declaration lines, CI source/entity/provider refs и40 baseline seam hashes, combined packet record pointers/ownership/cloud statuses/proposed-path absence. Дополнительное замечание о normalized/cloud allowlist mismatch привело к assertRouting против normative sourceRecord и двум соответствующим negative controls.

**Readback:** validation-report.json имеет PASS_ARTIFACTS_ONLY, productRuntimeVerified=false. Все11 negative controls rejected: cycle, unknown dependency, duplicate DAG node, persisted mismatch, invalid topo, duplicate worker path, fail-open unresolved input, fake run ID, product baseline as delivery revision, worker allowlist mismatch, cloud allowlist bypass. Проверки source/CI refs проходят на actual artifact set; infrastructure failure не counted как caught mutation. Validator практически обнаружил CR-11 до успешного rerun.

Независимые read-only checks сверили текущие contracts с §4. После финального изменения этого review lead повторяет --validate для final12 hash; новые bytes требуют новой artifact receipt.

### CR-09 — Общий launch boundary двух программ

Первый snapshot содержал46 LSX packets и15 отдельных design-only CI packages. Existing overlap найден для:

- packages/shared/src/protocol/channels.ts — LSX-003 и CI-004.
- packages/server-core/src/handlers/rpc/knowledge.ts — LSX-009 и CI-006.

**Исправление/readback:** [execution packages](../../plans/lark-suite-reference/execution-packages.json) нормализует все61 tasks с normative JSON pointers, packet allowlists/shared patch requests и одним integration-owner; [execution DAG](../../plans/lark-suite-reference/execution-dag.json) содержит161 exact edges и complete topo61. Cross edges: LSX-001→CI-008 same descriptor/aliases; LSX-003→CI-008 aggregate CAS/receipts; LSX-025→CI-011 same library/identity. Всего255 disjoint worker paths и66 shared integration paths; policy включает prior Macro/Suite leases. Workers не assigned, executor IDs отсутствуют; unresolved delivery placeholders fail closed. Это **prepared contract**, не runnable/accepted implementation или launch receipt.

### CR-10 — Переносимые ссылки 13

Первый snapshot13 имел56 absolute Mac Markdown links, непереносимых на GitHub/cloud. Final readback:0 таких ссылок; catalog/source/existing-test links относительные, upstream references pinned. Markdown relative link gate проходит.

### CR-11 — Existing Code Intelligence pack и source selection

Первый CI-001 объявил packages/shared/src/code-intelligence/types.ts новым. Persistent baseline-absence gate отверг это. Actual baseline содержит6 файлов/315 lines: types/index/local-adapter/explainer/sbom + adapter tests. Новый13/JSON включает40 existing seams и reuse этих contracts; types/index/public exports теперь integration-only patches, proposed types.ts отсутствует. Native RepoArchitectureExplainer component существует, но caller/mount proof не получен; UI source-string tests не стали actual UI verification.

Current pack alwaysOn=false; regex extracts declarations и contains edges, imports enum не реализует import resolver; commit caller supplied; content.length quota не UTF8 byte guarantee; secret/path hints ограничены; Syft injected optional runner no install. Root сообщил4 helper tests PASS/0 FAIL. Oversized test title не имеет oversized assertion; guards/transport/provider/UI этим не доказаны. CI-DEC-EXTEND-EXISTING-01 сохраняет rejected duplicate daemons и добавляет лишь proposed on-demand adapters. Placeholder capability inventory hashes/refs не трактуются как verified upstream pins. Reconciliation этой selection — явная future acceptance, не уже enabled provider.

### CR-12 — Publisher input integrity и crash recovery

Latest source требует verified package commit/digest, пересчитывает package digest, сверяет committed catalog/DAG/contracts и каждый body с immutable git revision, заменяет branch URLs на package commit. Numeric prerequisite links появляются после prerequisite readback. Title/body/open state читаются через GitHub API и должны точно совпасть. CLI использует argv и --body-file; cloud execution отсутствует.

Первый прочитанный snapshot получал recovery candidates через один gh issue list --search / limit200 до loop; crash после create и до local receipt мог оставить marker вне search index. Stored issue number редактировался до stable-marker check. Это были gaps из source control flow; actual duplicate/overwrite не наблюдался.

**Исправление/source readback:** listRepositoryMarkers теперь читает все repository issues через REST pagination100, исключает PR и не использует search index. До edit remote.body должен содержать ожидаемый stable marker. Resume проверяет packageCommit и packageDigest. acquireLock использует exclusive create, PID liveness и stale recovery; finally releases lock. Immutable body/input gates и exact body/title/open-state readback сохранены. Root сообщил node --check PASS; это syntax proof. Controlled crash/retry/concurrent-lock cases не исполнялись этим review и не объявлены proven; actual GitHub publication требует отдельного remote receipt.

## 3. Authority, ACL и источник claims

- **Content authority:** Markdown-first retained spans; rich-block cutover только explicit authorityEpoch migration. Independently writable JSON+Markdown отвергнут. No-op сохраняет bytes; text вне дерева, неизвестные YAML/comment fields, future geometry, BOM/CRLF не disposable. Existing Notes RPC optional CAS/read-check-write отличается от NativeNotesEngine — helper source tests не выдаются за UI pipeline proof.
- **Structural concurrency:** text CRDT convergence не обеспечивает valid tree. Semantic moves/reparents/delete ancestor сериализуются authority, сохраняют stable node IDs/attached prose; explicit rebase/conflict и undo inverse имеют preconditions. LT-07–10/LSX-028/039 определяют что должна отвергнуть будущая реализация.
- **ACL calculations:** 05/07/09 применяют row/field permissions до filters/sort/relations/formula/rollup/aggregate/export; denied field в predicate отвергается, denied value не zero. Actor/policy/snapshot-scoped caches; totals охватывают весь authorized query, не rendered page. Fixture 10/20/hidden900 ожидает30/count2/avg15, после revoke20 —10/count1/avg10; chart drilldown/export/lookup не получают hidden contributor/title.
- **Canonical Tasks:** Base/Doc/Planner/Form recipe вызывает native scoped Task owner; repeat promotion/import использует source+block/conversion origin и не создаёт второе done/status. Legacy checkbox formula и native relation count намеренно различаются.
- **Automations:** security.ts — shell escaping utility, не готовый actor ACL; RetryScheduler — webhook JSONL/single-process/at-least-once seam, не generic durable graph executor. 08/09 сохраняют эту границу. Retry logical step не меняет side-effect key; unknown provider outcome требует reconciliation; current policy проверяется при replay; approval pins immutable digest.
- **Code Intelligence:** source snapshots, search indexes, source graph, inferred GitDiagram, curated Groma C4 и Wiki link graph разные projections. Groma draft/stable — authored lifecycle, не confidence. Claim support требует semantic assessment + VerificationReceipt; valid URL/path не является доказательством statement. CI-006/015 имеет negative unrelated statement despite valid citation.
- **Source boundaries:** README/AGENTS/issues — untrusted scoped source data; scan не запускает package hooks. Exclusions применяются до indexing/remote context. Generated outputs не индексируются рекурсивно как original evidence. Private model egress/telemetry/credentials explicit through provider policy; Repogrep internal asset endpoint не становится public API.
- **Upstream facts:** Dynamic Views exact churnish repository и GPL, Highlightr MPL/package discrepancy, Buttons Unlicense/package discrepancy, Notion Bases GPL/package0-BSD discrepancy, Dragger headless/Tiptap gap сохранены. Charted Roots advanced interactive timeline roadmap не названа готовым runtime. 13 pins OpenWiki/GitDiagram/Groma/Zoekt и отмечает assumption OpenWiki identity и unknown Repogrep API/license. Literal reuse/dependency audit остаётся отдельным concrete adoption decision.

## 4. Выполненные independent artifact checks

| Проверка | Фактически получено | Граница proof |
|---|---|---|
| Live manifests | 34 unique observations; 63 unique capture attempts; все capture refs resolve; 0 mutationVerified; 63 valid SHA256 и privateLocalOnly | Не прочитаны private screenshot bytes и backend receipts |
| Limited privacy patterns | 0 email-like tokens и private Lark doc/base/wiki URLs в observations JSON; privateContentIncluded=false | Pattern check не является blanket privacy/security audit |
| LSX package/DAG consistency | 46 unique IDs; 116 exact dependency↔persisted-DAG edges; complete valid topo; 194 unique proposed worker paths; 31 integration-owner paths | Scheduler/leases не запущены |
| LSX packet contracts | Write/read-only/integration allowlists совпадают; tests входят в write allowlists; spec paths существуют; unresolved refs fail closed; statuses planned/no executor/no artifacts/no readback | Не resolved delivery revision, не implementation acceptance |
| Source anchors | 37 baseline blob SHA256; 84 stored source lines совпадают; 0 comment/import anchors | Source reading, не выполнение symbol behavior |
| CI machine graph | 15 unique packages; 42 dependencies; acyclic topo15; 61 unique proposed paths; 0 LSX new-file overlap; все proposed paths absent at baseline | CI tasks design-only; no product/cloud jobs |
| CI refs | 50 unique source IDs; provider/entity/seam refs resolve; 22 conceptual relation refs resolve по names;40 baseline seam SHA256 совпадают | Upstream runtime/performance не исполнялись review |
| Combined execution | 61 tasks;161 exact edges;3 cross-program dependencies;255 unique worker paths;66 integration paths;0 normative allowlist/topo errors | No executor/lease acquired/runtime acceptance |
| Persistent validator | PASS_ARTIFACTS_ONLY; productRuntimeVerified=false;11 seeded corruptions rejected | Future runtime gates остаются unexecuted |
| Prepared publication catalog | 61 unique drafts; topo61;61 exact body digests и markers совпадают | --publish не исполнялся review; remote delivery отсутствует в этих checks |

Initial CI check ошибочно сравнил relationship endpoints с CI-E-* IDs, хотя каталог использует canonical entity names. Это reviewer validator schema mismatch; после проверки actual records корректный name-based check даёт22/22 resolved, **не finding против каталога**. Infrastructure/process waiting не counted as product proof.

Ранее исполненные отдельным source audit **35/35 Ideascape pure map-file tests** и ограниченный ROX engine probe сохранены в04. Они не означают verified collaboration/server ACL/Tiptap lossless roundtrip. Этот review не запускал новые product UI, scanners, model generation, provider mutations или cloud workers.

## 5. Input snapshot этого review

Product baseline закреплён выше. Существенные прочитанные артефакты имели SHA256:

| Artifact | SHA256 |
|---|---|
| 09 implementation plan, включая §11 | 7cdfbe2aa8b75d343b1a9a1c5630b66d776b8e7e8f98e95226586f91515133bb |
| 13 Code Intelligence | 3b02aede2c134158b3cc4c3afb21d58639a0bf7000563ab4c5f46da14f101b05 |
| 14 Code Intelligence UI | 2c07a58511e385a7bef7d8630d333c685b924fb8e71819cf2215c097107b3c75 |
| work-packages.json | c1ca060939ee4410acc15f86a57cf11d194590880d36076d011bb62c19452952 |
| dependency-dag.json | c4d88298832d867cc586f2e2310ec7e8fd9fd15494e98ca5e0829bb336f2eaea |
| code-intelligence.json | a3ef06c0e4cdff83ce5bf18ab15400b7d1eeab3dcf13e77081a5681ecf2fd5a7 |
| execution-packages.json | c79e411bf85e84f7e83c75983280f5de76838847d576054e373e27bd20d6713b |
| execution-dag.json | 56979e22dd9500a2d079889a108c6e4f88718eca2ce55f705f70b7718b5900a5 |
| artifact tool | 08986296ef6a641a407a688c7cded39d7815cdd5ec0219eb62117f4a7aa18789 |
| publisher source | d1be12977d50b2298cb6f6da2f58d15ff91ccc0e63374f9fd902268330a09d40 |
| publication-catalog.json | 4773c1bd18570618978b84aa08a787df840c9ae167be4a5d1140233ec928b1d5 |

Root delivery manifest/validation report может закрепить более новую исправленную revision. При закрытии CR-08/10 findings обновляются по actual readback; старые hashes не доказывают новые bytes.

## 6. Итог и implementation gates

Design пригоден для implementation decomposition: owner identity, authority/CAS, stable tree, ACL-derived queries и native task reuse определены; LSX/CI packets имеют конкретные contracts/tests/DoD; Code Intelligence расширяет existing off-by-default pack и не повышает generated claims до source authority. CR-01–12 разрешены в артефактах/source; runtime completion не заявлено. До launch нужны exact delivery commit/digest, readiness receipts native owners/providers, actual assignment и leases по combined execution policy.

До product completion требуются actual UI happy/failure/reload; two-client edit/move/delete/reconnect; ACL negative totals/cache/agent/export; crash/retry/receipt/outbox; schema/import/export preservation; source-index coverage/provider ACK/agent transport по задействованным lanes. Seeded mutation должна провалить named semantic assertion. Cloud scheduling, deployment и runtime completion не inferred из этого review или количества source tests.
