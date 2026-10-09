# ADR-0020: Ревизия выбора инструментов Developer Space (D4)

- **ID:** `RX-ADR-0020`
- **Status:** Accepted
- **Date:** 2026-10-09
- **Branch:** `feat/devspace-w2`
- **Spec:** [03-SPEC-features §1](../../specs/2026-10-09-dev-space-and-playbooks/03-SPEC-features.md), [05-PLAN §В2](../../specs/2026-10-09-dev-space-and-playbooks/05-PLAN.md), [07-DECISIONS §D4](../../specs/2026-10-09-dev-space-and-playbooks/07-DECISIONS.md)
- **Audit:** [audits/d4-tools-revision-2026-10-09.md](../../specs/2026-10-09-dev-space-and-playbooks/audits/d4-tools-revision-2026-10-09.md)
- **Refs:** `RX-SPC-0025`, `RX-FEA-0034`

RFC 2119: MUST / MUST NOT / SHOULD / MAY.

## Context

Developer Space строит артефакты анализа репозитория шестью инструментами (D4, 00-BRIEF §3–§4). Существующий
контракт code-intelligence закреплён ревизией `CI-DEC-EXTEND-EXISTING-01`
(`packages/shared/src/code-intelligence/provider.ts:16`), при этом:

- каталог capabilities (`packages/shared/src/capabilities/packs.ts:92-139`) объявляет
  `codewiki`/`deepwiki`/`understand-anything`/`codegraph`/`graphify`/`archify` как «available» с
  placeholder-репозиториями `sourceRepo: 'example/*'` и неверными лицензиями (`understand-anything`
  помечен `Apache-2.0`, реально MIT; `graphify` помечен `MIT`, реально Apache-2.0) — гэп
  `CI-G-08 CURRENT_SOURCE_CONFLICT`;
- контракт отвергает `Graphify`/`Archify` (`packages/shared/src/code-intelligence/types.ts:60-65`,
  `unmaintained-duplicate-graph`), что опровергнуто текущей активностью проектов;
- каталог MCP уже содержит `codegraph` = CodeGraphContext uvx `0.6.13`
  (`packages/shared/src/sources/builtin-mcp.ts:73-82`), а `openwiki`/`groma` отсутствуют.

Требуется новая ревизия решения поверх `CI-DEC-EXTEND-EXISTING-01` с протоколом свежего аудита.
Протокол `D4-AUDIT-2026-10-09` собран по первичным источникам (GitHub API / npm / PyPI) и определил
`O1`/`O2`/`O7`.

## Decision

**Приняты шесть инструментов, «одна операция — один инструмент», `alwaysOn=false`, без демонов.**
Провайдеры запускаются строго по операции, регистрируются, но не запускаются декларацией (инвариант
`provider.ts`); активация — только через `ProviderRequestContext.enabled` + `allowedProviderIds`.

1. **Реестр адаптеров (операция → инструмент → артефакт):**

| Операция | Инструмент | kind артефакта |
|---|---|---|
| `repo-wiki` | `langchain-ai/openwiki` (npm `openwiki@0.7.1`) | `wiki` |
| `learning` | `Egonex-AI/Understand-Anything` (вендор. skill `@1d7418b8…`) | `understanding` |
| `symbols`, `search`, `source-graph` | **`CodeGraphContext`** (`codegraphcontext==0.6.13`) | `code-graph` |
| `diagram` | `tt-a1i/archify` (`v3.0.1`) | `diagram` |
| `knowledge-graph` | `Graphify-Labs/graphify` (`v0.9.82`) | `knowledge-graph` |
| `c4` | `MrLesk/Groma.md` (npm `groma.md@0.6.6`) | `c4` |

2. **`O1` — канонический codegraph-провайдер = `CodeGraphContext/CodeGraphContext`** (`codegraphcontext==0.6.13`,
   embedded LadybugDB). `@colbymchenry/codegraph` (ColbyMcHenry, `v1.6.2`) MUST NOT использоваться как
   провайдер конвейера: его auto-sync watcher и анонимная телеметрия включены по умолчанию и конфликтуют
   с инвариантами «без демонов» (D4) и `dataEgress: deny` (D6); дополнительно он создал бы дубль уже
   вендоренного `codegraph`. Резервный кандидат — ColbyMcHenry в CLI-режиме по-операции с
   `CODEGRAPH_TELEMETRY=0` и отключённым watcher (только отдельной ревизией).

