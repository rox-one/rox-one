# Revision 4 — независимый review

Дата: 2026-09-30. Reviewer: macro_collab. Scope: root-authored cache upgrade/source revalidation, shared interaction labels/help, generated control handoff и соответствие collaboration walkthroughs. Центральные contracts, generators и runtime code reviewer не изменял.

## Проверенное состояние

- ROX checkout: `249b3b44220bcfbd7d467de9cfc18f76e1c37807`; новые Revision4 files ещё рабочие artifacts. Exact SHA-256 bytes ниже.
- Latest audited Macro: `767a999a5f0901896959ee1f5b315999b1dea0ed`; previous `5678f9bd777413f66e8bddac58f13f21150d831b`.
- `node --test scripts/macro-integration/control-handoff.test.mjs`: **3/3 PASS** на initial reviewed bytes. Это planning tool suite, не UI/runtime pass.
- 308 evidence records: независимо перепроверены original/previous/current git blob triples. **PASS**: 303 identical-source, 5 reviewed changes; один ранее cited blob изменился после Revision3.
- Все 9 latestMacro delta ranges: blobs, pinned URLs и line bounds совпадают; source snippets прочитаны. Latest delta: 63 files.
- Shared catalog: 18 screens / 48 RU labels и authored meaning/source/freshness/example help. Generated handoff: 61 screens / 219 controls; current UI owners есть для всех61.
- Collaboration walkthroughs: 39 actions разрешают реальный COL screen/control/current primary UI owner; canonical refs/workspace boundaries и runtime_NOT_RUN сохранены.
- Macro tests и ROX product/browser/native scenarios этим reviewer **не выполнялись**.

## Source delta / cache recovery

| Evidence | Проверенное поведение / граница |
|---|---|
| V4-SRC01 reloadForNewerBuild.ts:52–98 | Automatic reload требует hidden+online+no hold+no focused nonempty editable text; explicit prompt обходит эти checks. Механизм сам не гарантирует сохранность drafts. |
| V4-SRC02 retirable-host.ts:4–58 | dispose переводит captured host в noop; writes dropped и source optimistic queue bypassed. Target не переносит bypass в authoritative journal. |
| V4-SRC03 coordinator-takeover.ts:3–110 | Wire takeover v1, scope/database channel, unknown-field tolerance; build identity отличается от storage protocol. |
| V4-SRC04 coordinator-router.ts:1742–1775 | Только active database holder отвечает; newer buildTime yields, equal/older don't. Cache supersede не является бизнес receipt. |
| V4-SRC05 CallContext.tsx:1632–1670 | Lifecycle не idle/failed удерживает automatic reload, cleanup освобождает; не guarantee manual reload continuity. |
| V4-SRC06 upload.ts:410–458 | Hold до finally, включая error path. |
| V4-SRC07 browser.rs:1730–1792 | Bounded NoModificationAllowedError retry: production10s/test400ms/backoff2→512ms. Busy не основание для wipe/corruption diagnosis. |
| V4-SRC08 graphql-soup.ts:459–502 | Retirable host + worker onSuperseded reload; storage unavailable → uncached network fallback. |
| V4-SRC09 reloadForNewerBuild.test.ts:55–137 | Hidden/visible/manual/offline/holds/text/once cases прочитаны; не executed. |

ADR правильно отделяет disposable authorised cache, durable command journal, document WAL/schema/frontier и writer/policy epochs. Recording target hold обозначен PROPOSED и не приписан найденным call/upload source snippets. Native restart не смешан с browser hidden-tab reload.

Privacy: checkpoint не выдаёт source.export; retired cache не обходит current policy/idempotency; revoke replay проверяет epoch. Walkthrough ограничивает remote offline erasure: disconnected устройство нельзя стереть по server fence. Note conversion withinW1 сохраняет ref, cross-workspace transfer требует mapping. Source-backed противоречие в этих границах не найдено.

## Findings на initial reviewed bytes

### R4-P2-01 — validator проверяет не всю identity/proof

`control-handoff.mjs::validateHandoff` проверяет id, primary owner, input/output, label/interactions, control selector, testFile/source/status. Он не сверяет `testHook.root`, `screenId`, `controlId`, `featureOwners`, `proofRequirements` с generated expected.

Hermetic in-memory mutations каждой характеристики независимо дали errors=[]:

| Seed | Expected | Observed |
|---|---|---|
| root selector COL-01→SH-18 | selector drift denial | accepted |
| screenId COL-01→SH-18 | identity drift denial | accepted |
| controlId create→snooze | identity drift denial | accepted |
| proofRequirements→[] | missing proof denial | accepted |
| featureOwners→[WP-48] | ownership drift denial | accepted |

Неполнота planning validator подтверждена; текущий handoff не содержит этих mutations. Исправление: полная составная identity/root/owner/proof equality, `id = screenId + "." + controlId` и пять specific negative assertions.

### R4-P2-02 — canonicalOperation некоторых help records содержит wrapper

`shared-interactions.json` расходится с `cloud/contract-amendments.json::dispatcherAliases`:

| Control | Declared canonicalOperation | Canonical authority |
|---|---|---|
| SH-03.star | preferences.setFavorite | favorite.set |
| SH-07.toolreceipt | agent.executeCommand | agent.invokeDomain |
| SH-08.publish | session.publishExport | session.shareAuthorized |
| SH-13.cell | sheet.setCell | spreadsheet.editCell |
| SH-14.node | canvas.patchRevision | canvas.save |

