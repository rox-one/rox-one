# ROX gateway — P0 OpenRouter exclusion (честный каталог)

Статус на 2026-08-13 (продолжение): **не `git am` старый двухкоммитный патч на текущий `release/v3.8.50`**. Exclusion уже в tip.

1. **Merged:** [agisota/zed-api#2](https://github.com/agisota/zed-api/pull/2) → `release/v3.8.50` @ `406ccebb06ef91f6c3de320aff4917ad34a65cbd`. OpenRouter отсутствует на assembly-путях `/v1/models`. Quota short circuit отдаёт `qtSd/*` (без remap на `rox/*`).
2. **Open follow-up:** [agisota/zed-api#4](https://github.com/agisota/zed-api/pull/4) `hotfix/rox-catalog-honesty` @ `d93f945a8323b31b5cdc5e1378a6cdba827d0879`. Serialize-time strip в `finalizeCatalogResponse`, quota honesty + listed-id policy test, dead late `allowedQuotas` branch удалён, `#4264`/`#9293` приведены к ROX (на `406ccebb` они падали, потому что ждали OpenRouter в каталоге).

Контракт: [`../superpowers/specs/2026-08-13-rox-gateway-openrouter-catalog-design.md`](../superpowers/specs/2026-08-13-rox-gateway-openrouter-catalog-design.md). План: [`../superpowers/plans/2026-08-13-rox-gateway-openrouter-catalog.md`](../superpowers/plans/2026-08-13-rox-gateway-openrouter-catalog.md).

Follow-up патч (поверх `406ccebb`): [`patches/rox-catalog-honesty-followup.patch`](patches/rox-catalog-honesty-followup.patch). Исторический двухкоммитный патч на `2e7732427`: [`patches/rox-catalog-openrouter-hotfix.patch`](patches/rox-catalog-openrouter-hotfix.patch) — не накатывать на tip.

`git push` от `cursor[bot]` на `agisota/zed-api` по-прежнему 403; PR #4 открыт через GitHub MCP как `agisota`. AC-07/08 (изолированный staging + runtime smoke) не закрыты.

---

Историческая запись 2026-08-12 ниже описывает первый hotfix, который **рекламировал uncallable `rox/*` quota-ключам**. Не `git am` только первый коммит.

Репозиторий gateway: `agisota/zed-api`, ветка `release/v3.8.50` @ `2e7732427fdf13a06e959fd043385c611647de17`.

Патч: [`patches/rox-catalog-openrouter-hotfix.patch`](patches/rox-catalog-openrouter-hotfix.patch). Применяется к `release/v3.8.50` без конфликтов (`git am --3way`, проверено на чистом клоне).

Этот файл лежит в ROX-репозитории, а не в gateway, потому что у среды, где готовился hotfix, был read-only доступ к `agisota/zed-api` (`Permission to agisota/zed-api.git denied to cursor[bot]`). Ветку и PR в gateway должен создать тот, у кого есть write.

## Что подтверждено на реальном коде

Все три дефекта воспроизведены прогоном против `release/v3.8.50` — это не review-гипотезы.

**1. Predicate не распознаёт canonical OpenRouter.** `isOpenRouterCatalogEntry()` искал подстроку `openrouter_` в `id`/`root`/`parent`. Это формат legacy-моделей The Old LLM (`tllm/openrouter_gpt_4_o`). Живой каталог складывает записи вида `{ id: "openrouter/<vendor>/<model>", owned_by: "openrouter", root: "<vendor>/<model>" }` — подстроки `openrouter_` в них нет, поэтому глобальный фильтр в `catalog.ts` был no-op. Неаутентифицированный `GET /v1/models` возвращал `openrouter/auto`, `openrouter/google/gemini-2.5-flash`, а также embedding/image/rerank/audio-записи из статического реестра — то есть утечка не зависела от живого fetch к OpenRouter.

**2. Scoped DB-key возвращает OpenRouter обратно.** Ветка per-key permissions итерировала исходную коллекцию `models`, а не уже очищенный `finalModels`. Ключ, в `allowedModels` которого есть OpenRouter-модель, получал её в ответе после того, как политика её удалила.

**3. Quota-exclusive short circuit обходит ROX public mode (найдено дополнительно).** Ранний `return` для ключей с непустым `allowedQuotas` (оптимизация #8770) срабатывает до того, как строится ROX public catalog. При `ROX_PUBLIC_CATALOG_ONLY=true` такой ключ получал 13 сырых `qtSd/<pool>/glm/...` идентификаторов вместо `rox/*`. Это нарушение того же контракта («клиенты используют только canonical rox/\* IDs»), которого не было в исходном handoff.

## Что исправлено

- `src/lib/roxPublicModelPolicy.ts` — predicate сверяет ownership точным сравнением (`owned_by`, `provider`, `providerId`, `provider_id`) и разбирает пути посегментно, поэтому ловит и `openrouter/...`, и вложенный `/openrouter/`, и legacy `openrouter_*`, но не задевает `acme/openrouter-proxy`. Добавлен `scopeRoxPublicCatalogForKey()` — одна реализация scoping публичного каталога по DB-ключу вместо двух копий цикла.
- `src/app/api/v1/models/catalog.ts` — per-key фильтрация идёт по `finalModels`; quota short circuit **всегда** отдаёт `qtSd/*` пула (OpenRouter режется в `finalizeCatalogResponse`). Public `rox/*` — только для не-quota ключей. Нельзя рекламировать `rox/*` quota-ключам: `validateQuotaAccess` отвечает `QUOTA_ONLY`.
- `src/app/api/v1/models/catalogResponse.ts` — exclusion продублирован в `finalizeCatalogResponse()`. Это единственный выход, общий для полной сборки каталога и для quota-пути, так что новая ветка не сможет опубликовать OpenRouter по забывчивости (fail-close).

Затронуты все поверхности каталога сразу: `getUnifiedModelsResponse` — общая точка для `/v1/models`, `/v1/models/{id}`, `/api/models/catalog`, `/v1/providers/{provider}/models`, specialty-каталогов и vscode-роутов. Админский `/api/models` собирается отдельно и не тронут — управление OpenRouter-подключениями в дашборде работает как раньше.

## Доказательства

| Проверка (2026-08-13, honesty) | Результат |
|---|---|
| RED: quota+public must not list `rox/*` на hotfix `8aaa9d039` | fail: `5 !== 0` (`rox/*` advertised) |
| GREEN: тот же тест после `48e22773c` | 6/6 pass в exclusion file (включая master-key + policy на listed `qtSd/*`) |
| Isolated `finalizeCatalogResponse` mixed-list | pass; commenting the filter → `openrouter/test` leaks (RED proven) |
| Focused suite (rox-*, #4264, #9293, isolated filter, quota-exclusive 4806/short-circuit) | 46 pass / 0 fail, `FOCUSED_EXIT=0` |
| `npm run typecheck:core` | `TYPECHECK_EXIT=0` |
| `git am --3way` на чистом `2e7732427` | `AM_EXIT=0` (2 коммита) |
| `git push origin hotfix/rox-catalog-openrouter` | 403 Permission denied `cursor[bot]` |

| Проверка (2026-08-12, первый hotfix — не применять один) | Результат |
|---|---|
| Новый e2e regression до фикса | 4 из 5 падают: канонические записи в ответе, DB-key возвращает `openrouter/google/gemini-2.5-flash`, quota-ключ отдаёт `qtSd/*` |
| Тот же regression после фикса | 5/5 pass |
| Focused ROX suite + оба адаптированных теста | 38/38 pass |
| Все тесты, упоминающие openrouter (87 файлов) | 1056/1057 pass |
| Полный `tests/unit/*.test.ts` (3336 файлов) | 25 624 pass / 13 fail |
| `npm run typecheck:core` | exit 0 |
| eslint + prettier + any-budget (pre-commit gates) | pass |

Каждый из 13 фейлов полного прогона перепроверен на чистом `release/v3.8.50` и падает там же (Adobe Firefly, postExchange OAuth, check-deps, env-doc-sync, doctor, auto-combos #4189, oauth timeout, pinned-proxy, quota PATCH, SSE numeric ids, RSA round-trip, i18n messages). Ещё два (`radar-api-routes`, второй `createSSEStream`) проходят при `--test-concurrency=4` на обеих ветках — это contention на 4 vCPU, а не регрессия.

### Осознанное расхождение с upstream

Два upstream-теста утверждали, что OpenRouter-модели **публикуются**, — ровно то, что запрещает ROX. Они и были причиной, по которой дефект дожил до merge: предикат-заглушка их не ломала.

- `openrouter-vision-sync-4264.test.ts` — покрытие #4264 (synced-модель отдаёт `capabilities.vision` в `/v1/models`) переведено на другого провайдера с тем же synced-путём, поэтому регрессия #4264 остаётся покрытой; добавлен тест на то, что synced OpenRouter не публикуется.
- `specialty-model-hidden-openrouter-9293.test.ts` — прямые проверки `getModelIsHidden` сохранены, а каталожная часть теперь фиксирует exclusion: в этом форке каталог больше не может отличить hidden от visible для OpenRouter, потому что не публикует ни того, ни другого.

Оба места помечены комментарием `ROX divergence:` — при ежедневном upstream-мерже конфликт в них ожидаем и разрешается в пользу ROX-версии.

## Как доставить follow-up (поверх merged #2)

```bash
git switch -c hotfix/rox-catalog-honesty 406ccebb06ef91f6c3de320aff4917ad34a65cbd
git am --3way docs/patches/rox-catalog-honesty-followup.patch
```

Или ревью/мерж [zed-api#4](https://github.com/agisota/zed-api/pull/4). После merge — деплой конкретного SHA на изолированный staging. Staging по-прежнему не выбран: `api.rox.one` — production, швейцарская нода — живая migration-нода, третий хост не принимает SSH. Runtime-проверки (JSON/SSE/telemetry/restart persistence) на follow-up ещё не выполнялись.
