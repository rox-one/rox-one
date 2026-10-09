# Протокол ревизии выбора инструментов D4 (Developer Space)

- **Идентификатор:** `D4-AUDIT-2026-10-09`
- **Дата среза:** 2026-10-09 (capture ~09:30 UTC)
- **Ветка:** `feat/devspace-w2` (worktree В2)
- **Основание:** `00-BRIEF.md` §3–§4/§6 (D4/D5, O1–O8), `03-SPEC-features.md` §1.2, `05-PLAN.md` §В2, `07-DECISIONS.md` D4/P1
- **Результат:** решения `O1`, `O2`, `O7` + карта гэпа `CI-G-08 CURRENT_SOURCE_CONFLICT`; материал для `RX-ADR-0020`
- **Метод:** первичные источники — GitHub REST API (`/repos`, `/releases/latest`, `/tags`, `/commits`), npm registry (`registry.npmjs.org`), PyPI JSON API (`pypi.org/pypi/<name>/json`), README upstream. Ссылки на коммиты-пины приведены 40-hex.

> Обязательность протокола следует из D4 (07-DECISIONS §D4): «новая ревизия решения … с протоколом свежего аудита».

---

## 1. Свежий веб-аудит шести инструментов (+ второй кандидат O1)

### 1.1 Сводная таблица

| # | Инструмент | Репозиторий | Лицензия | Последний релиз / версия | Дата релиза | Активность (push) | Стек | Ключевые возможности |
|---|---|---|---|---|---|---|---|---|
| 1 | **openwiki** (wiki) | `langchain-ai/openwiki` | MIT | `v0.7.1` (tag) / npm `openwiki@0.7.1` | 2026-10-06 | 2026-10-09 | TypeScript, Node ≥ 22.22; CLI + MCP (`openwiki_search/read/list_workspaces/list_wikis` + generation flow) | Связанная Markdown-вики с evidence-grounding, Mermaid, визуализатор, **OKF v0.2** output, wikilink-воркспейсы, resumable updates |
| 2 | **Understand-Anything** (понимание/туры) | `Egonex-AI/Understand-Anything` | MIT | `v2.9.0` | 2026-07-10 | 2026-10-09 | TypeScript, multi-agent skill; Claude Code/Codex/Cursor/… | Интерактивный knowledge-graph, `.ua/knowledge-graph.json`, dashboard, обучающие туры |
| 3 | **codegraph** (граф кода) | `colbymchenry/codegraph` (≡ `ColbyMcHenry/codegraph`) | MIT | `v1.6.2` / npm `@colbymchenry/codegraph@1.6.2` | 2026-10-03 | 2026-10-07 | Rust-ядро (`codegraph-kernel`) + bundled Node-рантайм, без внешних зависимостей; self-contained бинарь | Pre-indexed code KG, `codegraph init`, **auto-sync watcher (по умолчанию ВКЛ)**, SQLite `.codegraph/codegraph.db`, MCP `codegraph serve --mcp` (один tool `codegraph_explore`), **телеметрия по умолчанию ВКЛ** (`DO_NOT_TRACK` / `CODEGRAPH_TELEMETRY=0` для off) |
| 4 | **CodeGraphContext (CGC)** — второй кандидат O1 | `CodeGraphContext/CodeGraphContext` | MIT | PyPI `codegraphcontext==0.6.13` (GH release отстаёт: `v0.5.7`) | 0.6.13 — 2026-09-06; GH `v0.5.7` — 2026-08-08 | 2026-09-29 | Python ≥ 3.10, tree-sitter (+опц. SCIP); CLI + MCP; графовая БД (KuzuDB/LadybugDB embedded, FalkorDB Lite, Neo4j) | Локальная индексация в графовую БД, embedded zero-config по умолчанию, Windows-native, `codegraphcontext mcp start` |
| 5 | **archify** (схемы) | `tt-a1i/archify` | MIT | `v3.0.1` | 2026-09-28 | 2026-10-09 | JavaScript, agent-skill (Claude Code/Codex/Cursor/OpenCode) | Типизированный IR → интерактивный HTML/SVG, PNG export; от идеи/плана/кода до диаграммы |
| 6 | **graphify** (knowledge-graph) | `Graphify-Labs/graphify` | **Apache-2.0** | `v0.9.82` (последний *release*); tag `v1.0.0` существует, но релизом не опубликован; pip `graphifyy` | 2026-10-09 | 2026-10-09 | Python, tree-sitter, локальный детерминированный AST-парсинг | `/graphify` skill; `graphify-out/{graph.html,GRAPH_REPORT.md,graph.json}`; EXTRACTED/INFERRED рёбра; без vector store; MCP |
| 7 | **Groma.md** (C4/OKF) | `MrLesk/groma.md` | MIT | `v0.6.6` / npm `groma.md@0.6.6` | 2026-10-05 | 2026-10-09 | TypeScript, CLI + skill; генерация **без AI** | Архитектура как **OKF Markdown в Git** + одна C4-карта (static export HTML); `groma/` markdown |

