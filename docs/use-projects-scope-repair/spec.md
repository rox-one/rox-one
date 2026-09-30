# useProjects: workspace и load generations

## Scope

Scoped correction поверх frozen full-UI candidate `4413e4ae352a6844b498b31f239ffc6c3676d7a7`. Исправляется только existing `useProjects` и его targeted regression. Authority, grants, RPC API, native producers и другие UI/features этим patch не меняются.

## Контракт

1. При commit A→B hook возвращает только B rows и очищает global local-project atom до paint, пока B RPC ещё pending.
2. Поздние success/error из A, сохранённый old refresh callback, disposed broadcast и unmounted callback не меняют текущую scope.
3. Последний same-workspace refresh и текущий broadcast supersede старую query. A→B→A не возрождает первый A lease.
4. RPC и broadcast lists сохраняют только existing `LoadedProject.workspaceId`, равный current workspace. Normal success/update/current failure остаются поддержаны.
5. Actual union `projectCatalogAtom` wrapper сохраняет shared metadata при clear/load local entries.

## Реализация

Workspace lease создаётся через useMemo, активируется layout setup и инвалидируется cleanup. Layout setup очищает local state и atom до paint. Refresh requestId и subscription-active guard fence callbacks. Workspace filtering применяется и к incoming DTOs, и к returned view. Это value/lifecycle repair существующего local-project route, без новых authority semantics.

## Acceptance boundary

Actual hook closures и actual Jotai catalog wrapper проверяются controlled render/commit/effect harness. DOM/native/browser mount, composed multi-instance consumer/layout acceptance и full R15/native/Compound DoD остаются integration gates existing owners. Общие program spec/plan сохранены.