Aliases допустимы как adapters; неоднозначно слово canonical. Generator использует записи для label/help/source и не делает runtime dispatch, поэтому false runtime mutation не заявляется. Исправление: wrapperOperation отдельно, canonicalOperation resolve к authority; regenerate help/source/handoff. Receipt-opening click остаётся read/open gateway; источник receipt не означает execute-on-click. Negative invariant: alias не регистрирует второй dispatcher/store/outbox.

## Walkthrough selector / lane / identity

- COL canonical root/control markers совпадают с handoff; existing selectors compatibility aliases, новые markers пока proposed.
- 19 COL primaryUiOwners не изменились в 61owner map; все39 action owners согласованы.
- Human Channel/DM — Project contextual view; Sessions — agent transcript, без новой native destination.
- Fixture refs channel-message:M1/task:T1/page:P1/note:N1/project:PJ1 используют существующий kind:id/workspace. Views не копируют entity; новые recurrence occurrences получают отдельные IDs.
- Lanes domain/renderer/native — future gates. Fixture renderer не подтверждает server durability/revoke/provider. В этих пяти flows нет provider-side write, требующего выдуманного provider-live pass.
- App/cache drain отдельно от CRDT ACK/WAL/local durable receipt; offline/device limits явно описаны.
- Manualsource/export mapping соответствует canonical backlink_only/approved_export, source ACL не расширяется.

## История и разрешения

Initial review передал lead две P2 группы выше. Статус обновляется по exact новым bytes после owner corrections. Первоначальный suite pass не доказывает sensitivity отсутствовавших checks.

Product runtime: **NOT_RUN**. Planning checks не feature completeness или cloud launch.

## Exact reviewed bytes

| Artifact | SHA-256 |
|---|---|
| scripts/macro-integration/control-handoff.mjs | 699b622cc79a7d79ee9c41c3c8f79ee4e79d89e94b0ee87e41b68c4048e1395a |
| scripts/macro-integration/control-handoff.test.mjs | 07ff951670618c92bb98828216de6cabb18875566f7b39b8eaa2e9cbde4ea01b |
| scripts/macro-integration/build-shared-screens.mjs | e0578ff3c2674d856b73be5269e19ba263a7c7acc92ad1774c2d2e2f184a43a3 |
| scripts/macro-integration/reverify-v4.mjs | 8cd578781915e2a31676087b25befe8ed11b377e99d23770dd87f26542a7ed2d |
| plans/macro-integration/shared-interactions.json | 14665c52a5e65e9828e497bc8405b43b8554e9472dae0957e8237c31a7092665 |
| plans/macro-integration/control-handoff.json | 57680f3e2cf7decb9dad61f2bef1220dc6c78eecb741ea108e1003e384d817ca |
| plans/macro-integration/source-reverification-v4.json | 8a050880d36c4d7ec49162fb160d323e562dae55a50191a51ace0d9bb178b39d |
| docs/macro-integration/product/cache-upgrade-recovery.md | da5bbb8bf719696e53d6d57d82ce9b3004fd9c02eb22fd6040732e03f3dea7d6 |

## Final recheck — исправления owner подтверждены

2026-09-30, повторное чтение exact current bytes после owner corrections. Предыдущие findings и initial hashes выше сохраняют историю; этот раздел фиксирует итоговую проверку.

- **R4-P2-01 RESOLVED**: validateHandoff теперь сравнивает screenId, controlId, featureOwners, proofRequirements и весь testHook с generated expected. Независимый повтор пяти in-memory seeded mutations отклонил **5/5**; файлов repository не менял.
- **R4-P2-02 RESOLVED**: все пять отмеченных records теперь имеют отдельный wrapperOperation и canonicalOperation общей authority. Независимая проверка exact пяти пар дала **5/5 PASS**. Alias metadata не означает вторую authority; toolreceipt click остаётся открытием read receipt согласно authored meaning.
- Актуальный запуск node --test scripts/macro-integration/control-handoff.test.mjs: **4/4 PASS**, 0 failures/skips; suite проверяет 61 screens / 219 controls и specific mutations. Это проверка planning tooling, не product/runtime/cloud pass.
- Две первоначальные P2-группы закрыты для проверенных bytes. Product/browser/native/provider runtime остаётся **NOT_RUN**.

| Final artifact | SHA-256 |
|---|---|
| scripts/macro-integration/control-handoff.mjs | 724ec9f8c502e26677447d592d78169f1a5f9e7f16b8c343b3ae4ace5f6537fb |
| scripts/macro-integration/control-handoff.test.mjs | 76a76f3aa978ebe376f8dc0c97e8f0a8f4e5e88d1da0a297cafde2bf648a591c |
| scripts/macro-integration/build-shared-screens.mjs | e0578ff3c2674d856b73be5269e19ba263a7c7acc92ad1774c2d2e2f184a43a3 |
| plans/macro-integration/shared-interactions.json | d3b0065fb16c385db0bc62515b3d3990f43664d920744813d40752e16fafa68c |
| plans/macro-integration/shared-screen-contracts.json | af48f378a818dd9b9775276af6306b8fb8d881aa70d8b53db99c1e7f8594dd9c |
| plans/macro-integration/control-handoff.json | 4b90be16479699a99468f1e34db25d5fd2d2ade55f6ee080e667f47ace106465 |
