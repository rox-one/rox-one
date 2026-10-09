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
| 009 | `009-typecheck-all-coverage.md` | DX-01 | ✅ **выполнен** `3c90bc2d1` — +5 зелёных воркспейсов в `typecheck:all`; корневой `typecheck` = полный гейт; инвентарь 15=11+4; 0 новых ошибок (перепроверено 2026-10-09) |
| 010 | `010-server-safesend-try-catch.md` | C-03 | ✅ **выполнен** `31a1bce4e` — тест 2/2; транспорт 74/74; tsc server-core без новых ошибок |
| 011 | `011-before-quit-guard.md` | C-05 | ✅ **выполнен** `767615ad6` — хелпер+тест 3/3; electron tsc без новых ошибок |
| 012 | `012-channel-classification-dedup.md` | C-07 | ✅ **выполнен** `f2d46a56d` — routing 26/26 (было 22/2); сырые списки + инвариант на дубли |
| 013 | `013-env-example-refresh.md` | DOC-02 | ✅ **выполнен** `07f6ab983` — призраки Craft убраны; только живые переменные и пустые плейсхолдеры |
| 014 | `014-doc-secret-scrub.md` | DOC-01 | ✅ **выполнен** `148049dc7` — значения → `<REDACTED>`; **ротация ключа Deepgram обязательна (владелец)** |

## Находки

### Security
| # | Находка | Веттинг | Impact | Effort | Статус |
|---|---|---|---|---|---|
| SEC-01 | Deep-link из непроверенного веб-контента Browser Pane → сессия с `allow-all` и автоотправкой промпта (`browser-pane-manager.ts:4120-4140`, `NavigationContext.tsx:962-981`) | ✔ | критичный | M | ✅ граница доверия закрыта планом 002; **остаток** (UX-подтверждение `send=true` с trusted-поверхностей + i18n-ключ) закрыт `46f29e145` |
| SEC-02 | Самопровозглашённая capability клиента обходит LOCAL_ONLY-фенс → `shell:exec` с env сервера (`transport/server.ts:1054,1197-1212`; `rpc/system.ts:406-431`) | ✔ | критичный (для web/headless) | S | ✅ закрыт планом 001 |
| SEC-03 | Проверка «workspace из аргумента == workspace клиента» только при `ctx.principal` — для остальных клиентов не применяется | ~ | средний | S | ✅ закрыт `f8ec8eff9` (пер-хендлерный разбор после отката сплошного в раунде-2): единый `assertWorkspaceScope` (principal‖actor‖webUi), guard ПОСЛЕ резолва, `entities:resolve` — явное principal-исключение; регресс-тесты |
| SEC-04 | Тестовый шов в продакшн-коде: путь к fixture-манифесту плагинов берётся из ENV | ~ | низкий | S | ✅ закрыт `a7359e474` (раунд-2) |

