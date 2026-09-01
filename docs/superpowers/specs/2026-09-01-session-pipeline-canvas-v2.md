# Session Pipeline Canvas v2

**Дата:** 2026-09-01  
**Статус:** proposed  
**Область:** session Map / Flow / Outline  
**Суперседит:** `2026-08-20-session-map-workflow-design.md` только в части модели `Map | Flow`.  
**Не меняет:** append-only историю сессии, Notes/Knowledge `MindMapHost`, существующий SiYuan Graph.

## 1. Решение

Карта сессии должна стать не одной сущностью, а тремя связанными слоями:

```text
SessionSceneGraph       → наблюдаемая история и provenance
PipelineDraft           → редактируемый canvas до сохранения
WorkflowSpec            → versioned, валидируемый и воспроизводимый pipeline
WorkflowRun / trace     → текущее и прошлые исполнения WorkflowSpec
```

`SessionSceneGraph` остаётся read-only проекцией сообщений, tool calls и веток.
Нельзя перемещением узла на canvas менять, удалять или переписывать историю
родительской сессии. `WorkflowSpec` уже существует в `packages/shared/src/tasks`:
он хранит DAG, зависимости, inputs/outputs, retry, approval, parallel, verify и
synthesize. Canvas становится первым графическим редактором этого контракта, а не
ещё одним несинхронизируемым форматом.

## 2. Пользовательский результат

Пользователь открывает Map и сразу понимает три вещи:

1. Что уже произошло в сессии и где выполнение находится сейчас.
2. Какой pipeline породил или продолжит эту работу.
3. Как добавить следующий шаг, не разрушая прошлую историю.

Режимы имеют разные обязанности:

| Режим | Назначение | Мутируемость |
| --- | --- | --- |
| **Trace** | История текущей сессии, ветки, tool calls, артефакты | Только layout/selection/pin |
| **Flow** | Draft или сохранённый `WorkflowSpec` | Ноды, связи и конфигурация |
| **Outline** | Доступное линейное представление того же Flow/Trace | Навигация и inline edit полей |

`Map` больше не означает «другая плотность той же раскладки». `Trace` и `Flow`
различаются моделью и ясной подписью в интерфейсе.

## 3. Canonical contracts

### 3.1 Pipeline

Сохранённый pipeline — существующий `WorkflowSpec` (`TaskSpec`) в `task.yaml`.
Canvas не сериализует произвольный JSX, JavaScript или callback-функции. Он
проецирует и изменяет только serializable spec.

```ts
type WorkflowCanvasDocument = {
  version: 1
  workflow: WorkflowSpec
  layout: {
    viewport?: { x: number; y: number; zoom: number }
    nodes: Record<string, { x: number; y: number }>
    collapsed?: string[]
  }
}
```

`workflow` валидируется существующими `WorkflowSpecSchema` и
`validateTaskSpec()` до сохранения и до запуска. Layout может быть отдельным
sidecar-файлом, но его ключ всегда совпадает с `workflow.id` и версией документа.

### 3.2 Trace

`SessionSceneGraph` хранит provenance:

- `triggerMessageId` — откуда начался шаг;
- assistant output и tool packets;
- continue/fork edges;
- orphan flag, если происхождение не восстановлено.

Trace может создавать **draft из выделенной сцены**, но не редактирует саму
сцену. Каждая materialized draft-нода хранит ссылку `provenance` на scene/message.

### 3.3 Run overlay

Run не дублирует `WorkflowSpec`. Он накладывается по `workflowNodeId`:

```ts
type WorkflowRunNodeState =
  | 'draft'
  | 'queued'
  | 'running'
  | 'streaming'
  | 'waiting-approval'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'stale'
```

Run overlay обязан содержать `runId`, `workflowVersion`, started/finished time,
attempt count, input/output refs и ссылку на child session или artifact. Если
workflow меняется во время run, overlay становится `stale`, а не «тихо»
приклеивается к новому графу.

## 4. Palette нод

Palette показывает понятные пользователю типы. Внутри они должны маппиться на
существующие и будущие `WorkflowSpec.kind`, а не на визуальные компоненты.

