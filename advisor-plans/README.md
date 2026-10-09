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
| C-02 | `SessionPersistenceQueue.cancel()` не сериализован с идущей записью — удалённая сессия может вернуться на диск | ~ | M | **чинится параллельным агентом** (в дереве были его незакоммиченные правки `sessions/*`; не трогали) |
| C-03 | Серверный `safeSend` не ловит исключения (клиентский аналог ловит) — обрыв replay | ~ | S | открыт |
| C-04 | `withRegistrySyncWrite` мутирует общий singleton-провайдер | ~ | S | открыт |
| C-05 | `before-quit`: async-обработчик без try/catch после `preventDefault()` — исключение в очистке = зависший процесс | ~ | S | открыт (рекомендация совпадает с выводами батча по quit-пути) |
| C-06 | Remote-fallback скрывает провал загрузки сессий ровно там, где баннер не показывается | ~ | S | открыт |
| C-07 | Дубли записей в таблице классификации каналов (merge-артефакт) | ~ | S | открыт |
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
| TECH-02 | `marketing:*`/`docs:*` живы в `package.json`, а `docs/repo-known-issues.md` объявляет их удалёнными | ✔ | S | открыт |
| TECH-03 | Дубль YAML-ключа в `registry/fragments/sessions.yaml` (два: `refs:` 285/297, `note:` 419/423) | ✔ | S | ✅ закрыт планом 004 |
| TECH-04 | Класса «тихий дубль ключа» ничто не ловит (уже стоил мёртвого workflow) | ✔ | S | ✅ закрыт планом 004 |
| TECH-05 | Одноразовые branch-mutating workflow (`apply-settings-ia-*.yml`) живы | ✔ | S | открыт |
| TECH-06 | «Foreign» тест-поломки после мержей всё ещё в дереве | ~ | S | открыт (ALREADY-TRACKED) |
| TECH-07 | Трекер объявлял `KnowledgeAgentPanel` немонтированным — фактически смонтирован | ✔ | — | ✅ статус исправлен в инвентаре |
| DX-01 | `typecheck:all` пропускает ~10 воркспейсов; корневой `typecheck` = только shared | ~ | S | открыт |
| DX-02 | Pre-commit хуков нет, staged-гейты — мёртвые скрипты | ~ | S | открыт |
| DX-03 | ESLint — 3 из ~19 воркспейсов; в CI только UI-ратчет | ~ | M | открыт |
| DX-04 | `bun run test` — 28-мин serial-прогон с 132 красными | ~ | M | открыт (ALREADY-TRACKED) |
| DEP-01/02 | Electron EOL-окно, Playwright-версия | ~ | M | открыт |
| DOC-01/02 | Ротация общего ключа (OPS), нет `.env.example` | ~ | S | открыт |

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

1. **S-набор:** TECH-02 (мёртвые скрипты + доку), TECH-05 (workflow), DX-01 (typecheck-покрытие), C-03/C-05/C-07, DOC-02.
2. **M:** PERF-01 (shell-first boot — до любых правок старта), PERF-04 (бюджет бандла), PERF-05 (виртуализация), SEC-03, C-01.
3. **Решения владельца:** SEC-01-остаток (UX подтверждения для `send=true` с trusted-поверхностей), C-02 (идёт в параллельной работе), C-08, PERF-07.

Отдельно замечено при финальной верификации: **`typecheck:electron` на main красный** — 4 ошибки в `apps/electron/src/renderer/App.tsx`: TS2305 «no exported member `AudioTranscriptActionsProvider`/`AudioTranscriptRetry`» в импорте из `@rox/ui` (`:96-97`) и два implicit-any в `useCallback<AudioTranscriptRetry>` (`:1940`). Факты: экспорты в исходниках присутствуют (`packages/ui/src/index.ts:41,66` и `components/chat/index.ts:17,20`), `@rox/ui` резолвится именно в исходники (`package.json` types → `src/index.ts`, `dist` не отслеживается), импорт синтаксически корректен (`type`-модификатор только у типа). Значит корень не в «устаревшей сборке» — ошибки в committed-состоянии и привязаны к коммиту `b7c049cde` (та же фича добавила и `useCallback<AudioTranscriptRetry>`); нужен разбор автором фичи. К выполненным планам отношения не имеет.

## Раунд 2 — закрытие оставшегося (2026-10-09, вечер, ветка `improve/advisor-plans-round2`)

Метод: 21 read-only скаут (валютность каждой находки на `3114264ee`) → правки в изолированном
worktree → локальные гейты (`typecheck:all` — 18 воркспейсов, `validate:ci`, целевые сьюты) → PR.
Сводка по находкам:

| # | Итог |
|---|---|
| F-00 «`typecheck:electron` красный» | **STALE**: зелёный на `3114264ee` (CI `validate:ci` + локальный прогон). Красный воспроизводится только в чек-ауте `fix/product-tour-native-green` (до-фичевое дерево `@rox/ui`). |
| TECH-02 | ✅ 6 мёртвых скриптов удалены, `docs/repo-known-issues.md` приведён к факту, тикет 08 отмечен (`5f0b37fd3`). |
| TECH-05 | ✅ оба одноразовых workflow + осиротевшие `patches/settings-ia-appshell.patch` и `scripts/patch-settings-ia-locales.mjs` удалены (`5f0b37fd3`). |
| DX-01 | ✅ 9 воркспейсов подключены, `typecheck` = `typecheck:all` (18 воркспейсов), `apps/viewer` починен (`lib` ES2022). Root `tsconfig.json` **намеренно не тронут**: его правка (`baseUrl`/`paths`) ломает `packages/ui` (TS6059) — проверено и откатано (`5f0b37fd3`). |
| DX-02 | ✅ 3 висячих staged-алиаса удалены, husky убран (хуков нет), доки исправлены; гейт — CI (`5f0b37fd3`). |
| C-03 | ✅ серверный `safeSend` ловит исключение (`transportLog.warn`), регресс-тест (`5556dfa55`). |
| C-04 | ✅ реестр параметризован (`GithubProviderStack.registry`), monkey-patch удалён, тест на перекрытие (`5556dfa55`). |
| C-05 | ✅ `before-quit`: try/catch/finally, `app.exit(0)` гарантирован (`bb307b9f5`… см. PR). |
| C-06 | ✅ предикат `shouldSurfaceSessionLoadFailure` — глотать провал можно только при видимом транспортном баннере (`4af48bd56`). |
| C-07 | ✅ дубли удалены, 4 `notes:*Comment` канала классифицированы (скрытая краснота: `routing.test.ts` не входит в `test:shared:all`), source-guard добавлен (`44b02e5b1`). |
| C-09 | ✅ `assertTrustedRenderer` + 12 привилегированных мостов, toolbar привязан к view, meeting-capture fail-closed (`bb307b9f5`). |
| SEC-04 | ✅ env-шов `CRAFT_SIYUAN_PLUGIN_FIXTURE_JSON` удалён (ничего не использовало), регресс-тест (`a7359e474`). |
| SEC-03 | ⛔ **осознанно откатано**: `entities:resolve` легитимно обслуживает несколько воркспейсов (`entities-reviewer-fixes.test.ts:75-95`), а неизвестный id обязан оставаться «Workspace not found». Сплошной guard дал ровно 5 контрактных регрессий и 0 выигрыша в этих ветках. Нужен пер-хендлерный разбор: guard ПОСЛЕ резолва воркспейса + явные исключения для кросс-воркспейсных чтений. |
| PERF-04 | ✅ `scripts/check-bundle-size.ts` + `perf-baselines/bundle-size.json` (floor 250 КБ, потолок 2.5 МБ) + блокирующий `bundle-size.yml`; char-loop → замкнутая формула с тестом-оракулом (`5f7b38af8`). |
| PERF-05 | ⚠️ в основном **STALE**: таблица/канбан/PremiumMenu уже оконные; оконён боковой `SessionList` (opt-in windowing в `EntityList`, измеряемые высоты), 50-строчный довесок удалён (`d97972484`). Осталось неоконным: notes/Knowledge-деревья (только CSS-cull). |
| PERF-06 | ✅ клиент держит last-known каталог и показывает syncing вместо «No skills configured» (`4af48bd56`). |
| PERF-08 | ✅ `actions/cache` для `~/.bun/install/cache` (23 install-джоба) и Playwright (4 джоба) в 15 workflow; node_modules не кэшируется (`3dd9260c7`). |
| PERF-03 | ⏸️ честный минимум (`--strict` на `electron-startup`) осознанно отложен до PERF-01 — комментарий в самом workflow; включать сейчас значит уронить лейн. |
| TECH-06 | ✅ 4 фикса (мёртвый `native-startup.test.ts` удалён по вердикту, realpath в 4 native-сьютах, стуб `roxExecutions/roxResourceLeases`, vendored-скиллы исключены из `scripts/test-all.ts`): в целевом каталоге 25 → 5 падений (`78ead1093`). |
| DOC-02 | ⚠️ **STALE-частично**: `.env.example` существовал; обновлён (убраны нечитаемые ключи, добавлены реально читаемые, указатель на `CONTRIBUTING.md`; только имена, без значений) (`5f0b37fd3`). |
| DEP-01/02 | ⏸️ анализ записан: Electron 39.2.7 вне поддержки (4 открытых High), Playwright 1.49.1; апгрейд — отдельный изолированный коммит (2 литерала + lock), вне этого раунда. |

Дополнительно найдено и зафиксировано (не чинилось): локальный прогон `packages/server-core/src/handlers/rpc/__tests__`
под bun 1.4.2 даёт 2 pre-existing `SyntaxError: applyTrustedHttpHeader` и 5 падений, которых нет в CI
(bun 1.3.14) — кандидат в продолжение TECH-06.
