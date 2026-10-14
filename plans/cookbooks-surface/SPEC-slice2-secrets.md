# SPEC — Срез 2: «Секретный мост» (кукбуки × креды ROX) + волна Q2A (Colab-микро)

База: origin/main `221bb13f+`. Ветка волны: `feature/cookbooks-secrets` (воркдерева `~/Projects/rox-worktrees/cookbooks-secrets`).
Норматив волн 6–7: [PRD](PRD.md) · [SPEC](SPEC.md) (+Amendment 1) · [ADR 001](decisions/001-runtime-container-and-secrets.md) §6 · [SPEC-wave7](SPEC-wave7-colab-ux.md).

## Срез 2 «Секретный мост» (E-sec2)

**Цель:** вендорские ключи реального пользователя попадают в ядро кукбуков — при этом значения НИКОГДА не покидают main-процесс и не пишутся на диск.

### Источник значений (заморожено)
- Маппинг lab-ключей — вендоренный `apps/electron/resources/cookbooks/resources/cookbooks/catalog.json` → `secretMap` (6 ключей: `openai.api_key`, `anthropic.api_key`, `pinecone.api_key`, `weaviate.api_key`, `langfuse.public_key`, `langfuse.secret_key` → env-имена). Чтение — через `getBundledAssetsDir()`.
- Резолвинг — канонический `resolveSecretsForSpawn(entries)` (`packages/shared/src/secrets/chain.ts:64-166`), `entries = [{ name: ENV, envVar: ENV }]`; чейн environment (`ROX_SECRET_<ENV>`) → local-encrypted (`service_oauth::global::<ENV>`) → infisical; порядок/денилисты не переопределять; функция не бросает (missing = `SECRET_NOT_FOUND`). Прецедент: `packages/server-core/src/handlers/rpc/cloud-runs.ts:164-168`.
- Пользовательский путь: Settings → «Секретные ссылки» добавить ref `name=OPENAI_API_KEY` (+ любое из остальных имён); либо `ROX_SECRET_OPENAI_API_KEY` в env. Ambient `OPENAI_API_KEY` НЕ читается (prefix-gate environment-провайдера). Отсутствующие ключи просто отсутствуют в сторе — лаборатория честно покажет «нет ключа».
- Правки снапшота лаборатории НЕ делать (в т.ч. устаревшие номера строк в `ELECTRON-CONTRACT.md` §5.1 — актуально: `host.py` `/store` L441-450).

### Транспорт (заморожено)
1. **`POST /store`** (замена in-memory стора сайдкара): (а) при переходе runtime в `running`; (б) перед каждым ответом `catalog` (свежие чипы/баннер).
2. **One-shot `store`** в payload `POST /run` и `POST /run-all` (самый свежий снимок на момент запуска; `host.py:277-280`, `:355-357` принимают оба).
3. Логи: печатается только массив КЛЮЧЕЙ; значения не логируются и не попадают ни в один IPC-ответ renderer.

### Изменения (E-sec2)
- `apps/electron/src/main/cookbooks-runtime.ts`:
  - `export type CookbooksStore = Record<string, string>`; опция `resolveStore?: () => Promise<CookbooksStore>` (default — `defaultCookbooksStore()`: читает каталог через `getBundledAssetsDir()`, резолвит через `resolveSecretsForSpawn`, мапит env→labKey; ошибки чтения каталога → пустой стор);
  - `pushStore()` — `POST /store {store}` при `running`; при `state !== running` — no-op; ошибки сети — тихо (log по ключам);
  - `apiCatalog()` = `pushStore()` (best-effort) → существующий request; при уходе в `running` (onReady) — тоже `pushStore()`;
  - `apiRun()`/`apiRunAll()` — добавляют `store: await resolveStore()` в payload.
