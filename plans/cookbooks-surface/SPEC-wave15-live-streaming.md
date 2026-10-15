# SPEC: волна 15 — «Live Streaming & Honest Progress» (живой вывод, N/M, per-cell события)

База: origin/main `3b027dbb8` (2026-10-16). Ветка волны: `feat/cookbooks-w15` (воркдерево `~/Projects/rox-worktrees/cookbooks-w15`).
Точка отката: main до слияния PR волны (`git revert -m 1 <merge>`); точки отката волн 6–14 сохраняются.
Норматив: [PRD](PRD.md) · [SPEC](SPEC.md) · SPEC-wave9/10/11/13/14 · [ADR 001](decisions/001-runtime-container-and-secrets.md).
**Вендор-снапшот `apps/electron/resources/cookbooks/**` в этой волне МЕНЯЕТСЯ:** правки вносятся в лабораторию `/Users/t/Projects/2026-10-13-rox-cookbooks-notebooks` (plain-каталог, без VCS — так задумано, `plans/README.md:88`), затем ре-вендор по `PROVENANCE.md:29-44` + перегенерация sha256-манифеста и `Snapshot date`. Тесты лаборатории в снапшот не входят.

**Статус:** 🚧 в работе (фриз скоупа 2026-10-16).

## Цель

1. **Живой вывод.** stdout/stderr выполняющейся ячейки виден по мере появления: одиночный прогон (`/run-stream`) и run-all (`/run-all-stream` — per-cell события + живые кадры текущей ячейки).
2. **Честный прогресс.** «Выполнено {{done}} из {{total}}» в шапке run-all (существующий i18n-ключ `cookbooks.run.progress`, все 12 локалей — новых ключей не требуется).
3. **Структурный обход 60-с лимита WS-RPC handler.** `WsRpcServer.HANDLER_TIMEOUT_MS = 60_000` (`packages/server-core/src/transport/server.ts:1439`, потолок 240с) — сегодня любой прогон >60с получает транспортную ошибку, пока сайдкар продолжает работу. В W15 запуск — быстрый invoke (возвращает `{runId}`), события — push-канал, финальный результат — кадр `end`.

Бэклог-подтверждение: стриминг — консенсус-кандидат «w15+» во всех спеках волн 9–14 (`SPEC-wave14:153-155`, `SPEC-wave13:213-215`, `SPEC-wave11:60-61`, `SPEC-wave10:125-127`, `SPEC-wave9:12-16`).

## Решения (фриз)

