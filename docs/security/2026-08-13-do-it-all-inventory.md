# DO IT ALL — реестр дефектов / пробелов

- **Дата:** 2026-08-13
- **Инструкции владельца:** `DO IT ALL`; точная строка `АПPLY HMA-20260809-A1` получена 2026-08-19; устав брендинга подписан отдельно.
- **Worktree:** `/Users/marklindgreen/Projects/_craft_worktrees/do-it-all-security-slices` (`do-it-all/security-slices` @ `99cd5ea9e`), незакоммичено
- **Восстановление:** `/tmp/craft-agents-do-it-all` был удалён; источники B без гейтов реконструированы на этот долговременный worktree и повторно верифицированы
- **Основной checkout:** `/Users/marklindgreen/Projects/craft-agents` на `fix/sessions-fr38-fr47` (dirty, ahead 2 / behind 6) — **не использовался для реализации**
- **Живой снимок A0:** `2026-08-19T09:48:50Z` (только режимы/счётчики; без секретов)

Навыки (slash-алиасы недоступны):

1. `~/.agents/skills.shared-archive/spec-driven-workflow/SKILL.md`
2. `~/.agents/skills/planning-and-task-breakdown/SKILL.md`
3. `~/.agents/vendor/mattpocock-skills/skills/engineering/improve-codebase-architecture/SKILL.md`

---

## Как структурировать оставшуюся работу

Один автор на сессию. Спецификация до кода. Изолированный worktree. Узкий вертикальный срез. Никогда не смешивать мутации Hermes с кодом продукта.

**Не** выполнять A+B+C одной волной мутаций. Эта волна реализовала B (+ локальный каталог session-intelligence) и зафиксировала A/C как fail-closed.

Верификация: сфокусированный `bun test` по затронутым файлам. Без общепроектного набора тестов, без коммитов, если не запрошено.

---

## A — операции Hermes / OMP / Tailscale

| ID | Находка | Крит. | Доказательство | Владелец | Гейт |
|---|---|---|---|---|---|
| A-P0 | `approvals.mode=off` | P0 | `hermes config get approvals.mode` @ 12:32:55Z | infra | APPLY, затем A2 |
| A-TIR | Tirith включён, **fail-open** | P0 | `security.tirith_fail_open=true` | infra | APPLY, затем A2 |
| A-URL | `allow_private_urls=true` | P1 | конфиг hermes | infra | A2 |
| A-SKL | `skills.write_approval=false`, `memory.write_approval=false` | P1 | конфиг hermes | infra | A2 |
| A-644 | `~/.hermes/.env.backup*` права **644** | P1 | `stat -f '%Lp'` (только режимы) | infra | A3 |
| A-TSK | `tskey-api.secret` **ОТСУТСТВУЕТ** (был 600 в 13:33Z) | info | `stat` / exists | infra | содержимое не искать; ротировать, если ключ был живым |
| A-GW | launchd-служба Gateway устарела | P2 | `hermes gateway status` | infra | после A2 |
| A-CRON | JSON списка cron невалиден в этой пробе (exit 2 usage); ранее наблюдался класс ошибок 3/18 | P2 | `hermes cron list --json` | infra | не Stage C |
| A-ST | CLI Syncthing отсутствует | P2 | `command -v syncthing` | infra | не запускать на всякий случай |
| A-TS | Tailscale Running, 600 пиров, **target не определён** | P0 для migrate | `tailscale status --json` только счётчики | infra | именованные source/target |
| A-GIT | Hermes v0.20.0 синхронизирован с origin/main (`c0106e50`) | P3 | `hermes version`; origin/main `c0106e50` | infra | после A3 |
| A-OMP | По умолчанию уже `cursor/cursor-grok-4.6-xhigh` | done | `~/.omp/agent/config.yml` | pzd | только новые сессии |
| A-LOG | Инициализация Apply завершилась fail-closed | P0 | корень apply доступен только владельцу; `INIT audit-checksums FAIL`; расхождение 15/22; инструменты не скопированы / команды A0 не выполнены | infra | одобрение исправления revision-3 |

### Следующие шаги (A)