### Correctness
| # | Находка | Веттинг | Effort | Статус |
|---|---|---|---|---|
| C-01 | Потеря события в WS-транспорте не вызывает ресинка — потеря необратима | ~ | M | ✅ закрыт: watermark держится на смежном seq + один guarded reconnect (`1991d6115`, main) + порт parse-fail-recovery и `deliveredSeqs`-дедупа replay (`fd134c0fb`); 80/0 + 43/0 |
| C-02 | `SessionPersistenceQueue.cancel()` не сериализован с идущей записью — удалённая сессия может вернуться на диск | ~ | M | ✅ закрыт `541239b69` + hardening `r3-fix2`: `cancel` async (seal-tombstone + await `writeInProgress`), `flush` делает сбой видимым, unseal только после успешного delete; 167/0 |
| C-03 | Серверный `safeSend` не ловит исключения (клиентский аналог ловит) — обрыв replay | ~ | S | ✅ закрыт планом 010 (`31a1bce4e`) |
| C-04 | `withRegistrySyncWrite` мутирует общий singleton-провайдер | ~ | S | ✅ закрыт `5556dfa55` (раунд-2): реестр параметризован, monkey-patch удалён |
| C-05 | `before-quit`: async-обработчик без try/catch после `preventDefault()` — исключение в очистке = зависший процесс | ~ | S | ✅ закрыт планом 011 (`767615ad6`) |
| C-06 | Remote-fallback скрывает провал загрузки сессий ровно там, где баннер не показывается | ~ | S | ✅ закрыт `4af48bd56` (раунд-2) + фоллоу-ап `de55a375c` (проглоченный провал восстанавливается на reconnect) |
| C-07 | Дубли записей в таблице классификации каналов (merge-артефакт) | ~ | S | ✅ закрыт планом 012 (`f2d46a56d`) — попутно позеленён `routing.test.ts` (4 неклассифицированных канала комментариев) |
| C-08 | Транскрипты встреч пишутся без fsync/readback, в отличие от `meeting.json` | ~ | S | ✅ закрыт `e829807fa`: `writeDurable` (fsync файла+каталога, readback) для `transcript.json`/`.md`; residual: `archiveTranscript` (copyFileSync ревизий) — вне клейма |
| C-09 | Прямые `ipcMain`-мосты без проверки отправителя, тогда как соседние мосты её имеют | ~ | S | ✅ закрыт `bb307b9f5` (раунд-2) + фоллоу-ап `82677be5a` (remote browser bridge под guard'ом) |
| C-10 | Латч `stopSent` в войс-оверлее не сбрасывается при неуспешной команде | ✔ | S | ✅ закрыт планом 006 |

### Performance
| # | Находка | Веттинг | Effort | Статус |
|---|---|---|---|---|
| PERF-01 | Первый кадр создаётся последним: окно ждёт весь bootstrap сервера и messaging (корень наблюдавшихся ~75 с) | ~ | M | ✅ закрыт `69a9d4ab4`: shell-first boot (окно до bootstrap); warm FMP 6756→2499 ms (PASS), window-created 2076→1563 ms; холодный скан скиллов (~54 с inline) — зона PERF-02/06 |
| PERF-02 | Бенч холодного старта: подмена HOME (тот же баг, что в харнессе) + cold-run вне бюджета | ✔ | S | ✅ закрыт планом 003 |
| PERF-03 | CI-перф-гейт меряет синтетические JS-симуляции, React/DOM в контуре нет | ~ | M | ⏸️ осознанный deferral (`69a9d4ab4`): strict на electron-startup не включаем — бюджет ×4=1200 ms недостижим (floor ~1.0 с — запуск Electron + eval main-бандла; медианы 1563–2633 ms), warm FMP у границы 3200; workflow и комментарии приведены к факту |
| PERF-04 | «Bundle profile» — цикл по символам; бюджета на размер бандла нет (в релизе чанк 3.2 МБ) | ~ | S/M | ✅ закрыт раундом-2 (`5f7b38af8` + фоллоу-апы `617eb8f8a`/`c0303003a`): бюджеты по суммам префиксов, css-карты, общие тоталы, негативные тесты |
| PERF-05 | Виртуализации списков нет нигде при фикстуре на 2000 сессий | ~ | M | ✅ закрыт: боковой `SessionList` — раунд-2 (`d97972484`), notes/Knowledge-деревья — `WindowedTreeList` (`5db9780c4`) + `note:`-неймспейс (`r3-fix2b`) + anchor-пиннинг окна (`fd134c0fb`) |
| PERF-06 | Фоновый sync скилл-паков блокирует `skills:get` и старт агента (~35 с) | ~ | S | ✅ закрыт `4af48bd56` (раунд-2) + фоллоу-ап `6d7e0a38b` (states skills-syncing во все атомы) |
| PERF-07 | Две дублирующие PowerShell-пробы владельца ОС с разошедшимися бюджетами | ~ | S | ✅ закрыт `cd711ea0b`: единая батч-проба (один спавн, 180 с), дубликат-модуль удалён, прогрев PowerShell в windows-лейне; residual: потерян ia32/Sysnative-путь |
| PERF-08 | В workflow нет кэша зависимостей/браузеров | ~ | S | ✅ закрыт `3dd9260c7` (раунд-2): `actions/cache` для bun-кэша (23 джоба) и Playwright (4), + `continue-on-error` фоллоу-ап `ca41368b5` |

### Tech debt / DX / Docs / Deps
| # | Находка | Веттинг | Effort | Статус |
|---|---|---|---|---|
| TECH-01 | Мёртвая копия onboarding-хендлера в `main` (~300 строк, не регистрируется) | ✔ | S | ✅ закрыт планом 005 |
| TECH-02 | `marketing:*`/`docs:*` живы в `package.json`, а `docs/repo-known-issues.md` объявляет их удалёнными | ✔ | S | ✅ закрыт планом 007 (`15bcb6d3c`) |
| TECH-03 | Дубль YAML-ключа в `registry/fragments/sessions.yaml` (два: `refs:` 285/297, `note:` 419/423) | ✔ | S | ✅ закрыт планом 004 |
| TECH-04 | Класса «тихий дубль ключа» ничто не ловит (уже стоил мёртвого workflow) | ✔ | S | ✅ закрыт планом 004 |
| TECH-05 | Одноразовые branch-mutating workflow (`apply-settings-ia-*.yml`) живы | ✔ | S | ✅ закрыт планом 008 (`90d5af09e`) |
| TECH-06 | «Foreign» тест-поломки после мержей всё ещё в дереве | ~ | S | ✅ закрыт: раунд-2 (`78ead1093`, 25→5) + раунд-4 (`e14a9c992`, `r3-fix2b`): 8 fails + 2 SyntaxError → 0 errors; residual: 3 cross-file изоляционных артефакта в одном bun-процессе (`--isolate` лечит; раннер/CI изолируют пофайлово) |
| TECH-07 | Трекер объявлял `KnowledgeAgentPanel` немонтированным — фактически смонтирован | ✔ | — | ✅ статус исправлен в инвентаре |
| DX-01 | `typecheck:all` пропускает ~10 воркспейсов; корневой `typecheck` = только shared | ~ | S | ✅ закрыт планом 009 (`3c90bc2d1`): в цепь добавлены 5 сегодня-зелёных воркспейсов (cloud-gateway/cloud-runner/discord-worker/whatsapp-worker/test-harness), корневой `typecheck` = `typecheck:all`, инвентарь 15=11+4; красные записаны как known baseline |
| DX-02 | Pre-commit хуков нет, staged-гейты — мёртвые скрипты | ~ | S | ✅ закрыт `5f0b37fd3` (раунд-2): висячие staged-алиасы удалены, husky убран |
| DX-03 | ESLint — 3 из ~19 воркспейсов; в CI только UI-ратчет | ~ | M | ✅ закрыт `8a76e86b9` + hardening `r3-fix2`: 10 воркспейсов, ratchet без disable-обхода (`noInlineConfig`), stale/rename-гварды, CODEOWNERS; baseline 455→463 (вскрыто 8 подавленных нарушений) |
| DX-04 | `bun run test` — 28-мин serial-прогон с 132 красными | ~ | M | ✅ закрыт `0f5a28fcb` + hardening `r3-fix2`: параллельный раннер (bounded pool), шарды, baseline-классификация (131 known-red), host-global порт-лизы, nightly-лейн; residual: полный сквозной прогон не исполнялся (ночная проверка), baseline снят с macOS-ревизии |
| DEP-01/02 | Electron EOL-окно, Playwright-версия | ~ | M | ✅ закрыт `ec17e925d`: Electron `^39.2.7`→`^44.7.0` (typecheck чист, native-probe под 44 живой), Playwright `1.49.1`→`1.64.0` (chromium-1248); +DEP-03: мёртвые `@types/uuid` (root/core/shared) и `@dnd-kit/helpers` удалены |
| DOC-01 | Живой ключ Deepgram в `docs/plans/2026-10-08-rox-batch.md` (утёк в **публичный** `origin/main`, коммит `5c112fec3`) | ~ | S | ✅ значение вычищено из дерева `148049dc7`; **ротация снята владельцем 2026-10-09** (принятый риск; force-push истории не требуется) |
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

1. ✅ **S-набор** закрыт планами 007-014; ✅ **раунд-2** — закрытие остатка; ✅ **раунд-4** (параллельная волна, ниже) — остаток из §2 и §3 закрыт.
2. ✅ **Остаток закрыт** раундами 2+4: PERF-01/03*/04/05/06/07/08, SEC-03/04, C-01/02/03/04/05/06/07/08/09, TECH-02/05/06, DX-01/02/03/04, DEP-01/02/03 (*PERF-03 — осознанный deferral strict-гейта: бюджет недостижим, см. карточку).
3. **Решения владельца:** ротация ключа Deepgram — **снята владельцем 2026-10-09** (принятый риск; значение вычищено из дерева). Открытых обязательств нет.

Отдельно замечено при финальной верификации: **`typecheck:electron` в этом worktree красный** — 4 ошибки в `apps/electron/src/renderer/App.tsx`: TS2305 «no exported member `AudioTranscriptActionsProvider`/`AudioTranscriptRetry`» в импорте из `@rox/ui` (`:96-97`) и два implicit-any в `useCallback<AudioTranscriptRetry>` (`:1940`). Факты: экспорты в исходниках присутствуют (`packages/ui/src/index.ts:41,66` и `components/chat/index.ts:17,20`), `@rox/ui` резолвится именно в исходники (`package.json` types → `src/index.ts`, `dist` не отслеживается), импорт синтаксически корректен (`type`-модификатор только у типа). Перепроверка 2026-10-09 установила единый корень: **артефакт окружения worktree** — `node_modules` (и `apps/electron/node_modules`) симлинкнуты в канонический чекаут `~/Projects/rox-one`, из-за чего `@rox/ui` резолвится в тамошние исходники (ревизия `0c918497d`), где экспортов `AudioTranscript*` ещё нет; в этом дереве экспорты есть, а TS7006 на `:1940` — следствие провалившегося импорта. В чистом клоне эти 4 ошибки ожидаются отсутствующими (подтверждать на CI-раннере). К выполненным планам отношения не имеет.

Обнаружено при исполнении S-батча 007-014: **зафиксирован baseline красноты typecheck** (предсуществующий; ни один файл из планов 007-014 не затронут). Корневая причина части красного — **артефакт окружения worktree**: `node_modules` этого дерева — симлинк на `~/Projects/rox-one/node_modules` (канонический чекаут на другой ревизии), поэтому импорты `@rox/*` из части воркспейсов резолвятся в чужой чекаут, где `AttachmentTranscript` ещё не экспортируется. Симптомы: `typecheck:all` уже красный (обрыв на шагах `browser-intel`/`server-core`: `dto.ts:15`, `utils/files.ts:6`, `files.ts:453`, `native-content-integration.test.ts:89`), плюс известные красные воркспейсы `apps/cli`/`apps/webui` (тот же класс) и `apps/viewer`/`packages/messaging-gateway` (окружение; у messaging-gateway ещё и собственный дрейф `accessMode` в тестах). В чистом клоне эти красноты, вероятно, отсутствуют — при работе в этом worktree помнить про leaky-резолв. Учтено в DX-01 (план 009): в цепь добавлены только сегодня-зелёные воркспейсы (cloud-gateway, cloud-runner, discord-worker, whatsapp-worker, test-harness); красные записаны как known baseline.

Перепроверка 2026-10-09 (11 состязательных верификаторов против `3c90bc2d1`, включая CI): гейты планов 007-014 подтверждены; секрет-скан дерева и диапазона чист; на наших SHA провалов CI нет; исправлены три несоответствия индекса — статус 009, атрибуция C-02 и корень electron-красноты (выше).

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
| C-09 | ✅ `assertTrustedRenderer` (10 вызовов в `main/index.ts`) + registered-webcontents-вариант для sendSync-каналов, toolbar привязан к view, ssh/mail/meetings/entities-flags/surface-routes — через существующие `isTrustedSender`-dependency, meeting-capture fail-closed (`bb307b9f5`). |
| SEC-04 | ✅ env-шов `CRAFT_SIYUAN_PLUGIN_FIXTURE_JSON` удалён (ничего не использовало), регресс-тест (`a7359e474`). |
| SEC-03 | ⛔ **осознанно откатано**: `entities:resolve` легитимно обслуживает несколько воркспейсов (`entities-reviewer-fixes.test.ts:75-95`), а неизвестный id обязан оставаться «Workspace not found». Сплошной guard дал ровно 5 контрактных регрессий и 0 выигрыша в этих ветках. Нужен пер-хендлерный разбор: guard ПОСЛЕ резолва воркспейса + явные исключения для кросс-воркспейсных чтений. |
| PERF-04 | ✅ `scripts/check-bundle-size.ts` + `perf-baselines/bundle-size.json` (floor 250 КБ, потолок 2.5 МБ) + блокирующий `bundle-size.yml`; char-loop → замкнутая формула с тестом-оракулом (`5f7b38af8`). |
| PERF-05 | ⚠️ в основном **STALE**: таблица/канбан/PremiumMenu уже оконные; оконён боковой `SessionList` (opt-in windowing в `EntityList`, измеряемые высоты), 50-строчный довесок удалён (`d97972484`). Осталось неоконным: notes/Knowledge-деревья (только CSS-cull). |
| PERF-06 | ✅ клиент держит last-known каталог и показывает syncing вместо «No skills configured» (`4af48bd56`). |
| PERF-08 | ✅ `actions/cache` для `~/.bun/install/cache` (23 install-джоба) и Playwright (4 джоба) в 15 workflow; node_modules не кэшируется (`3dd9260c7`). |
| PERF-03 | ⏸️ честный минимум (`--strict` на `electron-startup`) осознанно отложен до PERF-01 — комментарий в самом workflow; включать сейчас значит уронить лейн. |
| TECH-06 | ✅ 4 фикса (мёртвый `native-startup.test.ts` удалён по вердикту, realpath в 4 native-сьютах, стуб `roxExecutions/roxResourceLeases`, vendored-скиллы исключены из `scripts/test-all.ts`): в целевом каталоге 25 → 5 падений (`78ead1093`). |
| DOC-02 | ⚠️ **STALE-частично**: `.env.example` существовал; обновлён (убраны нечитаемые ключи, добавлены реально читаемые, указатель на `CONTRIBUTING.md`; только имена, без значений) (`5f0b37fd3`). |
| DEP-01/02 | ⏸️ анализ записан: Electron 39.2.7 вне поддержки (4 открытых High), Playwright 1.49.1; апгрейд — отдельный изолированный коммит (2 литерала + lock), вне этого раунда. → **закрыт в раунде-4** (`ec17e925d`): Electron 44.7.0 / Playwright 1.64.0 |

Дополнительно найдено и зафиксировано (не чинилось): локальный прогон `packages/server-core/src/handlers/rpc/__tests__`
под bun 1.4.2 даёт 2 pre-existing `SyntaxError: applyTrustedHttpHeader` и 5 падений, которых нет в CI
(bun 1.3.14) — кандидат в продолжение TECH-06.

## Раунд 3 — адверсариальная верификация раунда 2 (8 рефьютеров, read-only)

Каждый пункт ниже — независимый агент, которому было поручено **опровергнуть** утверждение; итог и последствия.

| # | Утверждение | Вердикт | Что сделано |
|---|---|---|---|
| V1 | «Все привилегированные ipcMain-мосты проверяют отправителя» | не опровергнуто | Полная таблица 117 регистраций; единственная без проверки (`__get-web-contents-id`) не имеет привилегий. Замечания: optional-deps-гварды fail-open, если вызывающий забудет dep (сейчас все продакшн-вызовы передают) — оставлено как явный fail-open с тестом на единственный call-site. |
| V2 | «Новые проверки не ломают легальных вызовов» | **опровергнуто** | `__browser:invoke` требовал совпадения `req.workspaceId` с ЛОКАЛЬНОЙ привязкой окна, но remote-mirror воркспейсы несут id удалённого сервера («the two never match», release-notes 0.10.0) → удалённый browser-мост был бы сломан. Клозы workspace-равенства убран, осталась проверка managed-window; поведение восстановлено. |
| V3 | «Env-шов SEC-04 удалён полностью, регресс-тест ловит возврат» | не опровергнуто | Тест падает и при reintroduction, и при NODE_ENV-gate (bun test ставит NODE_ENV=test). Честные границы: import-time или перенесённый в другое место шов тест не поймает. |
| V4 | «safeSend и registry-параметризация сохраняют поведение» | не опровергнуто | Мерж взял вариант main (закрывает сокет при фейле — строго лучше; его тест `server-safe-send.test.ts` это пинует). Реестр регистрируется на всех трёх выходах `importGithubFromEnv` до `acquireLease`. |
| V5 | «Провал загрузки сессий больше нельзя проглотить, скиллы не пустеют» | **опровергнуто (scoped)** | (A) проглоченный провал не восстанавливался: не-stale reconnect не обновлял список → теперь флаг `swallowedSessionLoadRef` + перезагрузка на reconnect; (B) `skillsAtom` оставался пустым для других поверхностей (SkillSelectorPopover в TaskEditor, omnibox) → добавлен `skillsSyncingAtom`, popover получил `loading` и больше не заявляет «No skills configured» во время загрузки. |
| V6 | «Боковой список 2000 сессий монтирует ограниченное число строк» | не опровергнуто (bounded), но найден дефект | Активная/выбранная строка размонтировалась при скролле → клавиатурная навигация могла «умереть» (ref-row исчезал). Добавлен `withMountedAnchor`: активная строка всегда в окне; пины в `list-virtualization.test.ts`. |
| V7 | «Бюджет бандла нельзя обойти молча, кэши безопасны» | **опровергнуто** | Обходы: бюджет по максимальному чанку префикса позволял мелкому сиблингу вырасти до бюджета; floor исключал мелкие префиксы; CSS и общий размер не гейтились. Гейт переведён на **суммы** по префиксам + отдельные карты для css + общие тоталы js/css, negatives покрыты тестами. Кэши: 27 шагов, ни один не блокирует job; добавлено `continue-on-error: true` (upstream `restoreImpl` делает `setFailed` при сбое cache-сервиса). |
| V8 | «Каждый канал классифицирован ровно один раз и дубль не вернётся» | не опровергнуто (state), **опровергнуто** (gate) | 863 = 367 + 496, строки уникальны ✓; но `routing.test.ts` не запускался ни одним CI-гейтом (в `test:shared:all` его не было) → теперь добавлен в `test:shared:all` (идёт через `validate:ci`). |

Итог раунда 3: 3 опровергнутых утверждения и 1 частично — все исправлены в той же ветке; 2 находки стали новыми тестами, 2 — новыми гейтами.

## Раунд 4 — параллельная волна закрытия остатка (ветка `improve/advisor-plans-round3`)

Параллельная волна (отдельная сессия), интегрирована после раунда-2/3: пул `r3-impl` (11 задач → 12 находок) →
адверсариальная перепроверка (14 read-only верификаторов, `r3-verify`: 7 UPHOLD / 3 PARTIAL / 3 REFUTE) →
фикс-волны `r3-fix2`/`r3-fix2b` → мерж `origin/main` (739cdabec) `fd134c0fb` с реконсиляцией C-01 (main-база +
порт `deliveredSeqs`-дедупа replay и parse-fail-recovery) и windowing (anchor-пиннинг в `WindowedTreeList`).
Приёмка на замороженном дереве: `validate:ci` ✅ (typecheck:all 18 воркспейсов, i18n parity/sorted/coverage,
doc-tools, browser-intel smoke); appshell browser-сьют 500/0 (замер до мержа; дельта мержа покрыта 58/0 +
`bun run --cwd apps/electron typecheck` 0); transport 80/0 + 43/0; sessions 167/0; notes-family 58/0; authority 48/0;
ratchet OK (463 / 10 воркспейсов); DX-04 16/0; nav-recovery 43/0 и nav-browser 41/0 (`ROX_UI001_BROWSER_TEST=1`);
`bunx electron --version` = v44.7.0; `bun install --frozen-lockfile` ✅; yaml-дублей нет.

| # | Итог (коммиты ветки) |
|---|---|
| PERF-01 | ✅ shell-first boot `69a9d4ab4`: окно до bootstrap; warm FMP 6756→2499 ms (PASS), window-created 2076→1563 ms; харденинг: гонка `__project-authority:resolve` закрыта (регистрация до окна), ранний sync-порт загейчен (реальный probe: registered→порт, unregistered→0) |
| PERF-03 | ⏸️ осознанный deferral: strict выключен с доказательством (бюджет ×4=1200 ms недостижим — floor ~1.0 с на запуск Electron + eval main-бандла; warm FMP у границы 3200); workflow и комментарии приведены к факту |
| PERF-05 | ✅ остаток: `WindowedTreeList` для notes/Knowledge `5db9780c4` + `note:`-неймспейс `r3-fix2b` + anchor-пиннинг `fd134c0fb` (клавиатура не умирает при скролле активной строки за окно) |
| PERF-07 | ✅ `cd711ea0b`: единый батч-проб (один спавн, 180 с), дубликат-модуль удалён, прогрев PowerShell в windows-лейне (residual: путь ia32/Sysnative) |
| C-01 | ✅ main-вариант `1991d6115` + порт дедупа replay и parse-fail-recovery (реконсиляция `fd134c0fb`); residual R2–R4 (одношотовый latch, эфемерные события, TTL-границы) задокументированы |
| C-02 | ✅ `541239b69` + hardening `r3-fix2`: unseal-lifecycle после успешного delete, `flushAll`=allSettled, пропущенный `.catch`; 167/0 |
| C-08 | ✅ `e829807fa`: `writeDurable` (fsync файла+каталога, readback) для `transcript.json`/`.md`; residual: `archiveTranscript` (копии ревизий) |
| SEC-03 | ✅ `f8ec8eff9`: пер-хендлерный guard после резолва (principal‖actor‖webUi); `entities:resolve` — явное principal-исключение; нюанс: ряд хендлеров защищён access-gate'ами (латентность подтверждена) |
| SEC-01 | ✅ остаток `46f29e145`: confirm перед авто-отправкой + i18n-ключ во всех 12 локалях; untrusted-путь не доходит до confirm |
| TECH-06 | ✅ `e14a9c992` + `r3-fix2b`: 8 fails + 2 SyntaxError → 0 errors; 3 cross-file изоляционных артефакта только в однопроцессном прогоне (`--isolate` лечит; раннер/CI изолируют пофайлово) |
| DX-03 | ✅ `8a76e86b9` + hardening `r3-fix2`: ratchet 463 без disable-обхода (`noInlineConfig`), stale/rename-гварды, CODEOWNERS |
| DX-04 | ✅ `0f5a28fcb` + hardening `r3-fix2`: host-global порт-лизы, guard `--update-baseline`+subset, nightly-лейн |
| DEP-01..03 | ✅ `ec17e925d`: Electron 44.7.0 / Playwright 1.64.0 / мёртвые `@types/uuid`+`@dnd-kit/helpers` удалены |

Известные границы раунда-4: host-нагрузка >200 (чужие worktree-сессии) давала таймаут-флейки в общих прогонах —
перепроверено серийно, все зелёные; cold-FMP бенча флаки (зона PERF-02/06); скрытая краснота `routing.test.ts`
переведена в `validate:ci` ещё раундом-2 (`ca41368b5`).
