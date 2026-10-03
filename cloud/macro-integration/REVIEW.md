# Независимый review cloud coding packet — Revision 3

Дата: 2026-09-30. Scope: runnable planning tools и доказательность перехода между work packages. Reviewer: отдельный агент macro_collab; scripts, schema, generator и центральные work packages этим reviewer не изменялись.

## Заключение

Packet подготовлен; запуск coding workers и feature runtime этим review не выполнен. Текущие targeted gate tests **10/10 PASS**, CLI **planning-integrity-only PASS**: 52 work packages, 60 screen contracts, 216 controls. Синтетические отрицательные проверки ниже подтвердили исправления authority/dependency/proof/resource checks. Это доказательство поведения инструментов планирования, а не реализации Collaboration/CRM/Calls.

Source baseline ROX: f63294ba4fffa7238b46b24e918925a313ad0b12; reference checkout e780e73ae84c977cf81546b49140d318dfcd6049, исходники приложений на этих двух SHA совпадают. Новые cloud scripts на момент review ещё рабочие artifacts; их точные bytes зафиксированы SHA-256 ниже, поэтому ссылки на строки относятся именно к этим проверенным bytes.

## Проверенные команды и наблюдения

| Проверка | Expected | Observed |
|---|---|---|
| node --test scripts/macro-integration/cloud/gates.test.mjs | Каждый meaningful gate test проходит | 10 pass / 0 fail |
| node scripts/macro-integration/cloud/cli.mjs validate | DAG, screen/control IDs, affected files, full spec inputs и packet/prompt bytes согласованы | passed; planning-integrity-only; 52/60/216 |
| COL screen JSON/source ranges | 19 screens, уникальные controls, существующие source refs на pinned SHA | 19 / 96 / 32 verified source ranges; markdown fences balanced |
| Hermetic transitive A→B→C: представлен B receipt без A | C не ready, B receipt не verified | ready=[A]; B rejected «verified receipt without verified transitive prerequisites» |
| Hermetic actual Git: receipt claims owned file, output commit реально меняет unowned.ts | Denial before successor | «self-declared changedPaths differ from git diff» |
| Hermetic ARIA tamper после valid renderer receipt | Denial по hash | proof checksum mismatch |
| Hermetic mutant log tamper после valid receipt | Denial по hash | proof checksum mismatch |
| Только caught:true без hashed baseline/mutant evidence | Не принимать sensitivity | negative control missing linux-renderer |
| Renderer 9GiB disk vs 16GiB, CPU2 vs CPU4, Darwin vs Linux | Машина не ready | blocked для каждого; Linux/16GiB/CPU4 соответствующий fixture ready |

Hermetic probes использовали отдельный mkdtemp каталог и крошечный Git repository; всё собственное temporary state удалено в finally. Реальный repository, приватные данные, provider credentials, внешние сообщения и deployment не изменялись. Синтетические строки screenshot/ARIA проверяют checksum gate; они не выдаются за скриншоты приложения.

Локальный Node при этих проверках v26.8.2; проверялся чистый JS gate code. Production/worker Node22 и Bun1.3.14 пока не запускались в cloud lane. Синтетический compatible-machine fixture проверяет функцию preflight; он не доказывает готовность текущей машины.

## Исправления, подтверждённые review

1. **Source fidelity digest.** build.mjs:14–16 включает все три leaf screen-contract JSON и authoritative PRD/UI/architecture/license/WP/DAG/cloud instruction/schema/tool inputs в manifest.specInputs и specDigest. Смена поведения private source export теперь меняет source bytes hash даже при неизменных control IDs.
2. **Actual ownership.** gates.mjs::validateReceipt:13–14,21 и cli.mjs::ready:18 сверяют self-declared changedPaths с реальным git diff inputSha→commitSha. Проверка только заявленных путей больше не скрывает постороннюю правку.
3. **Dependency closure.** gates.mjs::ready:27–33 удаляет receipts без проверенной транзитивной prerequisite цепочки; invalid receipt не делает сам WP executable до исправления.
4. **Negative evidence.** validateReceipt:16,20 требует конкретный assertion, успешный baseline, assertion failure mutant, seed/reproduction и checksum двух logs. Infrastructure failure не считается caught mutation.
5. **ARIA integrity.** validateReceipt:17,20 требует ariaSha256; ARIA proof owner/root/hash проверяются вместе с visual/test/provider evidence.
6. **Lane preflight.** machinePreflight:37–40 проверяет CPU4, RAM8, Linux для linux lanes, Darwin для macos-native; linux-renderer требует минимум16GiB.
7. **No fixture promotion.** provider-live и macos-native требуют live mode, реальные proof bytes; не выполненный внешний read-back оставляет feature gate pending.