**Ссылки (литеры):** GitHub API `https://api.github.com/repos/<owner>/<repo>` (+ `/releases/latest`, `/tags`, `/commits/<tag>`), npm `https://registry.npmjs.org/<pkg>`, PyPI `https://pypi.org/pypi/<name>/json`.

### 1.2 Явные расхождения с пинами брифа (вход для O7)

| Позиция брифа/спеки | Значение в спеке | Проверено на 2026-10-09 | Вывод |
|---|---|---|---|
| openwiki | `v0.6.1`, MIT, `fab24e77…` | tag `v0.6.1` = `86f46f8c98b9…`; актуальный релиз `v0.7.1`; npm `openwiki@0.6.1` публикуется **без `gitHead`** | Пин `fab24e77` **не подтверждён**; рекомендуется перепин на `v0.7.1` |
| Groma.md | `v0.6.0`, MIT, `46b1572d…` | tag `v0.6.0` = `e50ddbc49c5f…`; npm `groma.md@0.6.0` gitHead = `e50ddbc4…`; актуальный `v0.6.6` | Пин `46b1572d` **не совпадает** с тегом/arcnpm; рекомендуется перепин на `v0.6.6` |
| codegraph стек | «Rust+TS CLI» | GitHub `language: C`, но `codegraph-kernel` + README: «Kernel powered by Rust», bundled Node | Стек = Rust-ядро + встроенный Node; C-статистика — вендоренные tree-sitter-грамматики |
| Understand-Anything пин | `@1d7418b8` | Вендоренный `SKILLS.lock` = `1d7418b8abfa543744ae029e63a482aee03f9022`; upstream HEAD = `ffa2f0a84a85` | Вендоренный пин совпадает с lock; upstream ушёл вперёд (v2.9.0) |
| graphify релиз | — | посл. release `v0.9.82`; tag `v1.0.0` (`0a31c08…`) — **без release**, ветка по умолчанию `v8` | Пинить `v0.9.82`; `v1.0.0` не брать до публикации релиза |

### 1.3 Отношение к уже вендоренным артефактам в репозитории

| Инструмент | Артефакт в репо | Путь / пин |
|---|---|---|
| Understand-Anything | ✅ вендоренный skill-пак | `apps/electron/resources/skills/understand-anything/**` (skills `understand`, `understand-chat`, `understand-dashboard`, `understand-diff`, `understand-domain`, `understand-explain`, `understand-figma`, `understand-knowledge`, `understand-onboard`); `SKILLS.lock:3367-3376`, `commit 1d7418b8abfa…`, MIT |
| graphify | ✅ вендоренный адаптер (внутри gstack) | `apps/electron/resources/skills/gstack/gstack/lib/code-intelligence/graphify-adapter.ts` (`SKILLS.lock:1782`); адаптер верифицирован против **graphify 0.9.23**; статус-чтение bounded ≤5 MiB |
| Groma.md | ✅ ROX-адаптер skill (не upstream-vendor целиком) | `apps/electron/resources/skills/rox-integrations/groma/**`; upstream ref `MrLesk/Groma.md@50bb1581e7a45903aeb2715102a77c1148a2984d` (`docs/agent-instructions`), MIT (`SKILLS.lock:3301-3318`) |
| codegraph (CGC) | ✅ каталог builtin-MCP | `packages/shared/src/sources/builtin-mcp.ts:73-82`, slug `codegraph`, `codegraphcontext==0.6.13`, env `CGC_RUNTIME_DB_TYPE=ladybugdb` |
| openwiki | ❌ отсутствует | ни вендоренного skill, ни MCP-каталога, ни `packs.ts` |
| archify | ❌ отсутствует | ни skill, ни MCP-каталога (только `packs.ts`, см. §3) |
| codegraph (ColbyMcHenry) | ❌ отсутствует | ни skill, ни MCP-каталога |