1. Не повторять Stage C и не пересчитывать контрольные суммы текущих байтов. Проверить/исправить документы/инструменты аудита revision-3, затем получить точное новое одобрение владельца revision-3.
2. После прохождения контрольных сумм/A0 revision-3: `APPROVE A1 BACKUP` — шифровать бэкапы age; **никогда** не восстанавливать `approvals.mode=off`.
3. `APPROVE A2 HERMES SMART` — `approvals.mode=smart`; Tirith fail-closed; политика приватных URL.
4. `APPROVE A3 PERMISSIONS` — chmod для env-бэкапов; не объединять с ротацией ключей Tailscale.
5. Назвать узлы source и target Tailscale до любого применения ACL/Syncthing.
6. Исправить cron billing/GCS отдельным классом (не Stage C).
7. Запускать новые OMP-сессии, чтобы подхватить Grok xhigh (существующие сессии сохраняют стартовую модель).

**Стоп:** доказательства apply существуют, но A0 не стартовал. Никаких повторов, `hermes config set`, бэкапов, chmod, Funnel, yolo, ACL, messaging или Syncthing до revision-3 и последующих точных гейтов.

---

## B — безопасность продукта craft-agents

| ID | Находка | Крит. | Доказательство | Статус в этой волне |
|---|---|---|---|---|
| B-MIG | `knowledge:migrateNotes` был `REMOTE_ELIGIBLE`, хотя обработчик работает с локальным vault/kernel | P0 | `packages/shared/src/protocol/routing.ts` | **LOCAL_ONLY** + тест |
| B-ROOT | `CONFIG_DIR` — жадный снимок на момент импорта; корни notes не проверялись на пересечение с секретами | P0 | `packages/shared/src/config/paths.ts` | ленивый `getConfigDir()` + `OwnedRootPolicy`; eager-экспорт сохранён |
| B-ABS | Пути импорта должны быть абсолютными | P1 | спецификация FR-7 | `assertNotesImportPaths` встроен в `resolveWorkspaceNotesRoot` (FR-5) и `migrateCraftNotesToSiyuan`; `listNotesForMigration`/`migrateCraftNotesToSiyuan` отклоняют относительные пути + credentials.enc (AC-4) + identity.json (EC-3) |
| B-CF2 | Повреждённый `credentials.enc` удалялся через `unlinkSync` | P0 | `secure-storage.ts` `handleCorruptedFile` | карантин: каталог `0700`, файл `0600`; инъекция `filePath` |
| B-ID | Сырой секрет проходил через `identity.connect` | P1 | одобренная спецификация CF-4; `identity.ts`; маршрутизация local-only; привязка доверенного renderer | **закрыто** — выделенный `identity:storeCredential`; connect/core store передают только `credentialRef` |
| B-VAL | `StoredCredential.value` остаётся живым полем секрета | P1 | `credentials/types.ts` | ожидаемо до брокера CF-4 |
| B-CF1 | Envelope/реестр всё ещё **отсутствуют** на HEAD `99cd5ea9e`; несанкционированный неотслеживаемый `envelope.ts` удалён в этой волне | P2 | нет `envelope.ts` / `envelope.test.ts` в worktree | не пере-реализовывать |
| B-G0 | Лист Gate 0 присутствует; факты всё ещё отсутствуют (DeviceRecord, WebAuthn, origins, дайджест microVM, issuer) | P0 | `docs/security/external-access-deployment-contract.md` | лист присутствует; факты всё ещё **BLOCKED**/MISSING (не заполнены) |
| B-ALL | Дефолт сессий `permissionMode=allow-all` | P1 | `apps/electron/resources/config-defaults.json:19` | решение владельца; не переключено |
| B-SRC | Generic Sources FTS / ingress промптов (архитектурный кандидат 3) | P1 | меморандум с доказательствами; не полностью на этом коммите | отложено |
| B-SI | Personal Session Intelligence не имела локального каталога по принципу consent-first | P1 | дизайн `2026-08-13-personal-session-intelligence-*.md` | W1–W5.2 локально: registry, адаптеры, RPC, панель Memory монтирует `SessionIntelligencePanel` в `MemoryListPanel.tsx:670` с inbox кандидатов. Извлечение детерминировано/ограничено; rank/confirm/correct/hide/delete; **нет** prompt injection (W6), **нет** сетевой синхронизации |

### Следующие шаги (B)