## P2 dispatch integrity — RESOLVED

После review lead добавил cli.mjs::verifyArtifactBytes:7–8: validate/ready/render перед любым возвратом результата сверяют полный specInputs и hash каждого packet/prompt. Current validate повторно прошёл: 52 packets, 60 screens, 216 controls. validateReceipt дополнительно запрещает одинаковые inputSha/commitSha — receipt обязан доказывать фактический новый implementation commit.

Независимая hermetic проверка использовала точные копии текущих cli.mjs/gates.mjs в отдельном mkdtemp Git repository с минимальным manifest. Сначала original prompt/packet: render и ready завершились exit0. Затем ровно одна строка «BROKEN private excerpt allowed» добавлена отдельно к prompt и packet. Обе команды render/ready во всех четырёх комбинациях завершились nonzero с «packet/prompt bytes drift»; dispatch результата не произошло. Собственный fixture удалён в finally; repository artifacts не менялись.

Remaining critical findings в проверенной области не обнаружены. Trusted receipt content/reviewer identity и реальный owner lease остаются boundary integration authority; prepared tools не заявляют реализованный scheduler или cloud provisioning.

## Продуктовые contracts, проверенные вместе с packet

- Channels остаются contextual Project→Channels плюс permission-filtered global Search/Favorites; native destination не добавляется. Human DM/thread/discussion не превращается в AgentSession.
- Channel/DM composer: Enter-send, ShiftEnter-newline, configurable modifier mode. CRM/entityDiscussion: Cmd/CtrlEnter-send, Enter-newline; thread наследует parent policy; IME/autocomplete intercept Enter.
- Existing semantic font-sans/font-mono и actual selected preference уважаются; Rox Mono не объявлен глобальной существующей font.
- Message wrappers имеют canonicalOperation=message.create и одну authority/outbox/idempotency namespace.
- Message→Task для wider audience: вручную написанный title/body + neutral backlink; private excerpt запрещён по source.read alone. Explicit export требует source.export/declassify signed decision actor/source revision/audience/content digest/TTL, audit и current permission recheck. Negative assertions исключают private sentinel из Task/search/push/agent context.
- Notes current server optional read-check-write не объявляется CAS. Current renderer omits expectedRevision. Atomic writer или shared CRDT authority — future acceptance gate.

## Граница готовности

PREPARED_NOT_LAUNCHED сохраняется. Для первого рабочего feature acceptance нужны committed exact inputSha/specDigest, actual lane preflight, controlled actor/workspace fixtures, owner lease, meaningful domain/UI tests, seeded assertion mutation, independent reviewer, native/provider read-back где требуется. Отсутствие этих receipts означает pending, а не pass. Существующий generic receipt verifier не исполняет тесты за worker и не удостоверяет reviewer identity; trusted integration authority проверяет содержание и авторство receipts.

## История попыток

Во время одновременного обновления схемы gates initial legacy suite кратковременно показала 3/7: старые test fixtures не содержали новых hashed negative/ARIA/CPU/platform полей. Это historical baseline/schema drift; новые fixtures обновлены lead, final rerun 10/10. Старый pass7/7 и промежуточный failure не применяются к итоговым bytes.

## Hashes проверенных artifacts

| Artifact | SHA-256 |
|---|---|
| scripts/macro-integration/cloud/gates.mjs | bacb23add2f8743a3b732c6780186a804eab2d87228e7ad782140a3dec4d1594 |
| scripts/macro-integration/cloud/cli.mjs | 3e4b3c8018b0ccab1fb0dd6f1fcfdf91a240ab397661d1b0fc44daa73619aa34 |
| scripts/macro-integration/cloud/build.mjs | 308cb4425b10fd0b3440faeb6e11a5b87b5ef87e19cbd76eabab5683e13be3c9 |
| scripts/macro-integration/cloud/gates.test.mjs | 525fdb3a22135649c894ded04022ddbf44bf33949567d40b80fabb5a196758df |
| plans/macro-integration/cloud/manifest.json | f2425087846970c0f16d9d4c13519835cc6d764713f07ea096cb64b01965e4c8 |

## Final root reconciliation

Final catalog61screens219controls,52packets. New allocation guard and actual CLI baseline/mutant test independently reviewed:11/11 gate tests. COL15 canonical sourceTransfer union/full schema independently compiled and tested. Additional actual routed seams are assigned in ui-slices; allocated existingUIseams are added to readFirst, and genuinely proposed newUiFiles are identified separately. Previous hashes/counts above refer to earlier reviewed bytes; current exact hashes/digest/check results are in plans/macro-integration/cloud-validation-report.json. Preparation remains PREPARED_NOT_LAUNCHED.