---

## 2. Решения O1 / O2 / O7

### 2.1 O1 — канонический codegraph-провайдер

**Вердикт: канонический провайдер id `codegraph` = `CodeGraphContext/CodeGraphContext`, пин `codegraphcontext==0.6.13` (embedded LadybugDB). `@colbymchenry/codegraph` (ColbyMcHenry) — отвергнут как провайдер конвейера Developer Space.**

Обоснование (сопоставление по жёстким инвариантам D4/D6 и правилу «без дублей» P1):

| Критерий | CodeGraphContext 0.6.13 | ColbyMcHenry/codegraph 1.6.2 |
|---|---|---|
| «без демонов» (D4, PRD) | ✅ индексация по запросу, без фоновых процессов | ⚠️ **auto-sync watcher включён по умолчанию** — фоновое отслеживание файлов; требует явного отключения |
| `dataEgress: deny` по умолчанию (D6) | ✅ телеметрии/эгресса нет | ⚠️ **анонимная телеметрия включена по умолчанию**; требует `DO_NOT_TRACK=1`/`CODEGRAPH_TELEMETRY=0` |
| Отсутствие дублей / минимум нового кода (P1; уже вендорено) | ✅ **уже** каталогизирован как builtin-MCP `codegraph` с пином 0.6.13 | ❌ интеграция с нуля + коллизия по имени slug `codegraph` |
| Платформы macOS + Windows (D14) | ✅ Windows-native явно заявлен (embedded KuzuDB/LadybugDB) | ✅ Windows/macOS/Linux |
| Локальность | ✅ embedded БД на диске, zero-config | ✅ 100 % локально, self-contained |
| Активность/поддержка | push 2026-09-29; PyPI 0.6.13 2026-09-06 | push 2026-10-07; v1.6.2 2026-10-03 |
| Артефакт | графовая БД (LadybugDB/KuzuDB) | `.codegraph/codegraph.db` (SQLite FTS5) |
| Runtime-предпосылки | uv + Python ≥ 3.10 (uv уже используется другими записями каталога) | собственный Rust-бинарь + bundled Node — внешних рантаймов нет |

**Почему не ColbyMcHenry.** Два его *поведения по умолчанию* — фоновый auto-sync watcher и анонимная телеметрия — прямо конфликтуют с жёсткими инвариантами D4 («без демонов») и D6 (эгресс отсутствует по умолчанию). Оба обходимы конфигурацией, но проектный принцип — не брать инструмент, требующий нейтрализации его же дефолтов, чтобы соответствовать инвариантам. Дополнительно выбор ColbyMcHenry создал бы второго «графового» провайдера в продукте при уже существующем `codegraph` (дубль), а также коллизию slug. CGC выигрывает по (1) инвариантам, (3) «без дублей/минимум кода», (4) Windows-native.

**Fallback.** Если на этапе реализации графовая БД CGC окажется недостаточной для операций `symbols`/`search`/`source-graph` (глубина вызовов/blast-radius), резервный кандидат — `@colbymchenry/codegraph@1.6.2` в CLI-режиме по-операции (`codegraph init`/`query`) с обязательным `CODEGRAPH_TELEMETRY=0` и отключённым watcher. Решение о замене — отдельной ревизией.

### 2.2 O2 — схлопывать ли groma↔archify по диаграммам

**Вердикт: НЕ схлопывать. Обе операции остаются раздельными — `c4` (Groma.md) и `diagram` (archify).**

Обоснование:

| Признак | Groma.md | archify |
|---|---|---|
| Тип артефакта | **Markdown OKF 0.2** (C4-модель), source-of-truth в Git | типизированный IR → **HTML/SVG**, PNG export |
| Роль | авторство/хранение C4-архитектуры (диффабельно, без AI) | генератор визуальных диаграмм из любых артефактов (call-graph, sequence, flow) |
| `kind` артефакта (02 §7) | `c4` | `diagram` |
| Взаимозаменяемость | ❌ Markdown ≠ вектор/растр | ❌ SVG/PNG ≠ диффабельный C4-текст |
| Уникальность | диффабельный C4-источник в Git | рендер из внешних артефактов (в т.ч. call-graph) |

Выходы не взаимозаменяемы: схлопывание потеряло бы либо диффабельный C4-источник (groma), либо возможность рендерить диаграммы из внешних артефактов (archify). Единственная частичная коллизия — *static HTML export* Groma против интерактивного HTML archify; это визуальное пересечение, но не коллизия контракта артефакта. Вывод — оставить обе операции.