1. **Аддитивные сайдкар-маршруты.** `POST /run-stream`, `POST /run-all-stream` — NDJSON (`application/x-ndjson; charset=utf-8`), по кадру за строку, `write` на каждый кадр; **без `Content-Length`**, тело ограничено закрытием соединения (дефолт `BaseHTTPRequestHandler.protocol_version = "HTTP/1.0"` — `protocol_version` НЕ менять). Валидация и гейты 1:1 с `/run`/`/run-all` (itemId → каталог → kind → parse_index → MAX_RUN_ALL_CELLS=100 → `begin_run` 503 → `_document_lock`-пре-персист → redact_values → missing_secrets). Существующие `/run` и `/run-all` не меняются байт-в-байт.
2. **Формат кадров (заморожен, §Контракт кадров).** Дискриминатор `t`; кадры `start`/`cell-start`/`stdout`/`stderr`/`display`/`cell-end`/`end`/`error`. Инварианты: `start` первым, `end` последним (в т.ч. при cancel/timeout), stdout/stderr-кадры **уже редуцированы**.
3. **Лаборатория, `/run-stream`:** `Kernel.execute_stream(code, *, index, timeout, run, emit)` — Popen как сегодня (`start_new_session`), но чтение stdout/stderr **инкрементально** (`selectors` + инкрементальный UTF-8-декодер `codecs.getincrementaldecoder("utf-8")(errors="replace")` — не резать многобайтные символы), таймаут — watchdog-поток (`proc.wait(timeout)` + `_kill_process_tree`), `communicate` больше не используется. Ребёнок запускается с `-u` (или `PYTHONUNBUFFERED=1` в `_subprocess_env`). `Kernel.execute` становится тонкой обёрткой над `execute_stream` (текущий dict-результат не меняется). Длительность ячейки измеряется host-side (`time.monotonic`) и попадает в `end.durationMs` (DTO `CookbooksRunResult.durationMs?: number` — аддитивно; рендер уже умеет падать на клиентский замер — заменить на серверный, когда пришёл).
4. **Лаборатория, `/run-all-stream`:** `execute_all_stream` — драйвер остаётся ОДНИМ процессом (единое пространство имён: «cell 1 sees cell 0's names»). Драйвер до StringIO-свопа сохраняет `real = sys.stdout` и пишет NDJSON-кадры **в этот сохранённый поток** (tee): per-cell `cell-start`; полные строки stdout/stderr — кадрами `stdout`/`stderr` (построчно, редуцированно); `cell-end` с полной записью ячейки (как элемент `cells[]` сегодня: stdout/error/displays/duration_ms/status); запись `results.json` per-cell сохраняется без изменений (финальный ответ собирается из него как сегодня). Хвост без `\n` — flush на `cell-end`. Не-JSON строки в stdout драйвера (прямые fd-записи кода) хост отдаёт кадром `stderr` текущей ячейки и НЕ мержит в финал (паритет с сегодняшним «не захватывается»).
5. **Redaction — построчный буфер + holdback.** Новый `redact_output_stream` в `secrets.py` (тот же longest-first алгоритм): копить буфер, маскировать только полные строки, хвост без `\n` держать; holdback = `max(len(v) for v in values) - 1` байт — отдавать `buf[:-holdback]` неразрезанным; остаток маскировать на `cell-end`/`end`/kill. Двойное маскирование (ребёнок + вызывающий) сохраняется. Секрет, разрезанный границей чанка, НЕ должен просочиться (тест с секретом через `\n`).
6. **Капы — инкрементально.** `_cap_output` (200 000 симв.) превращается в потоковый вариант: накопление ограничено, маркер `…[truncated: N chars omitted]` появляется ровно один раз; display-записи — существующие лимиты W11 (512КиБ/1.5МиБ/12/8МиБ) без изменений; кадр `display` идёт после прохождения капа `_rox_add`.
7. **Main: быстрый старт + push.**
   - Новые IPC-каналы: `cookbooks-lab:run-stream`, `cookbooks-lab:run-all-stream` (invoke → `{runId}` немедленно), `cookbooks-lab:run-event` (push, LOCAL_ONLY).
   - **runId генерирует РЕНДЕР** (`crypto.randomUUID()`) и передаёт во входе — это исключает гонку «событие до ответа invoke».
   - HTTP-клиент стрима: `fetch` + `response.body.getReader()` + NDJSON-парсер (буферизация неполных строк); читать до `end`/`error`; бюджеты — те же абсолютные (run 90с, runAll `min(900с, 60с×cells+30с)`); при обрыве соединения (закрытие окна/abort) — прервать чтение.
   - Каждый кадр получает `runId` + монотонный `seq` (образец — codebook, `packages/shared/src/playbooks/codebook.ts:107-198`); дедуп (как в статус-пуше) НЕ применять. События шлются через `pushTyped(server, RUN_EVENT, {to:'all'}, ev)`; кадр `end` несёт ПОЛНЫЙ финальный результат (`CookbooksRunResult`/`CookbooksRunAllResult`, аддитивно `durationMs`) — рендер заменяет живые буферы авторитетным результатом (дублирование текста кадров и финала — намеренно).
   - Существующие каналы `run`/`runAll` остаются без изменений (синхронный API сайдкара документирован; его 60-с транспортный потолок — предсуществующее ограничение, фиксируется в release-notes; страница мигрирует на стрим).
8. **Renderer.** `runCell`/`runAllCells` переходят на стрим: `runId` → `await api.runStream(...)` (быстрый ответ) → живые кадры в `liveStreams: Record<number,string>` (коалесценция через rAF/80мс) → `cell-end` инкрементально мёржится в `outputs` (паритет по статусам) → `end` — финализация (замена полного прогона как сегодня, поднабор — мёрж) и снятие busy. N/M — из кадров (`cell-end` → done++, `runProgress = {done,total}`), рендер через существующий `cookbooks-run-progress` и ключ `cookbooks.run.progress`. Скролл — к текущей ячейке на `cell-start` (если пользователь не скроллил вручную за последние 2с — фиксируем на run-all старте; v1: авто-следование включено, отключается любым скроллом). Отмена — существующий `cancel`; частичный живой текст сохраняется, статус `cancelled`. Guard'ы: размонтирование/смена документа (openItem/applyDocument) отписывает и не аппендит в чужие ячейки; `CellOutput` мемоизируется по (cell, liveLength, collapsed).
9. **i18n: ноль новых ключей обязательно** (переиспользуем `cookbooks.run.progress`, `cookbooks.run.batch` остаётся для обратной совместимости в старом пути; `cookbooks.run.progressAria` уже есть). Если в процессе выяснится, что пара строк нужна (например, aria для живого вывода) — только через таблицу локалей и оба frozen-теста страницы.
10. **Тесты.** Лаборатория: новые `tests/test_stream_kernel.py` и `tests/test_stream_host.py` (реальные LabHost/kernel — конвенция `unittest`, запуск `PYTHONPATH=src python3 -m unittest discover -s tests`); существующий сьют остаётся зелёным. Probe (`scripts/electron_handshake_probe.py`): добавить проверки новых маршрутов без запуска кода (401 без токена, 400/404-паритет валидации, наличие `application/x-ndjson` — где применимо) — 12 существующих проверок не ломать. Electron: юнит runtime-парсера + интеграционный E2E с реальным сайдкаром (кадры приходят до `end`; cancel mid-stream → `end.cancelled`; секрет через границу чанка замаскирован) + тесты страницы (живой буфер, N/M, финальный replace, unmount-guard). Инвентарь каналов перегенерировать (`bun scripts/ipc-inventory.ts`).

## Контракт кадров (NDJSON, заморожен)

```
POST /run-stream      {"itemId": str, "code": str, "index"?: int, "store"?: {str:str}}
POST /run-all-stream  {"itemId": str, "cells": [{"index": int, "source": str}], "store"?: {…}}
```

Ответ: `200`, `Content-Type: application/x-ndjson`, кадры (по одному JSON-объекту на строку):

```
{"t":"start",      "itemId":str, "index":int|null, "cells":[int]|null, "timeout":float}
{"t":"cell-start", "index":int}                                    # только run-all-stream
{"t":"stdout",     "index":int|null, "data":"<redacted>"}
{"t":"stderr",     "index":int|null, "data":"<redacted>"}
{"t":"display",    "index":int|null, "mime":str, "data":"<string>"}   # 1 запись = 1 кадр (/run-stream)
{"t":"cell-end",   "index":int, "status":"ok|error|skipped", "ok":bool, "timed_out":bool,
                   "duration_ms":int, "returncode":int|null, "error":str|null,
                   "stdout":str, "stderr":str, "displays":[…] }    # полная запись (как элемент cells[]), только run-all-stream
{"t":"end",        "ok":bool, "returncode":int|null, "timed_out":bool, "cancelled":bool,
                   "missing":[str], "duration_ms":int|null,
                   "result": <нативный результат /run или /run-all + duration_ms> }   # авторитетный финал
{"t":"error",      "status":int, "error":str}                      # пофреймовая ошибка после старта
```

Полевые имена кадров — sidecar-native snake_case (как `timed_out`/`duration_ms`/`returncode` в существующих ответах). IPC-события — camelCase (`timedOut`/`durationMs`); конверсию делает main (как уже делает `mapRunResult`).

Инварианты: `start` первый, `end` последний (в т.ч. cancel/timeout — `cancelled:true`); `index` для `/run-stream` = `null` (кроме `cell-end`, которого там нет); кадр `end` всегда несёт `result` (для `/run-stream` — `CookbooksRunResult` + `durationMs`, для `/run-all-stream` — `CookbooksRunAllResult`); ошибки ДО первого кадра — обычный 4xx JSON `{"error":…}` (не NDJSON); обрыв клиента → хендлер убивает процесс (RunHandle) и завершает поток.

**Эмиссия (кто что формирует):** `start` и `end` формирует маршрут (host) — kernel их не эмитит. `/run-stream`: kernel эмитит `stdout`/`stderr`-фрагменты (уже редуцированные, с holdback), маршрут — `display`-кадры (по одному на запись из `result.displays`, непосредственно перед `end`) и `end`. `/run-all-stream`: драйвер эмитит `cell-start`/`stdout`/`stderr` (полные строки, редуцированные, tee), `cell-end` с полной записью (включая `displays`) — отдельных `display`-кадров в run-all нет; маршрут ретранслирует кадры драйвера и формирует `start`/`end`.

IPC-событие (main → renderer, `cookbooks-lab:run-event`): `{ runId, seq, ...кадр }` (кадры 1:1, плюс `runId`/`seq`).

## Топология потоков

```
[Renderer] (runId=uuid) ──invoke runStream {runId,itemId,code,index}──▶ [Main handler] ──POST /run-stream──▶ [LabHost]
    ▲                                                                        │  (fetch, body.getReader)              │
    │◀──pushTyped run-event {runId,seq,start|stdout|…|cell-end|end}──────────┘  NDJSON-парсер                         │ Popen -u + selectors
    │                                                                                                                   ▼
    └── liveStreams[idx] += data (rAF-коалесценция); cell-end → merge outputs; end → finalize  ◀── кадры ──── [_RUNNER] (cell)
```

Для run-all: `[Main] ◀──POST /run-all-stream── [LabHost] ◀──NDJSON-кадры (tee в real stdout)── [_RUN_ALL_DRIVER] ──exec── [cells]`.

## F-спеки (что проверяемо)

| # | Фича | Слайс | Acceptance (наблюдаемое) |
|---|---|---|---|
| F1 | `/run-stream` живой stdout | L1+L2 | ячейка `print` ×3 с `sleep` между — кадры `stdout` приходят ДО `end` (порядок и число); `end.result.stdout` полный; `durationMs` > 0 |
| F2 | `/run-all-stream` per-cell | L1+L2 | 3 ячейки: `start`→(`cell-start`,`stdout`…,`cell-end`)×3→`end`; N/M из `cell-end`; вывод ячейки 2 виден до `cell-end` 3-й |
| F3 | redaction через границы | L1 | секрет, разрезанный чанком/строкой (`sk-abc`+`def`), замаскирован `***`; хвост без `\n` замаскирован на cell-end |
| F4 | cancel mid-stream | L1+L2 | `/cancel` во время стрима → `end.cancelled=true` не позднее ~2с; процесс-сирот нет; частичный stdout сохранён |
| F5 | main runStream/runAllStream | M1 | invoke резолвится `{runId}` <1с; кадры приходят push'ем с `seq` (монотонно, без дыр); `end.result` = полный DTO; abort при закрытии окна |
| F6 | N/M в UI | R1 | во время batch `cookbooks-run-progress` = «Выполнено k из M», k растёт по `cell-end`; скрыт после `end`; при одиночном run не показывается |
| F7 | живой буфер | R1 | текст ячейки появляется порциями во время выполнения (тест: два кадра → две порции); после `end` заменён финалом; отмена сохраняет частичный текст |
| F8 | 60-с потолок обойдён | M1 | invoke'ы `runStream` не держатся дольше старта — прогон длиннее 60с не рвёт транспорт (E2E: >60с-ячейка приходит `end`) |
| F9 | вендор=канон | V1 | sha256-манифест совпадает; `python3 scripts/electron_handshake_probe.py` → `[SUMMARY] 0 failed` (+ новые проверки) |
| F10 | контракт-доки | L3 | `ELECTRON-CONTRACT.md` = копия `docs/electron-integration.md`; §4.3 «no push channel» переписан; §3.5/§3.9/§6/§7/§8 в синхроне; номера строк актуальны |

## Слайсы и владение файлами (параллельная реализация)

| Слайс | Владеет (edit) | Зависит |
|---|---|---|
| **L1** (lab kernel) | `src/rox_cookbooks/kernel.py`, `src/rox_cookbooks/secrets.py`, новые `tests/test_stream_kernel.py` | — |
| **L2** (lab host) | `src/rox_cookbooks/host.py`, `scripts/electron_handshake_probe.py`, новые `tests/test_stream_host.py` | контракт кадров (§ выше) |
| **L3** (lab docs) | `docs/electron-integration.md` | контракт кадров |
| **M1** (electron main) | `apps/electron/src/main/cookbooks-runtime.ts`, `apps/electron/src/main/handlers/cookbooks.ts`, `apps/electron/src/shared/cookbooks.ts`, `apps/electron/src/shared/types.ts`, `packages/shared/src/protocol/{channels.ts,events.ts,catalog.ts,routing.ts}`, `apps/electron/src/{transport,shared/transport}/channel-map.ts` (проверить актуальный путь), `apps/electron/src/shared/__tests__/ipc-channels.generated.ts` (regen), новые `apps/electron/src/main/__tests__/cookbooks-stream.test.ts` + `cookbooks-stream.integration.test.ts` | контракт кадров |
| **R1** (renderer) | `apps/electron/src/renderer/pages/cookbooks/CookbooksSurfacePage.tsx`, `apps/electron/src/renderer/pages/cookbooks/__tests__/CookbooksSurfacePage.test.tsx` (+ при необходимости новый `live-stream.ts` модуль) | интерфейсы §7/§8 (заморожены здесь) |
| **V1** (lead) | ре-вендор: rsync → `apps/electron/resources/cookbooks/**`, `PROVENANCE.md` (манифест+дата) | L1–L3 |
| **I1** (lead/агент) | прогон интеграционных E2E + фиксов | V1+M1 |

Тесты лаборатории: `cd /Users/t/Projects/2026-10-13-rox-cookbooks-notebooks && PYTHONPATH=src python3 -m unittest discover -s tests` (baseline фиксируется до правок; интерпретатор — из бейзлайна). Electron: `bun test <файлы>` из воркдерева; полный агрегат — `bun run typecheck:all`.

## Вне скоупа (w16+)

Постоянное ядро/сессия (ipykernel/ZMQ-спайк), инспектор переменных, stdin/`input()`, виджеты и формы `#@param`, сниппеты, ресурс-метр RAM/CPU, стабильные `id` ячеек в DTO, экспорт HTML/PDF, редактор с подсветкой (CodeMirror); **живой `display()` внутри ячейки** — display-кадры только на `cell-end` (v1); перестройка `/run`/`/run-all` под стрим (остаются синхронными); Windows-специфика стрим-транспорта за рамками POSIX-пайпов проверяется штатным CI.
