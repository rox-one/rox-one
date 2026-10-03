# Pocket SSO desktop — устранение независимых P1

Дата: 2026-10-03. Checkout `/Users/t/.codex/worktrees/pocket-id-sso/rox-release-20261003`, branch `codex/pocket-id-sso`. Writer: desktop repair worker. Spec/plan: `docs/pocket-sso/spec.md`, `docs/pocket-sso/plan.md`. Исходное независимое review: `reports/pocket-sso-desktop-review.md` на `a37ad010cb998c5aeb95db9aa640e6af071d5eb7`; root отдельно исправил F1 в `080e20aad` до этой работы.

**Статус: F2–F4 исправлены и имеют локальные actual-module/process регрессии. Independent integrated/native acceptance Task 7 остаётся у lead.** Source commit `354a483acc708d8130104e39525fdd0e8681058f` и hashes указаны в `reports/pocket-sso-desktop-evidence/repair-checks.json`; прежние failure receipts сохранены. Deployment/push, live provider calls и native UI этим worker не выполнялись.

## F4 — durable logout fence и восстановление после crash

`RoxAccountAuthority.record` читает sealed pending revocation до active record. Если receipt существует, authority устанавливает null active execution и новое поколение; старый active file не используется для state/capture/inference. Поэтому crash между `writeLogout` и отдельным active `clear` больше не оживляет account.

Обычный `state` автоматически выполняет drain: сначала local clear, затем logout через sealed prior access proof и удаление receipt после ACK. Local clear failure и broker outage сохраняют receipt и disconnected state; повторный read после восстановления завершает drain. Logout также очищает in-memory record сразу после invalidation. Existing refresh/logout ancestry и generation/late response fences сохранены.

Регрессии вызывают настоящий authority: crash-window restart; clear failure restart; broker outage и последующий ordinary state retry; capture и stale inference denial; отсутствие account read до окончания revocation. Старые 12 authority checks и новые durable queue/resource checks тоже проходят.

## F2 — OMP credential/catalog domain и безопасная смена модели

`OmpAgent.setModel` различает public ROX и private/BYOK domains. Переход в любую сторону инвалидирует domain generation, завершает старую очередь событий, отсоединяет и завершает subprocess с bounded SIGKILL fallback. Следующий turn создаёт новый process environment и runtime profile через штатную credential resolution; публичный профиль получает canonical account key/base/catalog, private получает свой прежний credential path.

Generation проверяется после asynchronous account/native preparation и непосредственно перед dispatch; незавершённая подготовка устаревшего профиля удаляется до spawn. Старые prompt-error callbacks и host-tool results привязаны к исходному domain/child и не отправляются в successor. Поздний stream старого domain не принимается. Live set_model между aliases одного public domain сохраняет существующий verified catalog/readback workflow.

Новые тесты создают настоящие OmpAgent и subprocess fake CLI. Они проверяют private → public → private (три child, каждый с правильным environment/catalog), domain switch во время delayed actual stream и switch перед actual spawn во время native preparation (нулевой obsolete child, disposed profile, правильный successor). Эти процессы не выполняют network/provider request. Существующие public OMP checks сохраняют secret redaction, мини/title/call_llm, zero/ownerless no-spawn, account invalidation и cleanup.

## F3 — caller-owned session resource, callback lease и durable queue

SEND_MESSAGE получает resource lease синхронно, до первого await, и удерживает его до завершения invocation. Действующий чужой caller не может перепривязать session map, sealed binding, title или runtime; он получает `ROX_SESSION_OWNER_CONFLICT` до загрузки сообщений/dispatch. Existing caller binding сохраняется после завершения turn и после restart. Account switch того же local caller разрешён только после invalidation прежнего поколения и освобождения старых leases; native workspace grants остаются отдельной authority.

Authority сериализует claims одного resource и отвергает foreign caller для session/queued-message bindings. Late lookup сохранённого binding использует compare-before-publish и не переписывает уже выбранного owner. Backend context выбирается один раз до asynchronous preparation. Stream, title completion, SDK/branch/history callbacks, session/browser tool callbacks, spawned child и send_agent_message используют frozen owner. Asynchronous callbacks получают собственный lease; stale void metadata callbacks игнорируются, а paid/returning callbacks fail closed. Idle background events проходят тот же fence.

Queued messages сохраняют frozen context в памяти и sealed binding `queued-message:<workspace>:<session>:<messageId>` с точным authGeneration до ACK. После crash cold/lazy recovery читает этот binding перед replay; другое account или поколение не получает старое задание. Текст сообщений и существующие chats/config/workspaces сохраняются. Legacy queued messages без trusted sealed owner при включённой authority требуют явного retry и не используют ambient новый owner.

Actual SessionManager regression воспроизводит A pause на ensureMessagesLoaded, concurrent B, title B, queue/replay, late saved-owner restore при двух current callers, stale title/callback output и legitimate same-caller switch. Затем он отбрасывает in-memory queue context как после crash: exact-generation sealed owner восстанавливает A; после account switch replay завершается `ROX_ACCOUNT_CHANGED` с нулём SEND_MESSAGE dispatches. Backend-selection seam останавливается до actual provider request. F1 root regression по draft helper повторена без изменения helper-owner semantics.

## Проверки, source binding и пределы

Финальные commands, exit codes, hashes исходных файлов и evidence находятся в `repair-checks.json`. Целевой binary: `/Users/t/Projects/rox-release-20261003/apps/electron/vendor/bun/bun`, Bun 1.3.14.

- Targeted + related: 54 pass / 0 fail, 228 assertions, 13 файлов. Это actual authority, actual SessionManager с ограниченными persistence/event/backend-selection seams, actual fake-CLI subprocesses, broker mock transport и injected secure-storage tests.
- Final typechecks: server-core, shared и Electron — exit0. Последняя правка resource guard отдельно проверена actual owner suite и server-core typecheck; Electron check завершился после этой правки при неизменных публичных сигнатурах. Точные scope notes находятся в manifest.
- `git diff --check` проходит. Worker-owned test/typecheck/processes завершены до handoff; temporary negative-control source удалён, fake CLI fixtures очищены.

Это не published installers, actual Keychain/DPAPI, Mac/Windows UI/relaunch, live Pocket broker/Swiss inference/settlement или whole-repository full suite. Lead выполняет отдельное source/integrated/native review; Task 7 не объявляется полностью принятой.

## Failure history и negative controls

1. Logout baseline: 12 pass / 2 fail. Оба новых crash/clear restart checks ошибочно получили connected=true; after repair они fail closed.
2. OMP baseline: 0 pass / 2 fail. Public prompt сохранял private env/catalog; delayed old stream принимался после смены модели. After repair оба направления, in-flight и pre-spawn cases проходят.
3. SessionManager baseline negative control использует исходный committed module `080e20aad` с новыми проверками: B дошёл до сообщения (`UNSAFE_B_REACHED_MESSAGES`), а не был отклонён. Initial stdout parser учитывал только JSON и споткнулся о штатный session log; parser исправлен, содержательная failure сохранена отдельно в `session-resource-before-asserted.log`.
4. Первый OMP related rerun выявил слишком широкий текстовый replace, добавивший undefined generation в one-shot path. Он исправлен; последующие existing public lifecycle tests 9/0. Failed log оставлен.
5. Shared typecheck выявил семь прежних test fixture casts к Bun fetch, требующему `preconnect`. Добавлен явный unknown intermediary и типизированные параметры mock transport; это только fixture typing. Intermediate implicit-any failure также сохранён, финальный shared typecheck повторён.