**Ремарка (не O2, к сведению).** openwiki также отдаёт **OKF v0.2** — возможное пересечение формата openwiki↔groma (`wiki` vs `c4`). Это отдельный открытый вопрос, в рамках D4/O2 не схлопывается (разные роли: repo-wiki vs C4-карта).

### 2.3 O7 — пины/лицензии на момент старта В2 (2026-10-09)

| Инструмент | Лицензия (проверена) | Пин (версия) | Пин (commit 40-hex) | Канал доставки |
|---|---|---|---|---|
| openwiki | MIT | `0.7.1` (было 0.6.1) | `0db6dcf0ca16e81c93ff1125312be0ad6f70df6a` (tag `v0.7.1`) | npm `openwiki@0.7.1`, Node ≥ 22.22 |
| Understand-Anything | MIT | skill, вендор. пин `1d7418b8…` | `1d7418b8abfa543744ae029e63a482aee03f9022` (vendored); upstream HEAD `ffa2f0a84a85` | вендоренный skill `apps/electron/resources/skills/understand-anything/**` |
| codegraph (**canonical O1**) | MIT | `0.6.13` | пин по версии PyPI (`codegraphcontext==0.6.13`); GH-состояние `v0.5.7` отстаёт | uvx `codegraphcontext==0.6.13` (builtin-MCP) |
| archify | MIT | `3.0.1` | `bb990b17b886` (HEAD 2026-10-08; tag `v3.0.1` = 2026-09-28) | agent-skill |
| graphify | **Apache-2.0** (было «MIT» в `packs.ts`) | `0.9.82` | `5b74d7d74911cf435c8f1636b6f96ea202cc6246` (tag `v0.9.82`) | pip `graphifyy`; вендор. адаптер gstack |
| Groma.md | MIT | `0.6.6` (было 0.6.0) | `9c5b6adc8e1d192198809d0566f596fe4da92d69` (tag `v0.6.6`) | npm `groma.md@0.6.6` |
| ColbyMcHenry/codegraph (отвергнут O1) | MIT | `1.6.2` | `6560052a6f856855d3f71eee838fd66ccfa4285d` (tag `v1.6.2`) | npm `@colbymchenry/codegraph@1.6.2` (fallback) |

Все шесть инструментов — `alwaysOn=false`, запускаются по операции, без демонов (D4).

---

## 3. Карта гэпа `CI-G-08 CURRENT_SOURCE_CONFLICT` (точные пути/строки + список правок)

Гэп: каталог capabilities объявляет code-intel инструменты «available» с placeholder-репозиториями и неверными лицензиями, а контракт code-intelligence отвергает часть из них — источники противоречат друг другу.

### 3.1 `packages/shared/src/capabilities/packs.ts`

- `CAPABILITY_TOOLS` начинается на **строке 91**. Placeholder-записи (блок **92–139**):
  - `92–99` — `codewiki` (**отвергнут**, `CI-DEC`-режим): `license: 'MIT'`, `version: '0.1.0'`, `sourceRepo: 'example/codewiki'`.
  - `100–107` — `deepwiki` (**отвергнут**): `sourceRepo: 'example/deepwiki'`.
  - `108–115` — `understand-anything`: **неверная лицензия `'Apache-2.0'`** (реально MIT), `sourceRepo: 'example/understand-anything'`.
  - `116–123` — `codegraph`: `sourceRepo: 'example/codegraph'`.
  - `124–131` — `graphify`: **неверная лицензия `'MIT'`** (реально Apache-2.0), `sourceRepo: 'example/graphify'`.
  - `132–139` — `archify`: `sourceRepo: 'example/archify'`.
- `gitRef`/`checksum` (хелперы **46–52**) синтетические `sha1(id@version)`/`sha256(id@version)`, а не реальные upstream-пины; `version: '0.1.0'` у всех.
- `openwiki` и `groma` **отсутствуют** в `CAPABILITY_TOOLS`.

