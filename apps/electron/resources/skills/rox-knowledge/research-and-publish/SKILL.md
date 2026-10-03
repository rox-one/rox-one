---
name: research-and-publish
description: "Прочитать узел Rox Notes, провести веб-рисёрч по его теме и предложить обновление документа (proposal + diff) либо опубликовать отчёт в Rox Notes."
globs: []
alwaysAllow:
  - knowledge.search
  - knowledge.read
  - knowledge.get_backlinks
icon: research-publish.svg
requiredSources:
  - notes
---

# research-and-publish

## Вход (`input`)
Один аргумент — knowledge ref для Rox Notes (не `siyuan://`).
Получи контекст через сессионный инструмент `knowledge_read` с `contextMode: "snapshot"`;
backlinks — через `knowledge_get_backlinks`.

## Порядок работы
1. READ: `knowledge_read(ref, contextMode: "snapshot")` → зафиксируй `content_hash`.
2. RESEARCH: web.search / browser.navigate по теме узла; источники фиксируй списком.
3. SYNTHESIZE: сопоставь найденное с текущим содержимым; ничего не переписывай молча.
4. WRITE — один из двух исходов через Rox Notes / mutation-proposal flow:
   a. Обновление существующего документа → `knowledge.propose_update`;
   b. Новый отчёт → `knowledge.publish` в Rox Notes (путь вроде `/Research/Reports/<slug>`).

## Контракт выхода (`output`)
- type: notes_document (Rox Notes); destination `/Research/Reports` для исхода 4b;
  либо `MutationProposal` для исхода 4a.
- Provenance обязателен: source_session_id, source_blocks (без `siyuan://`),
  web-источники, модель.

## Запреты
- Не публиковать в SiYuan / b3log и не использовать `siyuan://` refs.
- Не вызывать `knowledge.create_document`/`propose_update` массово.
- Bulk delete / SQL write / silent overwrite — запрещены.
- Write capabilities MUST NOT be listed in `alwaysAllow`.
