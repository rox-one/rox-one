# Pocket SSO — desktop implementation receipt

Дата: 2026-10-03. Исполнитель: desktop worker; интеграция, независимое ревью и deployment — integration lead.

**Статус: desktop-код реализован и проверен локально; полный Task 7 / клиентский Task 6 ещё не принят.** Нативные macOS/Windows сценарии, опубликованные сборки и сквозной live charged inference остаются отдельными приёмочными воротами.

## Ревизии и сохранение исходного проекта

- Рабочее дерево: `/Users/t/.codex/worktrees/pocket-id-sso/rox-release-20261003`, branch `codex/pocket-id-sso`.
- Замороженный desktop source: `c9b7330357fb55a5e88a223783029d2768849828`.
- Root commits до desktop-работы: `430cd9382`, `205f0f86b`, `6942a56aa`.
- `8c193f21d` — Pocket device v2, main-owned account authority, OS-backed vault, активные core Connect/bootstrap/logout handlers.
- `b35f276c7` — доверенный execution context, session/helper/automation propagation, публичный OMP credential dispatch, owner-scoped cloud consumers.
- `ede814397` — mandatory startup gate, account cabinet/footer, все фактические локали.
- `2fe238b7b464babffead795f7ad6416d38dfaf40` — восстановление logout после outage, redaction diagnostics, финальный generation fence/cleanup и регрессии.
- `2a2ebec6d75fe20d8575bc9c69a129cde216239d` — durable prior-token logout ancestry без зависимости от refresh replay, strict v=2 broker URL и регрессии.

Сохранены существующие документы программы, локальные чаты/конфигурация/workspaces, native grants и отдельная workspace authority. Destructive `auth.LOGOUT` не используется. Root-owned dirty `docs/pocket-sso/rollout.md` и `deploy/` не включены в desktop-коммиты. Последующий drift remote main интегрирует lead; эта квитанция относится к указанному frozen base.

## Фактический Connect / bootstrap / refresh / logout

Активный путь: `registerCoreRpcHandlers` → `packages/server-core/src/handlers/rpc/onboarding.ts` → main-owned `RoxAccountAuthority` → `rox-pocket-client.ts`. Legacy Electron onboarding module не дублировался; `ENSURE_FIRST_SESSION` сохранён.

1. Новый или upgraded local Electron клиент обязан пройти central Pocket gate. Local displayName и provider deferral больше не доказывают облачную авторизацию. Готовый central inference account считается настроенным даже без старого global OMP key.
2. Первый Connect открывает внешний браузер один раз. Main создаёт S256 proof и redemption ID; UI получает только user code, разрешённые broker verification URLs и срок. Поллинг обрабатывает pending/slow_down/denied/expiry, cancel, retry и ограниченный outage retry с тем же proof/operation ID.
3. Approved access/refresh сначала атомарно сохраняются; затем вызываются идемпотентный bootstrap/account и inference-credential. Provisioning failure не теряет уже redeemed session. Snapshot строго проецируется: дополнительные server fields, включая случайно возвращённые secrets, не проходят в renderer.
4. `ready` допускает 0 ROX и pending email grant. Paid execution при available=0 отклоняется до создания публичного OMP процесса. Баланс не берётся из XP/gamification.
5. Expired/скоро истекающий access обновляется и при UI-read, и непосредственно перед inference. Refresh ID запечатывается **до** HTTP; rotated access+refresh+expiry и удаление pending ID записываются одним sealed record. Lost response + relaunch использует прежний persisted ID в server replay window.
6. Logout немедленно инвалидирует поколение и останавливает старые OMP процессы. Минимальная sealed revocation receipt сохраняется до broker ACK; outage оставляет её для retry после relaunch. Sealed prior access proof напрямую отзывает device lineage через broker logout-only ancestry, в том числе после незавершённого refresh. Следующий Connect не начинает новый flow, пока прежняя revocation не подтверждена. Account-wide personal key не отзывается обычным device logout.

Refresh/redeem replay действует только в согласованном server window60s. После утраты rotated response за пределами этого окна inference refresh может потребовать новый Connect. Logout больше не зависит от replay: broker хранит durable prior-token hash ancestry исключительно для revocation этой же device lineage. Старый proof не даёт account/read/inference/refresh access. Desktop отправляет sealed prior access напрямую; порядок deployment требует broker ancestry implementation **до** desktop release. Его PostgreSQL/integration proof и live release проверяет lead.