**Правки (не в этом срезе):**
1. Заменить `sourceRepo` реальными адресами: `langchain-ai/openwiki`, `Egonex-AI/Understand-Anything`, `CodeGraphContext/CodeGraphContext` (canonical O1), `tt-a1i/archify`, `Graphify-Labs/graphify`, `MrLesk/groma.md`.
2. Исправить лицензии: `understand-anything` → `MIT`; `graphify` → `Apache-2.0`.
3. Добавить записи `openwiki` и `groma`.
4. Привести `codewiki`/`deepwiki` в соответствие статусу `REJECTED_CODE_INTEL_TOOLS`.
5. Выставить реальные `version`/`gitRef` из §2.3 (O7).

### 3.2 `packages/shared/src/code-intelligence/types.ts`

- `REJECTED_CODE_INTEL_TOOLS` — блок **60–65** (`export const` на 60):
  - `61` — `{ name: 'CodeWiki', reason: 'duplicate-wiki-daemon' }` — **оставить**.
  - `62` — `{ name: 'DeepWiki', reason: 'duplicate-wiki-daemon' }` — **оставить** (D5: deepwiki-open не берём).
  - `63` — `{ name: 'Graphify', reason: 'unmaintained-duplicate-graph' }` — **снять** (опровергнуто активностью: `v0.9.82` 2026-10-09).
  - `64` — `{ name: 'Archify', reason: 'unmaintained-duplicate-graph' }` — **снять**.
- `SELECTED_CODE_INTEL` (строка **67**) = `['local-fs-symbols', 'syft-sbom']` — не расширяется этими инструментами (они — dev-space-провайдеры, не базовые).

### 3.3 `packages/shared/src/code-intelligence/provider.ts`

- `CODE_INTELLIGENCE_SELECTION_REVISION` — строка **16** (`'CI-DEC-EXTEND-EXISTING-01'`): **бампнуть** до новой ревизии.
- `CodeIntelligenceOperation` — строка **17**; `OPERATIONS` set — строка **50**: добавить значения **`'learning'`** и **`'knowledge-graph'`** (03 §1: `learning`=Understand-Anything, `knowledge-graph`=graphify).
- `isRejected()` — строки **56–57**: перестанет блокировать `graphify`/`archify` после снятия rejection в `types.ts` (код менять не нужно, только данные).

### 3.4 MCP-каталог `packages/shared/src/sources/builtin-mcp.ts`

- `73–82` — запись `slug: 'codegraph'`, `name: 'CodeGraphContext'`, `codegraphcontext==0.6.13` (embedded LadybugDB). При O1=CGC — **оставить**, синхронизировав имя/пин; при выборе ColbyMcHenry — перепривязать slug/репозиторий.
- `34–39` — `slug: 'deepwiki'` — **удалённый HTTP-MCP** (`https://mcp.deepwiki.com/mcp`): конфликт с D5 (deepwiki-open/агентный DeepWiki не берём) и D6 (эгресс). **К удалению/выводу из дефолтного каталога.**
- `152–153` — `BUILTIN_AGENT_SKILL_PACKS`: `understand-anything` уже присутствует ✅. Отсутствуют `openwiki`/`groma`/`archify`/`graphify` (при необходимости — добавить).

### 3.5 Прочие точки, требующие согласования

- Вендоренные артефакты (§1.3): `SKILLS.lock` — understand-anything (3367), graphify-adapter (1782), rox-integrations/groma (3301).
- `packages/shared/src/dev-space/__tests__/dev-space.test.ts:107` использует `providerId: 'openwiki'` — при интеграции сослаться на тот же id.
- Реестр: `registry/rx-registry.yaml` — `RX-ADR-0020` (planned) → `active` + `path` после написания ADR.

---

## 4. Что сделано этим срезом и что осталось

**Сделано:**
- Протокол аудита (этот файл) с точными датами/версиями/пинами/линками.
- Решения O1 (CGC canonical), O2 (не схлопывать), O7 (пины/лицензии §2.3) — однозначны.
- Карта `CI-G-08` с путями/строками и списком правок (§3).
- `RX-ADR-0020` (`docs/architecture/adr/0020-...md`) + перевод записи реестра в `active`.

**Осталось (следующие срезы/волны):**
- Правки кода по §3.1–3.4 (packs.ts, types.ts, provider.ts, builtin-mcp.ts) — задача этапа реализации В2.
- Рассинхрон пинов брифа (§1.2): перепин openwiki → `0.7.1`, Groma → `0.6.6`.
- Верификация runtime-эквивалентности CGC-графовой БД для операций `symbols`/`search`/`source-graph` (триггер fallback O1).
- Вывод remote-MCP `deepwiki` из дефолтного каталога (D5/D6).