| Palette type | Назначение | Spec mapping / состояние v1 |
| --- | --- | --- |
| **Note** | Контекст, решение, пояснение, checklist | Новый non-executable `note`; сохраняется в spec |
| **Model inference** | Вызов модели с prompt, model, connection | `session` с `model`, `llmConnection`, `prompt` |
| **Tool inference** | Вызов MCP/API/локального инструмента | Новый `tool`; v1 может materialize в session adapter до прямого runner |
| **Memory** | Retrieve, write или summarize памяти | Новый `memory`; explicit mode и source scope |
| **Router** | Выбрать ветку по условию | `route` |
| **Parallel** | Fan-out с лимитом параллелизма | `parallel` + `replicas` / `max_parallel` |
| **Join / Aggregate** | Собрать outputs веток | `aggregate` |
| **Verify / Judge** | Проверить acceptance criteria | `verify` / `judge` |
| **Synthesize** | Собрать итоговый ответ или artifact | `synthesize` |
| **Human gate** | Явное подтверждение/ввод | `approval` |
| **Subflow** | Ссылка на другой versioned workflow | future `subflow`; не выполнять до runner support |

Честное ограничение: сейчас executable runner гарантированно исполняет `session`
и часть `orchestrator`. Новые типы нельзя показывать как уже автоматически
исполняемые. До появления runtime adapter они отображают статус
«Требует materialization» и создают child session только по явной команде Run.

## 5. Порты и связи

У каждой ноды есть semantic ports, а не безымянные серые точки:

```ts
type PortKind =
  | 'control'
  | 'context'
  | 'text'
  | 'json'
  | 'artifact'
  | 'memory-ref'
  | 'approval'
```

- Control edge определяет порядок (`depends_on`, `when`, `trigger`).
- Data edge материализует `inputs` через `${nodes.<id>.output}` или declared
  structured output.
- Связать несовместимые порты нельзя: canvas показывает короткое объяснение и
  не создаёт невалидный edge.
- Цикл, dangling input, превышение параллелизма и неразрешённая ссылка —
  ошибки editor до save/run, используя существующий validator.

## 6. Контекстное меню и создание нод

### Правый клик по пустому canvas

`onPaneContextMenu` открывает anchored palette ровно в позиции курсора:

```text
Add node
  ├─ Model inference
  ├─ Tool inference
  ├─ Memory
  ├─ Note
  ├─ Router
  ├─ Parallel
  ├─ Verify
  ├─ Synthesize
  └─ Human gate
```

После выбора создаётся draft node в `screenToFlowPosition()`, автоматически
выделяется и открывает inspector. Поиск в palette работает сразу; последние
типы и favourite types стоят сверху.

### Правый клик по node

| Trace node | Draft/Flow node |
| --- | --- |
| Open source message | Configure |
| Fork from here | Run from here |
| Create draft from scene | Duplicate |
| Fan-out | Disable / enable |
| Pin in trace | Delete draft |

`Delete` никогда не показывается для исторической scene node. Drag из output
port в пустое место открывает ту же palette, но создаёт уже автоматически
подключённую следующую ноду.

### Keyboard и доступность

- `⌘K` / `Ctrl+K` — Add node palette.
- Arrow keys — переход между соседними нодами; Enter — inspector.
- Shift+F10 — контекстное меню выделенной ноды.
- Все порты имеют label, тип и видимый focus state; цвет не единственный
  носитель статуса.

## 7. Visual specification

Направление: **native command-center canvas**. Не клон Dify и не generic
purple-AI UI: графитовая глубина, спокойное стекло, точные статусы,
минимум постоянного chrome.

### Canvas

- База `bg-background`, но с мягким radial glow вокруг active cluster, а не
  плоской чёрной заливкой.
- Сетка: тонкая, низкого контраста, на 14–16px; должна помогать выравниванию,
  а не покрывать всю сцену равными точками.
- Edge: clear directional bezier с маленьким arrow head; current path имеет
  accent flow, failed path — muted destructive dash.
- Toolbar живёт в одной верхней floating island за границей рабочего поля,
  не перекрывает ноды. В ней: mode, run state, add node, fit, undo/redo,
  minimap toggle.

### Node card