3. **`O2` — groma↔archify MUST NOT схлопываться.** Операции `c4` (Groma: диффабельный C4-источник в
   OKF-markdown, без AI) и `diagram` (archify: IR → HTML/SVG/PNG) имеют невзаимозаменяемые выходы и
   разные `kind`-артефакты; сохраняются обе.

4. **`O7` — пины/лицензии зафиксированы на 2026-10-09** (таблица в протоколе §2.3):
   openwiki `0.7.1` MIT; Understand-Anything `@1d7418b8` MIT; CodeGraphContext `0.6.13` MIT;
   archify `3.0.1` MIT; graphify `0.9.82` **Apache-2.0**; Groma.md `0.6.6` MIT.

5. **Согласование `CI-G-08` (список правок, реализация — В2):** `packs.ts` — реальные `sourceRepo`,
   исправленные лицензии (`understand-anything`→MIT, `graphify`→Apache-2.0), добавление `openwiki`/`groma`,
   перевод `codewiki`/`deepwiki` в статус rejected, реальные `version`/`gitRef`;
   `types.ts:60-65` — снять rejection `Graphify`/`Archify` (оставить `CodeWiki`/`DeepWiki`);
   `provider.ts:16-17,50` — бамп ревизии до **`CI-DEC-EXTEND-EXISTING-02`** + значения операций
   `learning`/`knowledge-graph`;
   `builtin-mcp.ts:73-82` — сохранить `codegraph` = CodeGraphContext; `builtin-mcp.ts:34-39` — вывести
   remote-MCP `deepwiki` из дефолтного каталога (D5/D6).

6. **Правила реестра сохраняются:** не-базовые провайдеры MUST нести `sourceRevision` + `artifactDigest`
   (`unverified-provider-manifest`); remote-провайдеры требуют `binding.policy.dataEgress === 'allow'`.

## Rejected alternatives

| Вариант | Почему нет |
|---|---|
| Канонический codegraph = `@colbymchenry/codegraph` | auto-sync watcher (D4 «без демонов») и телеметрия (D6 эгресс) включены по умолчанию; дубль уже вендоренного `codegraph`; коллизия slug. |
| Схлопнуть `c4`↔`diagram` в один инструмент | Невзаимозаменяемые выходы: OKF-markdown C4 vs SVG/PNG; потеря каждой из возможностей. |
| Сохранить `Graphify`/`Archify` отвергнутыми (`unmaintained-duplicate-graph`) | Опровергнуто текущей активностью (push 2026-10-09; релизы graphify `v0.9.82`, archify `v3.0.1`). |
| Оставить remote-MCP `deepwiki` в каталоге | Нарушает D5 (deepwiki не берём) и D6 (эгресс по умолчанию). |
| Перенести правки placeholders «попутно» | Placeholder-пины противоречат реальным; ревизия фиксирует канон отдельным решением. |

## Consequences

- Протокол аудита `D4-AUDIT-2026-10-09` — обязательное доказательное приложение; решения `O1`/`O2`/`O7`
  однозначны и воспроизводимы по первичным источникам.
- Рассинхрон пинов брифа зафиксирован (openwiki `v0.6.1→0.7.1`, Groma `v0.6.0→0.6.6`); перепин —
  задача реализации В2.
- Инварианты D4/D6 соблюдены без «нейтрализации дефолтов» стороннего инструмента: выбран daemon-free и
  egress-free провайдер, уже представленный в каталоге (минимум нового кода, «без дублей»).
- **Fallback O1:** при доказанной недостаточности графовой БД CGC для `symbols`/`search`/`source-graph`
  резерв — ColbyMcHenry в CLI-режиме с отключёнными watcher/телеметрией, оформляется отдельной ревизией.
- Правки кода §Decision-5 — не в этом срезе; их отсутствие блокирует финализацию реестра адаптеров В2.