## Secret storage и trusted execution

`apps/electron/src/main/index.ts` создаёт authority с новым `pocket-account-store.ts` в Electron userData. Реальный production storage требует Electron safeStorage на macOS/Windows и доступный OS encryption backend; Linux/недоступный backend fail closed. Файлы и указатели шифруются safeStorage, имеют caller/account namespace, atomic rename, sealed-file fsync и directory fsync на Mac. Symlink directory/read substitution отвергаются. Resource bindings и pending revocation envelopes также sealed. Файлы не содержат plaintext tokens/keys; отдельный machine-readable hash-name не является ключом шифрования.

RPC принимает host-owned caller из server context/local Electron binding. Renderer accountId/authGeneration не являются trusted inputs. `RoxExecutionContext` содержит caller, cloudAccountId и authGeneration; generation recheck остаётся непосредственно перед spawn/dispatch и перед принятием поздних результатов. Key generation/status change также инвалидирует старое исполнение. Подготовленные runtime artifacts удаляются, если account fence срабатывает после async native preparation, но до spawn.

Для публичных шести ROX aliases account key/base URL переопределяют ambient, connection, runtime и session env **после** окончательной сборки environment. Managed profile содержит ссылку на env variable, а не raw key. RPC и mini/title/call_llm процессы получают одинаковую authority. Logout/switch убивает и persistent RPC child, и tracked one-shot children; old outputs не принимаются. Публичный parent не может превратить call_llm в private-model bypass. Явные private/BYOK модели сохраняют свой прежний credential path.

Execution context проходит через actual SEND_MESSAGE handler, managed session backend, spawn_session, querySessionLlm, titles/drafts, project AI, memory distill и prompt automations. Sessions/automations сохраняют sealed owner binding для восстановления после restart. CREATE/UPDATE/DUPLICATE/enable/SAVE_GRAPH/TEST automation связывают server-owned owner перед config publication; graph binds только изменяемые matcher IDs. Scheduled matcher и memory job получают owner из конкретного ресурса/trigger session, без ambient cloud fallback. Непривязанные legacy публичные automations/helpers fail closed до явной привязки; это сознательная граница, а не доказательство работы всех старых automations.

Mail/local IPC и BroInvite account resolver больше не берут чужой global cloud session. Remote/native workspace authority и её service bearer остаются отдельными. Resolved Pocket credentials регистрируются в canonical diagnostic redactor; child stderr/debug и one-shot errors маскируются. Actual process canary покрывает echoed personal key.

## UI и локализация

AccountSettings показывает central account name/email, organization, handle, account state, masked key prefix, available/held ROX и device logout. Cloud polling не перезаписывает редактируемый local device profile. Cabinet/footer money и footer identity берутся из central snapshot; при outage/logout — unknown, включая случай сохранённого ненулевого gamification balance. XP сохраняет свой отдельный источник. Snapshot также содержит email verification, bonus/key generation metadata по shared contract.

Все новые строки используют `t()`. Репозиторий фактически содержит **12** локалей (10 из AGENTS плюс ar/ko); добавленные ключи внесены во все 12 JSON и ASCII-сортированы. Locale parity suite проходит полностью.

## Проверки и пределы доказательств

Полные команды, runtime version, exit codes, SHA-256 логов и source revision находятся в `reports/pocket-sso-desktop-evidence/checks.json`; логи рядом. Финальный manifest записан; source revision 2a2ebec6d75fe20d8575bc9c69a129cde216239d. Все worker-owned check/build processes завершились до передачи.