1. Сохранить `MIGRATE_NOTES` как канал; не удалять RPC; не поставлять UI Notes Imports.
2. Не переписывать каждый импортёр `CONFIG_DIR`; новый код использует `getConfigDir()`.
3. CF-4 плюс одобренная поправка A1 завершены; брокер/lease CF-3 остаётся отдельным решением на будущее.
4. Владелец заполняет лист Gate 0 (datastore, дайджест microVM, `APP_ORIGIN`/`SHARE_ORIGIN`) до инкрементов внешнего доступа C–F.
5. Рассмотреть `permissionMode=allow-all` как продуктовое решение; не менять дефолт молча.
6. Session intelligence W6 promotion / prompt injection — **заблокировано** до появления retention policy.
7. W7 удалённый анализ / W8 синхронизация Iroh — **заблокировано** до ревью pairing + redaction.
8. Перебазировать этот worktree на чистую линию перед слиянием; не коммитить в грязное дерево `fix/sessions-fr38-fr47`.
9. Ревью кандидатов W5.2 вошло в эту волну; W6 promotion всё ещё заблокирован из-за отсутствия retention policy.

### Доказательства CF-4 (2026-08-19)

- Гейты владельца: точные `APPROVE CF-4 IDENTITY CREDENTIAL INTAKE` и `APPROVE CF-4 AMENDMENT A1`; реализация оставалась в пределах проверенных allowlists и остаётся незакоммиченной.
- Контракт: `STORE_CREDENTIAL` — `LOCAL_ONLY` и отсутствует в `REMOTE_ELIGIBLE_CHANNELS`; явный IPC-инвентарь из 568 каналов включает `identity:storeCredential`; handshake renderer и каноническое обновление `SWITCH_WORKSPACE` обновляют/верифицируют `WindowManager` до создания контекста RPC-клиента; повторно воспроизведённый `identity.connect.credentialValue` завершается fail-closed.
- Поток данных: intake сохраняет обрезанный fake/real токен только через `CredentialManager`; `IdentityStore` принимает только несекретный `credentialRef`; CF-1 `envelope.ts` по-прежнему отсутствует.
- Верификация: сфокусированный CF-4 **70 pass / 0 fail**; сфокусированный A1 **16 pass / 0 fail**; объединение B-security + CF-4 + A1 **225 pass / 0 fail**, **5655 expectations**, по 21 файлу; typechecks shared/core/server-core/Electron — все проходят; неизменяемый pre/post-манифест `7fa88067031e729e6f94586d7abd5957859d5598afd7a902dd53b74573421e3e`.
- Нативный smoke: текущие артефакты Electron запущены с изолированной временной конфигурацией; fake-токен `cf4-not-a-real-secret` выдал `CF4 smoke · connected`, затем поле/форма секрета исчезли из accessibility-поверхности. Процесс и временная конфигурация были удалены; процесса ядра SiYuan не осталось.
- Оговорка сборки вне CF-4: `bun run start` блокируется до запуска предсуществующими несвязанными lint-ошибками; ручная сборка текущих артефактов успешно прошла этапы renderer/copy, тогда как скрипт репозитория `build:validate` ссылается на отсутствующий `scripts/validate-assets.ts`.

**Стоп:** никакого SiYuan `mode: managed`; никакого SQLite-over-network; никакого Funnel. Не пере-реализовывать CF-1 `envelope.ts`. Не внедрять кандидатов в промпты.

---

## C — продуктовая идентичность, Git, зрелость

| ID | Находка | Крит. | Доказательство | Далее |
|---|---|---|---|---|
| A-OPS-DOC | Написан staged runbook A-ops; мутаций Hermes нет | P0 | `docs/security/2026-08-19-a-ops-runbook.md` | только документ; APPLY всё ещё требуется |
| B-CF4 | Выделенный local-only приём credential + доверие workspace A1 | P1 | одобренные спецификации + план + объединённый гейт из 225 тестов | реализовано, независимо проверено, нативно smoke-протестировано; незакоммичено |
| C-BRAND-PLAN | Написан план README/clone; README не тронуто | P2 | `docs/product/2026-08-19-branding-readme-plan.md` | не подписано |
| C-NAME | Названия расходятся: Craft Agents, `craft-agent` 0.11.4, `agents.craft.do`, клон lukilabs, origin agisota, `rox.one` | P2 | черновик устава | подпись владельца |
| C-VER | Часть документов указывает 0.11.5; в пакете 0.11.4 | P3 | `package.json` | здесь версию не поднимать |
| C-GIT1 | Остаточная ветка `feat/shell-ext-activate2` 1/44 | P2 | меморандум triage удалённых веток | rebase или abandon; **не сливать** |
| C-GIT2 | Остаточная ветка `fix/sandbox-env-strip` 2/535 | P1 | triage удалённых веток | **не сливать** |
| C-APP | Electron — production; CLI/viewer — около-production; iOS/cloud/modal — экспериментальные | info | `docs/product/2026-08-13-app-maturity.md` | не выпускать экспериментальное как prod |
| C-OMP | `docs/omp-integration-gap.md` внутренне противоречив; AGENTS.md по-прежнему утверждает, что MCP source proxies не передаются в v1 | P3 | документация | позже, только docs |

