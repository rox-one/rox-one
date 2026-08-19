# OMP ⇄ Craft Agents — gap analysis (v1 shipped → full integration)

Статус на 2026-08-06, форк `agisota/craft-agents-oss`. **Обновлено 2026-08-12: v2 (G1–G4) смержен в `main` — см. «Закрыто в v2»; список «Остаток до „полного"» ниже закрыт пунктами 1–4 и оставлен как историческая запись.**
OMP runtime: локальный CLI `omp` v17.2.9 (`@oh-my-pi/pi-coding-agent`; toolchain ставит 17.2.10 — контракт идентичен, см. [omp-rpc-notes.md](omp-rpc-notes.md)), транспорт `--mode rpc` (NDJSON/stdio), контракт: [omp-rpc-notes.md](omp-rpc-notes.md).

## Матрица возможностей

| Область | Craft capability | OMP capability | v1 (статус) | Full |
|---|---|---|---|---|
| **Turn engine** | сессии, статусы, дельты в UI | агент-loop с моделями, thinking, tools | ✅ полный стрим text/tool/turn + usage | ✅ |
| **Permission** | modes safe/ask/allow-all, UI-диалоги | approval-mode always-ask/write/yolo | ✅ allow-all ⇄ `--approval-mode yolo`; ask/safe → диалоги в craft | ✅ |
| **Steering** | mid-stream redirect | `steer`/`follow_up` rpc | ✅ `redirect()` → steer | ✅ |
| **Models** | LlmConnections, tiers, picker | реестр OMP (~/.omp/agent) | ✅ fuzzy-map default model → set_model {provider,modelId} | ✅ |
| **Thinking** | thinking levels UI | reasoning streams | ⚠️ уровни мапятся; thinking-дельты НЕ показываются (в `AgentEvent` нет типов) | расширить AgentEvent: `thinking_delta` |
| **Craft tools** | spawn_session, call_llm, browser_tool, session MCP tools, source proxies | OMP host-tools (`set_host_tools`/`host_tool_call`) | 🟡 мост реализован (session tools через set_host_tools); **MCP source proxies не прокинуты** | прокинуть mcpPool defs |
| **Skills (OMP)** | craft skills/vault | OMP skills (~/.omp, skills CLI) | ⚠️ craft не знает про них, они «слепая зона» в UI | синк реестра в craft skills UI |
| **Сессии** | craft владелец истории | OMP session store per cwd | ✅ изоляция + зеркало: `--session-dir <craft session>/omp` (без --no-session) | ✅ (resume из OMP store — не делаем) |
| **Branching** | sdk-fork ветки | `branch {entryId}` rpc | ❌ supportsBranching=false | реализовать через branch rpc |
| **Compaction** | auto-compact UI event | auto_compaction events | ✅ статус-ивенты | ✅ |
| **Mini-completion** | title-gen, summarization | `omp -p` | ✅ runMiniCompletion/queryLlm | ✅ |
| **Runtime context** | — | AGENTS.md / system prompt | ✅ `--append-system-prompt` с контекстом «OMP работает внутри Craft Agents» | расширение гайда в воркспейсе |
| **Onboarding** | ProviderSelect wizard | pre-configured locally | ✅ пресет «OMP (oh-my-pi)» (providerType omp, authType none, прямой скип в complete) | ✅ |
| **Auto tags/статусы** | labels, session statuses, automations (scheduled/event) | — | ⚠️ OMP-сессии участвуют в общей шине, нет авто-правил «OMP-сессии получают тег» | правило: default label для omp-провайдера |
| **Квоты/метрики** | usage к поводырям в UI | cost per turn | ✅ usage мапится (input/output/cache/cost) | ✅ |

## Закрыто в v2 (коммиты d01981c6f, 1dc41d014, 4035a02c5)
- ✅ G4 skills sync: discovery ~/.omp/agent/skills + ~/.agents/skills + workspace .omp/skills; секция «НАВЫКИ OMP» в панели + бейдж + «Экспорт в craft skills» (skills:importOmp RPC); активация @-mention через extractSkillPaths.
- ✅ G2 thinking: thinking_delta/thinking_complete end-to-end, карточка «Рассуждение» (отдельная), свёртка по complete.
- ✅ G1 MCP source proxies: buildSessionToolDefs (registry + pool) → set_host_tools; pool dispatch перед registry; e2e пройдено (stub-источник).
- ✅ G3 branching: omp-turn-anchor sidecar, ensureBranchReady preflight, fork (mid-history switch_session+branch, tail transcript-copy), supportsBranching.
- ✅ PRD §9 закрыт: thinking отдельной карточкой, skills export, прокси-неймспейс mcp__<source>__*.

## Остаток до «полного» (приоритет)

> **Закрыто в v2 — раздел оставлен как историческая запись.** Пункты 1–4 реализованы и смержены в `main` (см. «Закрыто в v2» выше; детали и file-refs — в `AGENTS.md` §OMP и `plans/integration-audit.md` §3.1/§4.2):
1. ~~**MCP source proxies в OMP**~~ — закрыто в v2 (G1): `registerHostTools()` использует `buildSessionToolDefs({ includePoolProxyDefs: true })`, pool-dispatch идёт перед session-registry (`executeHostSessionTool`).
2. ~~**AgentEvent.thinking_delta**~~ — закрыто в v2 (G2): `thinking_delta`/`thinking_complete` end-to-end, карточка «Рассуждение».
3. ~~**Branching**~~ — закрыто в v2 (G3): `ensureBranchReady()` + `applyOmpBranchHandshake()` (`switch_session` + `branch {entryId}` / tail transcript-copy), sidecar `meta/omp-turn-anchors.json`.
4. ~~**OMP skills → craft skills UI синк**~~ — закрыто в v2 (G4): `skills/omp-discovery.ts`, секция «НАВЫКИ OMP», RPC `skills:importOmp`.
5. **Авто-тегирование OMP-сессий** — покрыто мостом и event-bus автоматизациями (set_session_labels tool); опционально: дефолт-лейбл для omp-провайдера.

## Архитектура v1 (что зашито)
```
LlmConnection(providerType:'omp', authType:'none')
  → createBackend('omp') → OmpAgent (BaseAgent)
      spawn: omp --mode rpc --session-dir <ws>/sessions/<id>/omp [--approval-mode yolo]
      chat: prompt → events → AgentEvent (text/tool/complete/error/usage)
      tools: set_host_tools [session tools] → host_tool_call → craft executor → host_tool_result
      perms: extension_ui_request ⇄ craft permission flow; yolo при allow-all
      ctx: --append-system-prompt OMP_CRAFT_CONTEXT_PROMPT
```
