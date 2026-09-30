# Контракт следующей волны implementation workers

Владелец producer и интеграции — root. Producer расширяет существующий OMP adapter и использует настоящие `harness.contracts.envelope`, `dispatch_packet` и `verify_inputs`; новый scheduler или отдельный harness не создаётся. Модель — `openai-codex/gpt-6.1-sol`, reasoning — `high`.

## Фазы и запуск

Существующие `--count 70` и `--verify REPORT PACKET` сохраняют поведение source preflight. Default phase — `preflight`. Историческая preflight-волна `rox-compound-20260930T083916Z` имеет native receipts в `/Users/t/.agents/state/rox-compound-70/rox-compound-20260930T083916Z/launch.json` и снимок `external-workers.json`: это исследование, не реализация. Старые source hashes перечитываются при новой dispatch generation.

Implementation запускается только по явным IDs и полной committed input SHA. Первая независимая волна: `WP-01 WP-48 RS-ADM-01 RS-AUT-01 RS-DRV-01 RS-MSG-01 RS-MTG-01`. Все семь имеют пустой explicit dependency array. Это разрешает начало независимой работы после checkpoint commit, без заявления о полном DoD предыдущей волны. Foundation gates из published specification продолжают действовать.

После root checkpoint commit выполнить:

```sh
python3 plans/compound-implementation/launch-worker-pool.py \
  --phase implementation \
  --expected-revision <FULL_CHECKPOINT_COMMIT_SHA> \
  --ids WP-01 WP-48 RS-ADM-01 RS-AUT-01 RS-DRV-01 RS-MSG-01 RS-MTG-01
```

Тот же вызов с `--prepare-only` проверяет allocation и сохраняет packet/prompt/binding вне checkout, запускает **0** процессов. Для реального запуска нужен новый вызов без этого флага; подготовка не получает session ID и не считается продолжением исполнения. `--help` не запускает jobs. Не подменять SHA строкой `HEAD`: значение должно явно связывать пакет с checkpoint revision.

## Ownership и реальные результаты

1. Новые файлы берутся из нормативного `newFiles`/`proposed_new_files` либо explicit NEW paths опубликованной Suite specification. Compact notation DRV/MSG разворачивается в exact paths. Preflight report не выдаёт права записи.
2. Worker пишет только перечисленные отсутствующие repository files. Existing normative proposed files переходят к root. Пересечение владения отвергается до подготовки файлов. Если новых owned outputs больше нет, producer требует новой allocation root.
3. Любая правка существующего shared файла возвращается как полный single-file unified diff в external task directory `patches/`, с `baseSha256`. Worker не применяет его. Недостающий root-owned prerequisite возвращается creation diff `--- /dev/null`, `+++ b/path`, `baseSha256=null`; отсутствие файла проверяется вновь при handoff. Root решает allocation и интегрирует его.
4. Worker создаёт реальные механизмы и содержательные behavioral tests. Отчёт сопровождает исходники, тесты и патчи. Placeholder, disconnected mock screen и план сами по себе не принимаются за implementation.
5. Existing imports/seams должны существовать в bound generation. Если shared authority ещё отсутствует, нужны точные implementation patches root и явные blocked gates. Не создавать parallel stores, выдуманный gateway или success fallback.
6. Worker не делает Git writes/commit/push, install/update, builds, broad typecheck, UI/native/browser, внешние effects, глобальные изменения и дополнительную delegation. Разрешены чтение, owned files, external artifacts и scoped tests существующим Bun. Для WP-01 root разрешил provisioned loopback PostgreSQL test DB; secret environment загружается в тесте из `/Users/t/.agents/state/rox-compound-workspace/postgres-environment.json` и не печатается. Worker использует только собственные test tables/transactions.

Это policy boundary, не OS filesystem sandbox. Producer не обещает техническую изоляцию нарушившего инструкции процесса. Root сохраняет одного writer для shared paths и проверяет реальный diff перед интеграцией.

## Generation и dependencies

Dispatch packet имеет native harness schema/hash, input revision и hashes нормативных specs, AGENTS, producer, этого контракта, preflight report и текущих inspected sources. External `implementation-binding.json` содержит exact progress entry, его hash, hash нормативной записи, ownership и source generation. Future owned outputs исключены из immutable `input_manifest`: запись своего файла не инвалидирует собственный packet. Смена input HEAD или bound existing source требует нового dispatch; verification не переименовывает stale evidence в успешное.

Изменение operational status/readiness/runtimeEvidence в `progress.json` не меняет source generation. Проверяются текущие `program`, `spec`, `dependencies` и точная нормативная запись. Дополнительные existing imports/patch targets, найденные после dispatch, допустимы только если их current bytes совпадают с bytes этого пути в bound commit. Они не добавляются в packet с новым hash задним числом.

Для непустых dependencies передать отдельный `--dependency-receipt ID=REPOSITORY_RELATIVE_RECEIPT.json` для каждого предшественника. Root receipt содержит `packageId`, `inputRevision` текущего dispatch commit, `state=ROOT_VERIFIED_INTEGRATED`, непустые `artifacts` и `evidence`, каждый элемент `{path,sha256}`. Producer сверяет наличие и exact hashes. Root создаёт такую receipt только после собственной behavioral проверки; state string или рабочий отчёт сами по себе не доказывают поведение. Historical preflight, launch receipt и boolean worker pass не являются dependency receipt.

## Handoff и пределы verification

External task directory содержит `contract.json`, `packet.json`, `implementation-binding.json`, `prompt.txt`, native `sessions/`, `events.jsonl`, patches/test logs и `implementation-report.json`. Launch receipt различает prepared, process started/session pending, running, process exited и finished pending root verification. Настоящий native session ID берётся из OMP session event.

Report возвращает packet lineage, `featureComplete=false`, exact dependencies, actual artifact hashes, patches, test argv/exit/log hashes, acceptance matrix, source references, remaining gates и next executable action. Допустимы только `IMPLEMENTED_PENDING_ROOT_INTEGRATION` или `BLOCKED_ON_FOUNDATION`. Для первого состояния нужны все normative outputs; для второго пропуски остаются явными gates. `NOT_RUN` test требует точного prerequisite.

```sh
python3 plans/compound-implementation/launch-worker-pool.py \
  --verify-implementation /ABSOLUTE/EXTERNAL_RUN_DIRECTORY/PACKAGE_ID
```

Этот verifier проверяет lineage, revision, sources, allocation, paths, artifact/test-log hashes и форму exact patches. Он **не** исполняет functional tests и не доказывает полноту механизма или UI/provider/native lanes. Receipt прямо содержит `behaviorVerified=false`, `featureComplete=false`. Producer не меняет `progress.json`, `external-workers.json` или Git state. Worker finish/exit 0 не закрывает пакет, issue или full DoD.

Root читает все исходники/патчи, применяет допустимые shared changes, запускает реальные package scenarios с failure paths и persistence/recovery, проверяет интегрированную revision и нужные native/provider lanes, затем отдельно отмечает implemented, verified и delivered. Требуемые pending lanes сохраняют feature incomplete.