### Следующие шаги (C)

1. Подписать `docs/product/2026-08-13-branding-charter.md`.
2. Только затем править README / clone URL.
3. Для остаточных remote-веток — rebase или abandon; никогда не сливать `fix/sandbox-env-strip`.

**Стоп:** `DO IT ALL` — это не подпись устава. README не тронуто в этой волне.

---

## D — заблокированные продуктовые инициативы (не дефекты реализации)

| Инициатива | Причина блокировки | Не делать |
|---|---|---|
| SiYuan `mode: managed` | G2 OPEN; G1 TBD | выдумывать пороги G1; запускать managed kernel |
| ROX Notes Imports UI | безопасность + G1/G2 | реализовывать Imports |
| Нативный движок mind-map | дизайн ≠ спецификация; в грязном дереве уже есть файлы | смешивать с этим worktree |
| Voice | отдельный worktree | смешивать |
| iOS / cloud-gateway / modal-gateway | экспериментальные | считать production |
| OpenClaw dashboard | fail-closed | смешивать с Hermes Stage C |

---

## Эта волна (проверено в worktree, незакоммичено)

| Срез | Результат |
|---|---|
| B-migrateNotes | `LOCAL_ONLY`; онбординговые каналы ROX классифицированы для полноты покрытия |
| B-owned-root-policy | модуль + проверки notes-root + абсолютные пути импорта |
| B-notes-migration assertNotesImportPaths | notes-migration теперь вызывает `assertNotesImportPaths` (`resolveWorkspaceNotesRoot` FR-5, `migrateCraftNotesToSiyuan`; `listNotesForMigration` отклоняет относительные пути + credentials.enc AC-4 + identity.json EC-3) |
| B-owned-root FR-3/EC-1 tests | `.env`, `credentials.enc.quarantine`, пустой путь |
| B-owned-root EC-3 | `listNotesForMigration` и `migrateCraftNotesToSiyuan` отклоняют `identity.json`; `assertNotConfigSecretPath` бросает исключение для него |
| B-owned-root FR-3 destination | `assertNotesImportPaths` отклоняет `destinationRoot` со значениями `credentials.enc` и `identity.json` |
| B-owned-root FR-7 dest relative + empty | относительный `destinationRoot` и пустые source/destination отклоняются; `migrateCraftNotesToSiyuan` отклоняет секретный `workspaceRoot` |
| B-owned-root FR-5/EC-3 notesPath | `resolveWorkspaceNotesRoot` бросает исключение для `notesPath` со значениями `identity.json` / `credentials.enc`; разрешает `/tmp/selected-craft-vault` |
| B-owned-root FR-7 notesPath relative | `resolveWorkspaceNotesRoot` бросает исключение для относительного `notesPath`; имя карантина CF-2 EC-2 не содержит полезную нагрузку `CRAFT01` |
| B-owned-root FR-4 default notes | `resolveWorkspaceNotesRoot` разрешает дефолтный `workspaces/{id}/notes`, когда `notesPath` не задан |
| B-owned-root EC-2 missing dir | `listNotesForMigration` возвращает `[]` для отсутствующего несекретного каталога notes |
| B-owned-root FR-4 empty notesPath | `resolveWorkspaceNotesRoot` разрешает дефолтный `workspaces/{id}/notes`, когда `notesPath` пуст |
| B-owned-root EC-2 regular file | `listNotesForMigration` возвращает `[]`, когда `notesRoot` является обычным файлом |
| B-CF2 FR-5 v1 dual-read | v1-хранилище hostname на инъецированном пути расшифровывается и не отправляется в карантин |
| B-PSI FR-09 digest hints | сохранённые дайджесты сессий сохраняют массивы `projectHints` и `entityHints` |
| B-PSI FR-09 digest fields | сохранённые дайджесты Craft/OMP/HTML сохраняют title, timestamps, entryCount, roles и toolCalls |
| B-PSI FR-06 catalog identity | индексированные элементы каталога сохраняют id, sourceId, relativePath, adapter, дайджесты content/metadata, byteSize, timestamps |
| B-owned-root FR-2 CONFIG_DIR | `CONFIG_DIR` остаётся жадным снимком, тогда как `getConfigDir()` следует env на момент вызова |
| B-PSI NFR-04a workspace stores | sources/catalog/audit ключуются по ID workspace в `.craft/session-intelligence/{id}`; один и тот же root не разделяется и не перезаписывается |
| B-PSI FR-09 projectHints | сохранённые дайджесты Craft/OMP/HTML сохраняют ограниченные по длине title `projectHints` и пустые `entityHints` |
| B-PSI NFR-01 payload skip | неизменённые индексированные сессии не переснимаются/переизвлекаются при rescan |
| B-PSI FR-09 workingDirectory | сохранённые дайджесты Craft/OMP/HTML сохраняют fixture-значения `workingDirectory` |
| B-CF2 FR-5 v1 reopen | v1-хранилище hostname остаётся читаемым на свежем экземпляре backend и не отправляется в карантин |
| B-cf2 FR-7/EC-3 + EC-1 tests | при сбое mkdir карантина оригинал сохраняется; отсутствующий файл возвращает null без каталога карантина |
| B-cf2 EC-2 | корректный по формату файл CRAFT01, не расшифровываемый ни одним из двух ключей, отправляется в карантин (dir 0700, file 0600), а не удаляется |
| B-cf2 FR-3 AC-2 modes | карантин short-garbage проверяет dir 0700 и file 0600 |
| B-cf2 FR-3 AC-3 modes | карантин wrong-magic проверяет: оригинал исчез, dir 0700, file 0600, в имени нет полезной нагрузки |
| B-G0 worksheet | создан лист Gate 0 (факты MISSING) |
| B-cf2 | карантин вместо unlink; тесты с временным `filePath` |
| B-SI W1–W5.2 | локальный каталог + извлечение кандидатов/inbox; rank/confirm/correct/hide/delete; монтирование панели Memory в `MemoryListPanel.tsx:670`; без prompt inject; без синхронизации |
| B-CF1 | всё ещё отсутствует на HEAD; несанкционированная неотслеживаемая копия envelope удалена в этой волне; не пере-реализовано |
| A0 reprobe | FAIL CLOSED @ `2026-08-19T09:48:50Z`; apply.log не создан |
| OMP default | уже Grok xhigh |
| package.json | восстановлен валидный JSON; добавлены экспорты `./session-intelligence` и `./config/paths` |

