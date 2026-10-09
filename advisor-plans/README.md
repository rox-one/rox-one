# Advisor plans — /improve по rox-one (2026-10-09)

Ревизия аудита: `4418fca40` (рабочее дерево `archive/rox-one-e01-wt`, ветка `e01-decisions`). Уровень: standard (hotspot-weighted, ключевые пакеты). Метод: 6 read-only скаутов по категориям + независимый триаж всего `plans/problem-inventory.md`; ключевые находки **веттированы оркестратором личным чтением кода** (колонка «Веттинг»: ✔ — читал сам, ~ — отчёт скаута с точными строками). Правила скилла 4/6 соблюдены: значения секретов не воспроизводились, инъекций в прочитанном не найдено. Полные карточки находок: `agent://improve-audit-1…6` и свёрнутый отчёт `/tmp/improve-full.md`.

Не аудировано (честная граница): vendored/generated (`resources/**`, `dist/**`), i18n-JSON, iOS/cloud-модули, состояние remote-веток. Статусы инвентаря, которых коснулся триаж, — в `plans/problem-inventory.md` (раздел «Reconcile 2026-10-09»).

## Планы и их статус

| # | План | Находка | Статус |
|---|---|---|---|
| 001 | `001-local-only-fence-trusts-client-capability.md` | SEC-02 | ✅ **выполнен** `007ca567a` — `error-codes` 11/11, соседние native-сьюты зелёные |
| 002 | `002-browser-pane-deeplink-trust-boundary.md` | SEC-01 | ✅ **выполнен** `e70e5992b` — pane 91, routing 8, nav-recovery 41, entities 22 |
| 003 | `003-startup-bench-keychain-and-cold-budget.md` | PERF-02 | ✅ **выполнен** `6a7b718a8` — bench 5/5 |
| 004 | `004-yaml-duplicate-key-guard.md` | TECH-03/04 | ✅ **выполнен** `3a7d2fc99` — гард: 98 файлов чисто, негатив exit 1 с ключом/строкой, тест 3/3 |
| 005 | `005-dead-onboarding-handler-cutover.md` | TECH-01 | ✅ **выполнен** `0372ccd84` — fixture 1, core onboarding 9, flow 5, orphan-guard 2 |
| 006 | `006-voice-overlay-stop-latch.md` | CORRECTNESS-10 | ✅ **выполнен** `85b1354c6` — isolated 3/3, wrapper 1/1 |
| 007 | `007-dead-marketing-docs-scripts.md` | TECH-02 | ✅ **выполнен** `15bcb6d3c` — −6 скриптов; JSON/grep/каталоги чистые |
| 008 | `008-one-shot-branch-workflows-removal.md` | TECH-05 | ✅ **выполнен** `90d5af09e` — −4 файла; workflow 18; живых ссылок нет |
| 009 | `009-typecheck-all-coverage.md` | DX-01 | ⏳ план дописывается (замеры базовой красноты — в примечании ниже) |
| 010 | `010-server-safesend-try-catch.md` | C-03 | ✅ **выполнен** `31a1bce4e` — тест 2/2; транспорт 74/74; tsc server-core без новых ошибок |
| 011 | `011-before-quit-guard.md` | C-05 | ✅ **выполнен** `767615ad6` — хелпер+тест 3/3; electron tsc без новых ошибок |
| 012 | `012-channel-classification-dedup.md` | C-07 | ✅ **выполнен** `f2d46a56d` — routing 26/26 (было 22/2); сырые списки + инвариант на дубли |
| 013 | `013-env-example-refresh.md` | DOC-02 | ✅ **выполнен** `07f6ab983` — призраки Craft убраны; только живые переменные и пустые плейсхолдеры |
| 014 | `014-doc-secret-scrub.md` | DOC-01 | ✅ **выполнен** `148049dc7` — значения → `<REDACTED>`; **ротация ключа Deepgram обязательна (владелец)** |

## Находки

