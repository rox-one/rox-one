# Независимое ревью Pocket SSO desktop

Дата: 2026-10-03. Проверенная исходная ревизия: `a37ad010cb998c5aeb95db9aa640e6af071d5eb7` (`codex/pocket-id-sso`, после main merge). Рабочее дерево: `/Users/t/.codex/worktrees/pocket-id-sso/rox-release-20261003`. Режим: чтение source, ограниченные локальные probes и этот отчёт; reviewer не изменял implementation, не выполнял deployment, push или commit. Интегратор параллельно добавляет регрессии/исправления; находки ниже относятся к исходному committed SHA, а не к последующей незакоммиченной версии.

**Результат: четыре P1; P0 не выявлен. Task 7 не принят.** Все четыре переданы lead до подготовки отчёта. Пройденные happy-path тесты не закрывают эти дополнительные переходы и окна гонки.

## P1 — caller context draft helper проверяется только после чужого inference

`packages/server-core/src/handlers/rpc/sessions.ts:558` захватывает caller context и передаёт его в `improveDraft`. Однако `packages/server-core/src/sessions/SessionManager.ts:6470–6475` вызывает `querySessionLlm` без него, затем проверяет caller уже после результата. Фактический backend берёт context из общей session map/binding (`SessionManager.ts:6271`).

Следствия: до первого SEND_MESSAGE новая сессия не имеет binding, поэтому публичный draft helper получает `ROX_TRUSTED_ACCOUNT_REQUIRED` несмотря на ready account. На общей сессии, привязанной к ещё действующему caller A, caller B запускает helper с credentials A; проверка B после запроса не предотвращает неправильное account attribution/charge. После локальной смены account старый binding также может ошибочно блокировать текущий caller.

Воспроизведение: ready account → создать сессию → improveDraft до первого сообщения; либо записать binding A, захватить живой context B и вызвать `improveDraft(sessionId,text,B)`. Сопоставить supplied context и `coreConfig.roxExecutionContext` при создании actual backend. Source однозначно показывает потерю аргумента; lead независимо подтвердил и добавил регрессию actual SessionManager → mock backend. Старый `improve-draft.test.ts` заменяет `querySessionLlm` и не проверяет owner.

Исправление: передать frozen caller context до backend/postInit/query, проверить его до dispatch и после результата; не выбирать saved A context, а затем проверять B.

## P1 — переключение private/BYOK → public сохраняет прежний ключ процесса

`packages/shared/src/agent/omp-agent.ts:2191–2196` меняет live RPC model без пересоздания child. Персональный key и canonical public catalog собираются только при spawn (`omp-agent.ts:785–798`). `chatImpl` обновляет account authority (`:2046`), но возвращённый credential не меняет environment уже запущенного процесса. `SessionManager.updateSessionModel` вызывает этот путь напрямую (`SessionManager.ts:6571`).

Воспроизведение `/tmp/pocket-desktop-review-probe.ts` использует настоящий OmpAgent и настоящий subprocess с protocol fake CLI, synthetic account и synthetic неправильным session key. Запустить private `kimi-k3`, затем `setModel('rox/standard')` и второй chat. Команда: `NODE_ENV=test /Users/t/Projects/rox-release-20261003/apps/electron/vendor/bun/bun /tmp/pocket-desktop-review-probe.ts`.

Наблюдение: оба chat завершились; `spawns=1`; второй prompt подтвердил public provider/model, `personalCredentialMatches=false`. Никакой actual provider запрос не выполнялся. Первый запуск probe без NODE_ENV=test корректно fail-closed на обязательном managed native runtime; затем использован штатный test-only fixture seam.

Следствие: публичная ROX inference может использовать ambient/session/connection key и некaнонический catalog/base URL, унаследованные от private процесса; нарушается обязательный account-key override. При переходе в обратную сторону также требуется отдельная граница catalog/credentials.

Исправление: пересоздавать subprocess при смене public/private credential/catalog domain и повторно собирать canonical environment. Сохранить тест обеих направленностей и отсутствие принятия старого процесса/результата.

## P1 — конкурирующий caller перепривязывает выполняющийся SEND_MESSAGE

`SessionManager.ts:6915–6916` записывает caller в общую `roxExecutions` map и binding до последующих await. Позднее actual backend выбирает context из изменяемой map (`:4430`), а stream fence также читает её повторно (`:7380`). `RoxAccountAuthority.bind` не отвергает смену owner общей resource; обе caller generations остаются действующими.

Воспроизведение `/tmp/pocket-desktop-race-probe.ts` вызывает настоящий `SessionManager.sendMessage`: A пишет owner и останавливается на `ensureMessagesLoaded`; B той же сессии пишет owner B и останавливается; A продолжает до backend-selection seam. Команда: `NODE_ENV=test /Users/t/Projects/rox-release-20261003/apps/electron/vendor/bun/bun /tmp/pocket-desktop-race-probe.ts`.

Наблюдение: `{requestAccount:"account-a",backendSelectedAccount:"account-b",bothCallerContextsStillCurrent:true}`. Probe останавливается непосредственно до backend создания; actual provider charge не выполнялся. Source actual backend использует именно этот resolver. Persistence/event seams изолированы и временная workspace удалена.

Следствие: сообщение/контекст A может уйти под personal credential B. Обычная проверка `assertCurrent` этого не ловит: обе caller/account generations current. Rebinding также происходит до ветки `managed.isProcessing`, поэтому затрагивает очереди/steering/поздние callbacks.

Исправление: сохранить per-invocation frozen owner, проверять session resource ownership перед dispatch/принятием результата и при очереди либо явно отвергать concurrent caller conflict. Не ограничиваться проверкой общей map после await.

## P1 — незавершённый logout оживляет active account после crash