---

## Определение готовности (программа)

```
BLUF: partial
A-ops: R3 offline recovery/security repairs committed; verification artifact remains stale and A0 is blocked on clean verification plus the exact R3 start token
B-security: implemented in worktree; not merged
C-branding: unsigned
Verified: focused bun test 167 pass / 0 fail 3459 expect() calls across 15 files @ 2026-08-19T09:48:50Z (routing, owned-root, CF-2, notes-migration, PSI W1–W5.2 including lastScanCounts persist, FR-03 skip .git/node_modules, FR-03 extractSessionDigestFromFile final-symlink skip, FR-04 file-size-limit partial+audit, FR-04 total-byte maxCandidateBytes scan-limit+audit, AC-05 malformed-beside-valid partial, UI 3 skipped/error toast, W5.1 locale keys in all 10 files, FR-W52-3 280-char bound, W5.2 cap/inbox/untitled/rank-fail/non-authoritative tests, candidate audit sourceId; renderer-capability mint/compare; WS handshake binds WebContents only via validated capability; SI + MIGRATE_NOTES LOCAL_ONLY)
Next owner strings:
  1. АПPLY HMA-20260809-A1-R3
  2. branding charter signature
```

### Доказательства HMA R3 после исправлений — 2026-08-20

- Исторический bundle-коммит: `78df77a`; push не выполнялся.
- Коммиты офлайн-исправления контракта: `feaced2`, `4dc9b1dc`, `e505d80f`, `cb36c864`, `b16cc69f`, `98f2f2c2`, `a840f27b`; push не выполнялся.
- Исторические доказательства манифеста (173 теста / 35 путей) относятся только к `78df77a`; они устарели после всех текущих исходных коммитов.
- Текущая верификация исправления ограничена статическим разбором исходников, так как владелец запретил повтор заблокированных тестов/checksum/verifier в этом ходе.
- Не произошло никаких мутаций A0/живых Hermes, OMP, Tailscale, Syncthing, credential, процессов, прав, messaging или target.