### Security
| # | Находка | Веттинг | Impact | Effort | Статус |
|---|---|---|---|---|---|
| SEC-01 | Deep-link из непроверенного веб-контента Browser Pane → сессия с `allow-all` и автоотправкой промпта (`browser-pane-manager.ts:4120-4140`, `NavigationContext.tsx:962-981`) | ✔ | критичный | M | ✅ закрыт планом 002 |
| SEC-02 | Самопровозглашённая capability клиента обходит LOCAL_ONLY-фенс → `shell:exec` с env сервера (`transport/server.ts:1054,1197-1212`; `rpc/system.ts:406-431`) | ✔ | критичный (для web/headless) | S | ✅ закрыт планом 001 |
| SEC-03 | Проверка «workspace из аргумента == workspace клиента» только при `ctx.principal` — для остальных клиентов не применяется | ~ | средний | S | план не писался (нужен отдельный разбор) |
| SEC-04 | Тестовый шов в продакшн-коде: путь к fixture-манифесту плагинов берётся из ENV | ~ | низкий | S | план не писался |

### Correctness
| # | Находка | Веттинг | Effort | Статус |
|---|---|---|---|---|
| C-01 | Потеря события в WS-транспорте не вызывает ресинка — потеря необратима | ~ | M | открыт |
| C-02 | `SessionPersistenceQueue.cancel()` не сериализован с идущей записью — удалённая сессия может вернуться на диск | ~ | M | ✅ **закрыт параллельным агентом** `12688a1bf` (уже в origin/main; мы файлы `sessions/*` не трогали) |
| C-03 | Серверный `safeSend` не ловит исключения (клиентский аналог ловит) — обрыв replay | ~ | S | ✅ закрыт планом 010 (`31a1bce4e`) |
| C-04 | `withRegistrySyncWrite` мутирует общий singleton-провайдер | ~ | S | открыт |
| C-05 | `before-quit`: async-обработчик без try/catch после `preventDefault()` — исключение в очистке = зависший процесс | ~ | S | ✅ закрыт планом 011 (`767615ad6`) |
| C-06 | Remote-fallback скрывает провал загрузки сессий ровно там, где баннер не показывается | ~ | S | открыт |
| C-07 | Дубли записей в таблице классификации каналов (merge-артефакт) | ~ | S | ✅ закрыт планом 012 (`f2d46a56d`) — попутно позеленён `routing.test.ts` (4 неклассифицированных канала комментариев) |
| C-08 | Транскрипты встреч пишутся без fsync/readback, в отличие от `meeting.json` | ~ | S | открыт |
| C-09 | Прямые `ipcMain`-мосты без проверки отправителя, тогда как соседние мосты её имеют | ~ | S | открыт |
| C-10 | Латч `stopSent` в войс-оверлее не сбрасывается при неуспешной команде | ✔ | S | ✅ закрыт планом 006 |

### Performance
| # | Находка | Веттинг | Effort | Статус |
|---|---|---|---|---|
| PERF-01 | Первый кадр создаётся последним: окно ждёт весь bootstrap сервера и messaging (корень наблюдавшихся ~75 с) | ~ | M | открыт (ALREADY-TRACKED как «P2 shell-first boot») |
| PERF-02 | Бенч холодного старта: подмена HOME (тот же баг, что в харнессе) + cold-run вне бюджета | ✔ | S | ✅ закрыт планом 003 |
| PERF-03 | CI-перф-гейт меряет синтетические JS-симуляции, React/DOM в контуре нет | ~ | M | открыт |
| PERF-04 | «Bundle profile» — цикл по символам; бюджета на размер бандла нет (в релизе чанк 3.2 МБ) | ~ | S/M | открыт |
| PERF-05 | Виртуализации списков нет нигде при фикстуре на 2000 сессий | ~ | M | открыт |
| PERF-06 | Фоновый sync скилл-паков блокирует `skills:get` и старт агента (~35 с) | ~ | S | открыт |
| PERF-07 | Две дублирующие PowerShell-пробы владельца ОС с разошедшимися бюджетами | ~ | S | открыт |
| PERF-08 | В workflow нет кэша зависимостей/браузеров | ~ | S | открыт |