`packages/shared/src/auth/rox-account-authority.ts:100–104` сначала инвалидирует память, затем сохраняет revocation intent, затем отдельной операцией очищает active record. Crash между durable `writeLogout` и active `clear` оставляет оба encrypted records. Loader (`:47–56`) и `state` игнорируют pending logout и восстанавливают прежнее поколение из active record.

Воспроизведение `/tmp/pocket-logout-crash-probe.ts`: ready fixture, записать logout receipt, оставить active record как в указанном crash window, создать новый RoxAccountAuthority на том же store; вызвать `state`, `capture`, `inference`. Команда: `NODE_ENV=test /Users/t/Projects/rox-release-20261003/apps/electron/vendor/bun/bun /tmp/pocket-logout-crash-probe.ts`.

Наблюдение: `{pendingLogout:1,connected:true,inferenceAccount:"account-a",brokerLogouts:0}`. Secrets — только synthetic fixtures, в выводе только account ID и flags.

Следствие: requested logout не является durable fence; relaunch допускает paid execution до revocation и не восстанавливает незавершённый logout автоматически. Аналогичный риск существует при storage clear failure, даже если immediate in-memory generation уже отрезан.

Исправление: при загрузке pending revocation fail-closed для active account, завершить локальное очищение и retry broker receipt до ready/capture/inference; сохранить receipt через outage. Добавить crash-window + clear-failure restart регрессии.

## Проверенные границы и ограничения

- Actual GUI/headless Electron registration проходит через core handlers; `packages/server-core/src/handlers/rpc/index.ts` вызывает обновлённый `registerOnboardingHandlers`, legacy Electron onboarding module не является активным SSO доказательством. Main authority создаётся в `apps/electron/src/main/index.ts:863` с Electron safeStorage и userData `pocket-accounts`.
- START/CLEAR SSO ограничены actual local Electron binding; state/balance допускают native principal или local binding. Native workspace grants и Pocket identity имеют разные authority. `transport/server.ts` проверяет access до handler dispatch.
- Device proof/device_code остаются main-owned, renderer получает user code и строго ограниченный broker URL `/login/device?v=2`. Snapshot строится строгой проекцией; inference credential вообще не является RPC return. В inspected changed path не найдено raw personal key/token в renderer props, URL или диагностике. Stderr/debug маскируются registered-secret redactor.
- Новая vault использует safeStorage на Mac/Win, отвергает Linux/unavailable backend, шифрует account pointer/record/resource binding/revocation receipt, выполняет atomic rename и sealed-file fsync; не мигрирует/удаляет старые chats/config/workspaces. Тесты encryption используют injected synthetic AES backend. Это не Keychain/DPAPI proof. Source проверки symlink не являются полным adversarial filesystem proof.
- Mandatory startup читает current cloud state, не принимает persisted local displayName вместо Pocket account, повторяет identity/workspace/account readback после async preparation. Hook один раз открывает external browser и показывает cancel/retry. Legal acceptance/profile completion исполняет website; desktop не заменяет их локальной identity. Broker approve source дополнительно проверяет Pocket namespace, active key, unblocked account и handle. Полная законность/профиль/live browser остаются website/native acceptance.
- Ready zero ROX остаётся authenticated; paid inference gate проверяет availableRox до public spawn. Snapshot money strings валидируются; central cabinet выводит available/held. Footer и balance не подставляют gamification money; XP отдельный. Все actual 12 локалей покрыты исходным parity receipt; rerun интегрированной parity принадлежит lead.
- Existing registry fixture действительно запускает WsRpcServer/WsRpcClient/core registry и local binding; SessionManager execution заменён stub. OMP fixtures запускают реальные процессы с fake CLI; installed native OMP/provider request не проверен. Это объясняет, почему четыре вышеописанных перехода не обнаружены прежним 401/0 receipt.
- Known settings five failures имеют frozen baseline proof и не заявлены здесь как SSO regression.
- Не проверены actual Mac/Win UI, OS secret backend, native relaunch, опубликованные installers, broker/Swiss live charged inference, grants/settlement или production rollout. Broker durable logout-only ancestry — отдельная обязательная deployment dependency; старый access proof не должен разрешать read/refresh/inference.

## Ограниченная независимая проверка

Запущен pinned Bun1.3.14 suite: core-registry, pocket-account-store, startup-caller-boundary, startup-setup-needs и profile-strip-account. Итог записывается ниже после завершения. Исходные upstream receipts прочитаны из `reports/pocket-sso-desktop-evidence/checks.json`; они относятся к pre-merge `2a2ebec6d` и не объявляются атомарным proof текущего SHA. Current main merge source отдельно просмотрен, последующие repair commits требуют нового независимого recheck.

Фактический итог независимого запуска: **41 pass / 1 fail, 137 assertions**, пять файлов, 70.99s, exit1. Единственный failure — actual core registry subprocess timeout 60s; harness сообщил `killed 1 dangling process`. Vault, startup и footer проверки прошли. Тот же registry раньше проходил в receipt 2a2ebec6d; сейчас timeout не классифицируется как source regression без отдельного causality proof. Concurrent integration workload и ранее зафиксированные fixture timeouts требуют отдельного isolated recheck у lead. Четыре P1 выше имеют самостоятельные source/probe доказательства и не зависят от этого timeout.

Временные probe files сохранены для интегратора в `/tmp/pocket-desktop-review-probe.ts`, `/tmp/pocket-desktop-race-probe.ts`, `/tmp/pocket-logout-crash-probe.ts`; source worktree reviewer не менял. Из implementation файлов может существовать новый drift от lead после этого отчёта. После исправлений повторить regression/negative-control на новом committed SHA; данный отчёт сохраняет исходную failure history.
