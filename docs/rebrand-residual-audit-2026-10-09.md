---
title: Аудит остатков прежних имён и сторонних брендов
date: 2026-10-09
status: implemented
branch: rebrand-20261009
---

# Аудит остатков прежних имён и сторонних брендов

Перепроверка всей кодовой базы и собранного приложения на ссылки к прежним
именам репозитория и сторонним продуктам, и очистка того, что осталось от
прошлых проходов. Проверенные токены (регистронезависимо): `craft-agents`,
`craft-agents-oss`, `Craft` / `Craft Agents`, `lukilabs`, `craft.do` /
`Craft Docs`, `craftagents://`, `CRAFT_*`, `.craft-agent`, `conation` /
`conation-dev`, `macro-inc`, `macro` (слово), `infisical`, `siyuan`,
`omp` / `OMP`.

## Действующая политика (не переопределяется этим проходом)

| Источник | Что фиксирует |
|---|---|
| `packages/shared/src/identity/manifest.ts` | Канон: `Rox`, `one.rox.app`, `rox://`, `~/rox`. Зарегистрированные legacy-алиасы (`com.lukilabs.craft-agent`, `craftagents://`, `.craft-agent`, `CRAFT_*`, `thecraftagents.com`) со сроком удаления **2027-03-01**. |
| `docs/runtime-branding-audit.md` | «Изменять ROX-тексты и пользовательские подсказки; сохранять upstream-идентичность, лицензии и исторические доказательства». |
| `packages/shared/src/identity/terms.ts` | `FORBIDDEN_IN_NORMAL_UI` (в этом проходе расширен: `omp`, `Infisical`, `SiYuan`, `macro-inc`) и allowlist ключей, которым допустимо называть совместимые рантаймы. |

## Вычищено в этом изменении

1. **Метаданные и корневые доки** — описания `package.json` (root, cli,
   shared, server-core, cloud-gateway), `CONTRIBUTING.md`, `SECURITY.md`,
   `Dockerfile.server` (образ `rox-server`), `.gitignore`-комментарий,
   `apps/electron/README.md` (в т.ч. устаревший `appId`), `README.md`,
   `AGENTS.md`; инструкции `.github` (шаблоны issues, комментарии и имена
   шагов воркфлоу — `runs-on` не тронуты).
2. **Ресурсы** — `OMP-DISCOVERY.json` → `ROX-CLI-DISCOVERY.json`,
   `OMP-POLICY-DISCOVERY.json` → `ROX-CLI-POLICY-DISCOVERY.json`,
   `OMP-RUNTIME-TOOLS.json` → `ROX-CLI-RUNTIME-TOOLS.json` (содержимое
   byte-identical, поэтому SHA-256 в исторических манифестах остаются
   валидными для содержимого), bundled-док `craft-cli.md` → `rox-cli.md`
   вместе с кросс-ссылками в остальных док-файлах.
3. **Локали (12)** — 26 ключей `omp*` → `roxCli*`, 9 `infisical*` → `keeper*`,
   8 `siyuan*` → нейтральные (`knowledgeCloud*`, `notesPlugin`, …) + удалён
   дубль `siyuan.openCompat`; значения: `capabilityCatalog.scopes` «OMP» →
   «Rox CLI», `Infisical` → `Rox Keeper`, `SiYuan` → `Rox Notes`,
   «First-party Craft code» → «First-party Rox code».
4. **Renderer** — ссылки на переименованные ключи; `OmpCredentialStep` →
   `RoxCliCredentialStep` (файл, компонент, типы, DOM-id);
   `data-list-role="omp-skills"` → `runtime-skills`;
   `craftagents://` **эмиттеры** (10 мест: EditPopover, HeaderMenu,
   SidebarMenu, ChatPage, SkillsListPanel, SourcesListPanel, SettingsNavigator,
   SourceInfoPage, SkillInfoPage, playground) → `rox://` — парсеры и
   регистрация схемы оставлены совместимыми.
5. **Пути конфигурации в подсказках** — `~/.craft-agent/...` в
   инструкционных строках заменены на флаг-зависимый помощник
   `roxHomeDocDisplay()` (вынесен в `packages/shared/src/docs/home-display.ts`);
   `APP_ROOT` больше не хардкодит legacy-путь; `DOC_REFS.craftCli` → `DOC_REFS.roxCli`.
6. **Release notes** — бренд в прозе (32 файла), URL/пути/env-имена сохранены;
   в `next.md` — «OMP connection» → «Rox CLI connection».
7. **Env-эмиссия** — канон `ROX_SERVER_TOKEN` (сервер читает ROX первым,
   legacy `CRAFT_SERVER_TOKEN` принимается; CLI-спавнер, install/build-скрипты,
   `.env`-пример, webui-плейсхолдер); CLI-баннер и `--help` теперь `rox`.
8. **Dockerfile.server** — пользователь/группа/домашний каталог `rox`,
   том `…/.rox`, `ROX_SERVER_TOKEN` в примерах.
9. **Identity guard** — `FORBIDDEN_IN_NORMAL_UI` расширен; `macro-inc` добавлен.

## Осознанно сохранено (лицензии, история, совместимость, интеграции)