### Tech debt / DX / Docs / Deps
| # | Находка | Веттинг | Effort | Статус |
|---|---|---|---|---|
| TECH-01 | Мёртвая копия onboarding-хендлера в `main` (~300 строк, не регистрируется) | ✔ | S | ✅ закрыт планом 005 |
| TECH-02 | `marketing:*`/`docs:*` живы в `package.json`, а `docs/repo-known-issues.md` объявляет их удалёнными | ✔ | S | ✅ закрыт планом 007 (`15bcb6d3c`) |
| TECH-03 | Дубль YAML-ключа в `registry/fragments/sessions.yaml` (два: `refs:` 285/297, `note:` 419/423) | ✔ | S | ✅ закрыт планом 004 |
| TECH-04 | Класса «тихий дубль ключа» ничто не ловит (уже стоил мёртвого workflow) | ✔ | S | ✅ закрыт планом 004 |
| TECH-05 | Одноразовые branch-mutating workflow (`apply-settings-ia-*.yml`) живы | ✔ | S | ✅ закрыт планом 008 (`90d5af09e`) |
| TECH-06 | «Foreign» тест-поломки после мержей всё ещё в дереве | ~ | S | открыт (ALREADY-TRACKED) |
| TECH-07 | Трекер объявлял `KnowledgeAgentPanel` немонтированным — фактически смонтирован | ✔ | — | ✅ статус исправлен в инвентаре |
| DX-01 | `typecheck:all` пропускает ~10 воркспейсов; корневой `typecheck` = только shared | ~ | S | ⏳ план 009 готовится; замеры оркестратора: зелёные — cloud-gateway/cloud-runner/discord-worker/whatsapp-worker/test-harness; красные предсуществующие — cli/webui (класс AttachmentTranscript), viewer/messaging-gateway (артефакт путей чужого чекаута `~/Projects/rox-one`) |
| DX-02 | Pre-commit хуков нет, staged-гейты — мёртвые скрипты | ~ | S | открыт |
| DX-03 | ESLint — 3 из ~19 воркспейсов; в CI только UI-ратчет | ~ | M | открыт |
| DX-04 | `bun run test` — 28-мин serial-прогон с 132 красными | ~ | M | открыт (ALREADY-TRACKED) |
| DEP-01/02 | Electron EOL-окно, Playwright-версия | ~ | M | открыт |
| DOC-01 | Живой ключ Deepgram в `docs/plans/2026-10-08-rox-batch.md` (утёк в **публичный** `origin/main`, коммит `5c112fec3`) | ~ | S | ✅ вычищено из дерева `148049dc7`; **ротация ключа обязательна — за владельцем** (эскалация); force-push истории — опционально после ротации |
| DOC-02 | `.env.example` описывал pre-Rox/Craft контур с мёртвыми ключами | ~ | S | ✅ закрыт планом 013 (`07f6ab983`) |

## Рассмотрено и отклонено (by-design / settled)

- **§4.11 общий bearer `CLOUD_RUNS_TOKEN`** — решено: `plans/next-program/decisions/003-cloud-runs-auth.md` + PRD («JWT не планируется»).
- **§8.10 два query DSL** — by design (PRD: внешний предикат, ANDed с CollectionFilters).
- **§9.3 Rox Connect LOCAL_ONLY** — by design (`packages/shared/src/auth/rox-cloud.ts:4-5`).
- **Продакшн `fixtures:false` в local ASR** — by design; QA патчит собранный бандл.
- **Строгие ACL/token-проверки, fail-closed** — by design.
- **Комплаенс (HIPAA/SOC2) и «платные» контуры** — вне направления проекта (явно заявлено владельцем).
- **Медленные PowerShell-пробы на холодном windows-раннере** — бюджет 180/420/480 с уже принят и подтверждён зелёным лейном; оптимизация — отдельная перспектива (PERF-07 пересекается).