Ширина 260–320px, минимум 96px высоты. Карта состоит из:

1. Header: type icon, title, current status capsule, model/tool badge.
2. Body: одна читаемая строка input/prompt и одна строка output/summary.
3. Footer: порты, duration, attempts, artifact count или memory scope.

Current node получает тонкий accent rail и subdued pulse; selected node —
outline/focus ring. Не использовать один маленький status dot как единственный
признак состояния. Текст не должен превращаться в постоянный `truncate`:
короткий summary плюс popover/inspector для полного содержания.

### Minimap

Миникарта — стеклянная overlay, не чёрный прямоугольник:

- `bg-background/55`, `backdrop-blur`, тонкий border и мягкая тень;
- цвет/форма узла показывают type и run state;
- яркий viewport rectangle показывает текущее положение;
- current node маркируется accent point;
- на небольших графах (меньше 8 нод) minimap скрыта, вместо неё остаётся Fit.

### Inspector

Убрать floating textarea и кнопки Fork/Fan-out/Rewrite из canvas. Одинарный
click открывает right inspector; double-click раскрывает source message или
node configuration. Inspector показывает config, input/output preview, run
history и действия для выбранного типа.

## 8. Белый экран на localhost

`http://localhost:5173/` сейчас является Electron renderer entry, а не
standalone web app. В обычном браузере нет preload bridge
`window.electronAPI`; основной `App` вызывает его напрямую и React не может
смонтировать рабочую поверхность. Поэтому белый экран подтверждён как отдельный
dev-experience defect, не как отсутствие Map data.

Решение:

1. Electron остаётся canonical способом открыть полноценный ROX.
2. `playground.html` получает browser-safe `Session Pipeline Canvas` fixture,
   чтобы canvas можно было править в обычном браузере без backend/IPC.
3. Root standalone entry при отсутствии preload показывает понятный preview
   gate с ссылкой на canvas fixture вместо пустого экрана. Не подделывать
   полный `electronAPI` для production App.

## 9. Phased delivery

| Фаза | Результат | Критерий выхода |
| --- | --- | --- |
| P0 | Browser-safe canvas playground и non-blank standalone gate | `5173` не показывает белый экран |
| P1 | Visual redesign Trace: node card, minimap, toolbar, inspector | Screenshot baseline для running/error/selected |
| P2 | Context menu + editable PipelineDraft | Right-click создаёт typed draft node и валидирует edge |
| P3 | `WorkflowSpec` import/export/save/version | Reopen воспроизводит graph и layout |
| P4 | Run overlay + `Run node` / `Run pipeline` | Trace привязан к workflow version |
| P5 | Direct tool/memory/subflow runners | Palette types исполняются без session adapter |

## 10. Acceptance criteria

- Пользователь никогда не видит пустой `localhost` screen.
- Map сразу показывает active/current node, viewport и понятный run state.
- Right-click по canvas создаёт Node palette; right-click по исторической
  node не предлагает destructive edit.
- Любой сохранённый pipeline проходит schema + DAG validation и сериализуется
  без executable code.
- Layout не меняет историю сессии; workflow version не меняет уже начавшийся run.
- Minimap прозрачна, показывает viewport и status semantics.
- Keyboard/focus path покрывает palette, ports и inspector.

## 11. Implementation seams

| Слой | Точка изменения |
| --- | --- |
| Session trace | `packages/core/src/mindmap/session-scene-graph.ts` |
| Canonical workflow | `packages/shared/src/tasks/schema.ts`, `validate.ts`, storage/runner |
| Canvas host | `apps/electron/src/renderer/components/session-workbench/SessionWorkflowEditor.tsx` |
| Node cards | `SceneNode.tsx` + new typed node renderers |
| Layout projection | `to-flow-elements.ts` + versioned workflow layout store |
| Right-click UI | existing Radix styled context menu components |
| Standalone preview | Playground story beside `SessionWorkflowEditor` |

## 12. Non-goals

- Переписывание parent jsonl из canvas.
- «Свободный» JS/JSX в нодах или layout manifest.
- Silent execution неисполняемых типов.
- Смешивание Map history, workflow definition и current run в один объект.
- Полный визуальный клон Dify или sim.ai.