- Тесты `apps/electron/src/main/__tests__/cookbooks-runtime.test.ts` (+ ~8 кейсов, инъекция `resolveStore`, стуб-сайдкар):
  1. `/store` body `{store:{...}}` при ready; 2. push перед `catalog`; 3. one-shot `store` в `/run`; 4. в `/run-all`; 5. значения не в логах/статусе (статус/лог-подстроки не содержат значение); 6. пустой стор → run работает; 7. ошибка резолвера → пустой стор, run работает; 8. повторный push не дублирует ключи.
- Интеграционный тест (реальный сайдкар): с фейковым `resolveStore → {openai.api_key: 'test-secret-<rand>'}` запустить ячейку `import os; print('KEY' if os.environ.get('OPENAI_API_KEY') else 'NONE')` → stdout содержит `KEY`; и значение `test-secret-…` НЕ встречается ни в ответе, ни в сохранённом ipynb (redaction лаборатории и так чистит, но проверяем границу).

### Безопасность (для G4-ревью)
- Значения живут только в замыкании main-процесса и в HTTP-запросах к 127.0.0.1 (Authorization уже есть; TLS не нужен на loopback — контракт).
- Никаких записей на диск (ни стор-файла, ни логов); `POST /store` не персистится лабораторией.
- Redaction лаборатории (`***`) остаётся второй линией.

## Q2A «Colab-микро» (E-colab2; страница кукбуков)

**R-A (навигация):** `Alt+ArrowUp/ArrowDown` на контейнере документа — фокус к предыдущей/следующей CODE-ячейке (`textarea.src`); `preventDefault` при обработке; busy — можно (навигация не блокируется).
**R-B (сворачивание вывода):** если у ячейки вывод длиннее ~600 символов — высота ограничена (max-height со скроллом) + кнопка «Показать полностью»/«Свернуть» (`aria-expanded`); состояние — локальное per-cell; копирование копирует ПОЛНЫЙ текст.
**R-C («Очистить все выводы»):** действие в шапке документа (видно только когда есть хоть один вывод) — сбрасывает все выводы к hint и чистит per-cell результаты (клиентски, как одиночный clear).

### i18n round 4 (E-i18n4; ru/en заморожены)

| Ключ | ru | en |
|---|---|---|
| cookbooks.actions.clearAllOutputs | Очистить все выводы | Clear all outputs |
| cookbooks.cell.expandOutput | Показать полностью | Show full output |
| cookbooks.cell.collapseOutput | Свернуть | Collapse |
| cookbooks.help.shortcutNav | Alt+↑/↓ — переход между ячейками | Alt+↑/↓ — move between cells |

## Тесты Q2A (E-colab2; +~6 кейсов)
Alt+↑/↓ фокусит предыдущую/следующую code-ячейку (skip md); длинный вывод → свёрнут + «Показать полностью» → развёрнут → «Свернуть»; короткий вывод — без кнопки; «Очистить все выводы» видна при выводе, скрыта без, чистит все; copy берёт полный текст при свёрнутом выводе.

## Приёмка волны
```bash
cd /Users/t/Projects/rox-worktrees/cookbooks-secrets
/opt/homebrew/bin/bun test apps/electron/src/main/__tests__/cookbooks-runtime.test.ts apps/electron/src/main/__tests__/cookbooks-sidecar.integration.test.ts
/opt/homebrew/bin/bun test apps/electron/src/renderer/pages/cookbooks/__tests__/CookbooksSurfacePage.test.tsx
/opt/homebrew/bin/bun scripts/sort-locales.ts --check && /opt/homebrew/bin/bun run lint:i18n:parity
cd apps/electron && /opt/homebrew/bin/bun run tsc --noEmit 2>&1 | grep cookbooks || echo NO-COOKBOOKS-TS-ERRORS
```
G5 (lead): живой smoke — «нет ключа»-чипы честно; при добавлении тестового ref-ключа в config → чип «ключ есть» после переоткрытия поверхности. G4 — обязателен (секреты).