| Категория | Примеры | Причина |
|---|---|---|
| Лицензии и атрибуция | `LICENSE`, `NOTICE` («Craft Docs Ltd.»), `TRADEMARK.md`, `notices/THIRD-PARTY-NOTICES.txt`, строка «derived from» в `README`, upstream issue-ссылки в комментариях | юридические требования и происхождение; политика репозитория |
| Исторические доказательства | `docs/final-readiness/**`, `docs/evidence/**`, `docs/cloud-*-evidence-*/**`, `docs/september-program/**`, `plans/**`, `.github-archive/**`, `.i18n-work/**`, старые release notes | перезапись исказила бы зафиксированные SHA-манифесты и историю |
| Вендорный контент | `apps/electron/resources/skills/**` (сторонние скиллы и их лицензии) | upstream-текст, не наш бренд |
| Зарегистрированные алиасы | `com.lukilabs.craft-agent`, `craftagents://` (парсеры), `.craft-agent`, `CRAFT_*` (чтение), bin `craft-cli`, `DOC_BASE_URL` (`thecraftagents.com/docs` — живой; `docs.rox.one` не существует) | совместимость до 2027-03-01 |
| Внешний продукт | `craft.do` / `Craft Connect` / «Craft space» (источник), `conation.dev` (внешний оператор) | имена сторонних сервисов, не наш бренд |
| Интеграции | Infisical API/`INFISICAL_*`/каналы `fabric:infisical*`/id `'infisical'`/код `INFISICAL_UNAVAILABLE`; SiYuan kernel REST API (`/api/...`), иды `siyuan-plugin`, `siyuan-cloud|local`, ключ `source_apikey::<ws>::siyuan`, имя бинаря OEM-ядра; `OMP_*`/`PI_*` env и коды ошибок рантайма | протоколы и контракты внешних/пиннутых компонентов |
| Живые пайплайны | `scripts/macro-integration/**`, `tests/macro-integration/**` (в CI), интеграция Conation (feature-flags выключены) | решение владельца: удалять целиком или оставлять |

## Остаток к глубокой миграции (следующий PR)

Persisted-идентификаторы; каждый пункт требует канонического нового имени +
чтения legacy + тестов:

- `providerType: 'omp'` в `llmConnections` (`packages/shared/src/config/llm-connections.ts`, `validators.ts`, `storage.ts`).
- Каталоги сессий `sessions/<id>/omp/` и `meta/omp-turn-anchors.json` (`packages/shared/src/agent/omp-agent.ts`, `SessionManager`).
- Идентификатор инструмента toolchain `omp` и managed-каталог `.rox/toolchain/omp` (`packages/shared/src/toolchain/*`).
- Источник скиллов `source: 'omp'` и чтение `~/.omp/agent/skills`, `{ws}/.omp/skills`.
- DB/protocol значения: `runtime:'omp'`, `agenticMode:'omp'`, `clockDomain:'omp'`, `sourceId:'omp:*'`, `ToolStatus.name:'omp'`.
- RPC-каналы `siyuan.*` и `fabric:infisical*`; провайдер секретов `'infisical'`.
- Имена классов/файлов: `OmpAgent`, `omp-*.ts`, `SiyuanKernelClient`, `providers/siyuan/**`, `infisical-provider.ts`, модули `conation/**`; ключи UI `menu.*CraftAgents`, `security.finding.sourceCraft`, `extensions.runtime.craft-native|craft-sandbox`, `extensions.runtime.siyuan-plugin`.
- Инженерные доки `docs/omp-rpc-notes.md`, `docs/omp-integration-gap.md`.

## Проверки (выполнены локально)

| Проверка | Результат |
|---|---|
| `bun run scripts/check-config-paths.ts` | чисто (в этом изменении исправлена одна собственная находка гейта) |
| `lint-baseline.ts --check` (ESLint ratchet) | OK — нет новых нарушений, на 118 меньше базлайна |
| Terminology linter (`terms.ts`) | 10/10 зелёных; на main было 275 нарушений, сейчас 0 |
| `packages/shared` `tsc --noEmit` | 0 ошибок |
| i18n-сьюты (90 файлов) + docs-placeholder + config-сьюты | зелёные |
| CLI-сьюта | 110 pass / 2 fail — те же 2 падают на чистом main; здесь +1 новый проходящий тест |
| `typecheck:all` | все шаги прошли; шаг `workspace-service` падает **идентично** на чистом main (7c4a0c85f) — пре-существующая краснота |
| Браузерные фикстуры и Radix-тесты (A/B, одинаковые свежие `node_modules`) | `kernel-availability.browser` 5 fail / `AppearanceSettingsPage` 3 fail — **идентично на main** |
| Агентные `omp-*` интеграционные тесты | падают по таймауту (внутренние дедлайны 5 с против 30–150 с при нагрузке); точечный A/B затронутого теста падает так же на main |
| Сборка рендерера + скан бандла | `Infisical`/`SiYuan`/`lukilabs`/`craft-agents-oss` в бандле — только интеграционные привязки (см. ниже); `Rox CLI` — 73 вхождения |
| Browser-target сборка `doc-links` | 0 ссылок на `node:fs` (модуль снова import-free) |

Bundle-остатки, подтверждённые как привязки: манифест toolchain для Infisical CLI (`github.com/Infisical/cli`, `app.infisical.com`), npm-URL пиннутого рантайма `@oh-my-pi/pi-coding-agent@18.4.12`, provider-ids `siyuan-cloud`/`siyuan-local`, deep-links `conation.dev`, коды ошибок и env внешнего рантайма.