## Направление (варианты, не задачи)

- **D-01 Почта «в интернет»** — код готов (`shared/src/mail/*`, `services/rox-maild/`), нужен внешний DNS/SPF/DKIM/Resend и явное одобрение владельца. L.
- **D-02 Per-user секреты + SSO-выдача ключей** — `user-secrets-provision.ts` (T-19 stub) + PocketID-хук; снимает операционную работу с пользователя. M–L.
- **D-03 Закрыть unified-shell вердиктом, а не флагом** — ADR-0001/0019 + `tickets/11` (записанный вердикт ENABLE_DEFAULT/KEEP_EXPERIMENTAL); контрибуции только в существующий PanelHost. S/M.
- **D-04 Программа «честность дерева»** — TECH-01/02/05, §6.1 (legacy MCP-исходники), `dashboard.html`, vendored-тесты в `test-all.ts`; цель — трекеры, соответствующие коду. M.

## Рекомендуемый порядок оставшегося

1. ✅ **S-набор закрыт** планами 007-014 (TECH-02, TECH-05, C-03/C-05/C-07, DOC-01/DOC-02) — детали в таблице планов; открытый хвост — только ротация ключа (владелец).
2. **Остаток:** DX-01 (план 009 — почти готов), PERF-01 (shell-first boot — до любых правок старта), PERF-04 (бюджет бандла), PERF-05 (виртуализация), SEC-03, C-01.
3. **Решения владельца:** ротация ключа Deepgram; SEC-01-остаток (UX подтверждения для `send=true` с trusted-поверхностей); C-08; PERF-07.

Отдельно замечено при финальной верификации: **`typecheck:electron` на main красный** — 4 ошибки в `apps/electron/src/renderer/App.tsx`: TS2305 «no exported member `AudioTranscriptActionsProvider`/`AudioTranscriptRetry`» в импорте из `@rox/ui` (`:96-97`) и два implicit-any в `useCallback<AudioTranscriptRetry>` (`:1940`). Факты: экспорты в исходниках присутствуют (`packages/ui/src/index.ts:41,66` и `components/chat/index.ts:17,20`), `@rox/ui` резолвится именно в исходники (`package.json` types → `src/index.ts`, `dist` не отслеживается), импорт синтаксически корректен (`type`-модификатор только у типа). Значит корень не в «устаревшей сборке» — ошибки в committed-состоянии и привязаны к коммиту `b7c049cde` (та же фича добавила и `useCallback<AudioTranscriptRetry>`); нужен разбор автором фичи. К выполненным планам отношения не имеет.

Обнаружено при исполнении S-батча 007-014: **зафиксирован baseline красноты typecheck** (предсуществующий; ни один файл из планов 007-014 не затронут). Корневая причина части красного — **артефакт окружения worktree**: `node_modules` этого дерева — симлинк на `~/Projects/rox-one/node_modules` (канонический чекаут на другой ревизии), поэтому импорты `@rox/*` из части воркспейсов резолвятся в чужой чекаут, где `AttachmentTranscript` ещё не экспортируется. Симптомы: `typecheck:all` уже красный (обрыв на шагах `browser-intel`/`server-core`: `dto.ts:15`, `utils/files.ts:6`, `files.ts:453`, `native-content-integration.test.ts:89`), плюс известные красные воркспейсы `apps/cli`/`apps/webui` (тот же класс) и `apps/viewer`/`packages/messaging-gateway` (окружение; у messaging-gateway ещё и собственный дрейф `accessMode` в тестах). В чистом клоне эти красноты, вероятно, отсутствуют — при работе в этом worktree помнить про leaky-резолв. Учтено в DX-01 (план 009): в цепь добавлены только сегодня-зелёные воркспейсы (cloud-gateway, cloud-runner, discord-worker, whatsapp-worker, test-harness); красные записаны как known baseline.