| Проверка | Локальное доказательство |
|---|---|
| Pinned Bun1.3.14 authority + OS store | 16 pass: caller isolation, no renderer secrets, zero paid gate, restart bindings, persisted refresh proof, pre-dispatch refresh, late bootstrap/logout, in-flight refresh/revoke, key rotation/revoke, outage logout relaunch и expired-refresh/logout ancestry; vault injected Mac/Win encryption/recovery/no plaintext |
| Pinned broker client | 6 pass: exact PKCE wire, URL/malformed response denial, abort race, foreign credential/money rejection, strict projection, lost approval response replay |
| Actual core registry over authenticated WS RPC | 1 pass / 12 actual checks: live registry registration, Connect/bootstrap/balance, canary serialization, welcome, forged renderer owner rejection, durable owned automation, TEST owner, unbound caller denial, device logout |
| Actual OmpAgent child processes | 9 pass: real fake-CLI process catalog/model readback, wrong ambient/session/connection keys, lifecycle cleanup, mini/title/call_llm, zero/ownerless no-spawn, account switch, stderr secret canary, final pre-dispatch logout cleanup |
| Pinned startup + onboarding hook harness | 56 pass: actual App initializer extracted harness, fresh/upgraded/no local-name cloud gate, unavailable/switch cases, hook flow |
| Pinned flow + active onboarding handlers | 12 pass, including missing legacy OMP credentials with ready central account |
| Pinned footer | 3 pass, including functional no-local-money/identity fallback and XP separation |
| Pinned related Bro/automation/durability | 20 pass |
| Pinned i18n | 278 pass / 6439 assertions |
| Electron and server-core typecheck | Final pinned Electron/server-core checks на 2a2ebec6d оба exit0 |
| Main bundle / renderer bundle | Local esbuild and Vite succeed; full minified renderer14m13s, frozen renderer with minification disabled1m39s; точные build revisions/options находятся в manifest. These are source bundle checks, not platform installer publication |

RPC test использует настоящий registerCoreRpcHandlers/WsRpcServer/WsRpcClient и actual local binding registry, но SessionManager execution seam в fixture заменён stub для проверки доставленного context. OMP tests создают настоящие subprocesses с protocol fake CLI; это не actual installed OMP provider request. OS vault tests используют injected synthetic encryption backend, а не живой Keychain/DPAPI. Нативный UI здесь не открывался; live signup не выполнялся.

### Сохранённая история failures/recovery

- System Bun1.4.2 — focused gates проходили; затем lead указал pinned1.3.14, и required suites повторены на целевом binary.
- Initial pinned parallel OMP/core runs во время Vite minification и высокой host load вышли за прежние5s/20s тестовые окна. Повтор с прежним8s drain также дал timing failures. Final process fixture timeout ограничен30s, individual test60s; assertions/negative controls сохранены. Bounded final runs проходят. Timeout failures сохранены рядом с final logs.
- Broad settings sweep:190 pass /14 skip /5 fail. Exact archived source HEAD6942a56aa воспроизводит те же5 failures (Security source contracts3, Extension provider label1, existing AppSettings manual-update defaultValue1); desktop SSO не меняет эти чужие поверхности. Baseline receipt и diagnostic summary сохранены.
- Первоначальный locale pass выявил ar/ko, отсутствовавшие в перечислении AGENTS; оба файла дополнены, final full parity278/0.

## Что остаётся для lead / независимой приёмки

1. Независимое source review, интеграция remote-main drift и повтор затронутых boundaries на интегрированном SHA.
2. Реальные Keychain/DPAPI доступность, отсутствие plaintext при restart, fresh/upgraded macOS и Windows external-browser Pocket flow, denied/expired/cancel/offline/retry, relaunch и two-device logout/switch на actual routes.
3. Actual SessionManager → parent/child/helper/title/owned scheduler end-to-end с интегрированными broker/Swiss services; source propagation + mocked execution seam не объявляются полным runtime proof.
4. Live key bootstrap/reconciliation/rotation/revoke, verified-email grant/zero balance, full staging charged inference и settlement receipts с website/Swiss revisions.
5. Platform build/package/sign/publish и exact installer artifact hashes; local bundle build не является published build.
6. Complete relevant release/full-suite gates. Наличие пяти baseline settings failures не превращается в зелёный полный suite.

Финальные targeted suites: **401 pass /0 fail**. Frozen renderer receipt относится к2fe238b7b; renderer/i18n source bytes между ним и последним auth-only commit не изменились. Полный minified renderer receipt сохранён как предшествующая проверка, а не атомарная сборка финального whole-repo SHA.

Desktop worker не выполнял deployment, push/merge, native acceptance или live charged call. Task 7 / client Task 6 остаются **implemented + locally verified, pending independent/integrated/native/published acceptance**.
