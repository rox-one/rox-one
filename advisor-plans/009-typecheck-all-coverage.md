# План 009: Честное покрытие `typecheck:all` (все зелёные воркспейсы) + осмысленная семантика корневого `typecheck`

> **Инструкции исполнителю**: ты — edit-only агент. Правь **только** файл `package.json` из раздела «Scope», ровно так, как описано в шагах. Команды верификации в этом плане прогоняет оркестратор, а не ты: тебе не нужно запускать tsc/тесты/линт/форматтер и не нужно ничего коммитить/пушить. Если сработал любой пункт из «Границы и escape hatch» — остановись и отчитайся, не импровизируй.
>
> **Drift check (сначала)**: `git -C /Users/t/Projects/archive/rox-one-e01-wt diff --stat 3114264ee..HEAD -- package.json`
> Если `package.json` изменился с момента написания плана — сверь приведённые ниже фрагменты с живым файлом; при расхождении это STOP-условие.

## Шапка

- **Ревизия**: `3114264ee` (ветка `e01-decisions`, рабочее дерево `/Users/t/Projects/archive/rox-one-e01-wt`).
- **Находка**: DX-01 (карточка `/tmp/improve-full.md:632-639`).
- **Impact**: низкий–средний (гейт «typecheck зелёный» переоценивает покрытие: 9 воркспейсов со своим `typecheck` не входят в `typecheck:all`; корневой `typecheck` = только shared). **Effort**: S. **Risk**: LOW (правки — только строки скриптов `package.json`; ни один зелёный воркспейс уже не покрыт цепью). **Confidence**: HIGH.

## Почему это важно

Корневой `package.json` публикует два скрипта, чьи имена обещают больше, чем они делают. `typecheck:all` (строка `:32`) — это жёстко прописанная цепочка `cd`-переходов, покрывающая `core`, `browser-intel`, `shared`, `server-core`, `server`, `session-tools-core`, `pi-agent-server`, `electron`, `ui`, `pages-worker` и `workspace-service`; девять воркспейсов, у которых **есть собственный скрипт `typecheck`**, в неё не входят (`apps/cli`, `apps/cloud-gateway`, `apps/viewer`, `apps/webui`, `packages/cloud-runner`, `packages/messaging-gateway`, `packages/messaging-discord-worker`, `packages/messaging-whatsapp-worker`, `packages/test-harness`). Корневой `typecheck` (строка `:26`) вообще равен `typecheck:shared`, то есть проверяет **только** `packages/shared`. В итоге «прогнал `bun run typecheck`, зелёный» ничего не говорит о репозитории, а «зелёный `typecheck:all`» не покрывает треть воркспейсов. План расширяет `typecheck:all` всеми воркспейсами, которые **измеренно зелёные**, фиксирует «красные» как известный baseline (не чинит их здесь), и даёт корневому `typecheck` честную семантику.

## Текущее состояние

Все факты сверены на `3114264ee` личным чтением файлов и прогоном `tsc --noEmit` в каждом воркспейсе.

### Что покрыто сегодня

- `package.json:32` — `"typecheck:all"`:
```
"typecheck:all": "cd packages/core && bun run tsc --noEmit && cd ../browser-intel && bun run tsc --noEmit && cd ../shared && bun run tsc --noEmit && cd ../server-core && bun run tsc --noEmit && cd ../server && bun run tsc --noEmit && cd ../session-tools-core && bun run tsc --noEmit && cd ../pi-agent-server && bun run typecheck && cd ../../apps/electron && bun run typecheck && cd ../../packages/ui && bun run tsc --noEmit && cd ../.. && bun run typecheck:pages-worker && bun run workspace-service:typecheck"
```
  Цепь покрывает (по именам каталогов): `packages/core`, `packages/browser-intel`, `packages/shared`, `packages/server-core`, `packages/server`, `packages/session-tools-core`, `packages/pi-agent-server`, `apps/electron`, `packages/ui`, `workers/pages` (через `typecheck:pages-worker`, `:47`), `apps/workspace-service` (через `workspace-service:typecheck`, `:35`).
- **Поправка к карточке**: карточка уже верна в том, что `browser-intel` — **не** исключение: его шаг `cd ../browser-intel && bun run tsc --noEmit` присутствует в цепи. Из списка «непокрытых» карточки `packages/browser-intel:21` — ошибка карточки, его в правках не трогаем.
- `package.json:26` — `"typecheck": "bun run typecheck:shared"`.
- `package.json:30` — `"typecheck:shared": "cd packages/shared && bun run tsc --noEmit"`.
- `package.json:114` — `"viewer:typecheck": "cd apps/viewer && bun run typecheck"`; `:120` — `"webui:typecheck": "cd apps/webui && bun run typecheck"` (существуют, но в `typecheck:all` не вызываются).

### Инвентарь: 15 `package.json` с собственным скриптом `typecheck`

| Воркспейс | в `typecheck:all`? | exit (замер на HEAD) | вердикт |
|---|---|---|---|
| `apps/electron` | да | (в цепи) | — |
| `packages/browser-intel` | да | (в цепи) | — |
| `packages/pi-agent-server` | да | (в цепи) | — |
| `packages/server` | да | (в цепи) | — |
| `packages/session-tools-core` | да | (в цепи) | — |
| `apps/workspace-service` | да (через `workspace-service:typecheck`) | (в цепи) | — |
| `apps/cloud-gateway` | **нет** | **0** | **добавить** |
| `packages/cloud-runner` | **нет** | **0** | **добавить** |
| `packages/messaging-discord-worker` | **нет** | **0** | **добавить** |
| `packages/messaging-whatsapp-worker` | **нет** | **0** | **добавить** |
| `packages/test-harness` | **нет** | **0** | **добавить** |
| `apps/cli` | **нет** | 2 | исключено (known red) |
| `apps/viewer` | **нет** | 2 | исключено (known red) |
| `apps/webui` | **нет** | 2 | исключено (known red) |
| `packages/messaging-gateway` | **нет** | 1/2 | исключено (known red) |

Плюс четыре воркспейса **без** своего `typecheck`-скрипта уже в цепи через прямой `tsc --noEmit`: `packages/core`, `packages/shared`, `packages/server-core`, `packages/ui`.

### Замер exit-кодов (я запускал каждый воркспейс по отдельности: `cd <ws> && bun run typecheck`)

Зелёные (добавляются все пять):

| Воркспейс | команда | exit | длительность |
|---|---|---|---|
| `apps/cloud-gateway` | `bun run typecheck` | 0 | ~1s |
| `packages/cloud-runner` | `bun run typecheck` | 0 | ~2s |
| `packages/messaging-discord-worker` | `bun run typecheck` | 0 | ~3s |
| `packages/messaging-whatsapp-worker` | `bun run typecheck` | 0 | ~3s |
| `packages/test-harness` | `bun run typecheck` | 0 | ~1s |

Красные (НЕ добавляются; фиксируются как known red):

| Воркспейс | exit | точная причина (файлы/строки) | класс |
|---|---|---|---|
| `apps/cli` | 2 | `packages/shared/src/protocol/dto.ts:15` и `packages/shared/src/utils/files.ts:6` — `@rox/core/types` не экспортирует `AttachmentTranscript` | предсуществующий (тот же, что уже роняет `typecheck:all`) |
| `apps/viewer` | 2 | ошибки приходят из **чужого чекаута** `/Users/t/Projects/rox-one/packages/...` (в т.ч. `packages/ui/src/components/code-viewer/zedShikiThemeData.ts`, `packages/core/src/.../credential-types.ts`) — артефакт окружения worktree (см. ниже); плюс `Object.hasOwn`/`.at` при `lib: ["ES2021"]` в `apps/viewer/tsconfig.json` | артефакт окружения + отдельная lib-тема |
| `apps/webui` | 2 | `packages/ui/src/components/chat/UserMessageBubble.tsx:375,510,511` — `transcript` отсутствует в `StoredAttachment`; тот же класс, что и `AttachmentTranscript` | предсуществующий |
| `packages/messaging-gateway` | 1/2 | `src/__tests__/binding-store-update.test.ts` и др. используют `accessMode` `'allow-list'`/`'open'`/`'owner-only'`, которых нет в `MessagingAccessMode = 'public-inbox' \| 'owner-control' \| 'disabled'` (`packages/messaging-gateway/src/types.ts:271`); плюс `@rox/shared/sources/builtin-mcp` не найден через `../../../../rox-one/...` | предсуществующий + артефакт окружения (причина baseline, не чинится здесь) |

**Артефакт окружения worktree (важно для чтения замеров).** В этом дереве `node_modules` — симлинк на `/Users/t/Projects/rox-one/node_modules`, и `node_modules/@rox/core`, `@rox/ui`, `@rox/server-core` внутри него резолвятся обратно в **другой чекаут** `/Users/t/Projects/rox-one` (другая ревизия, `0c918497d`). Из-за этого воркспейсы, чей `tsconfig` не маппит все `@rox/*` через `paths` на исходники дерева (`apps/viewer`, `apps/webui`, `packages/messaging-gateway`, отчасти `apps/cli`), показывают ошибки из чужого чекаута. Это **не** дефекты дерева. Поэтому гейты ниже сформулированы как «новые воркспейсы зелёные + нет НОВЫХ ошибок относительно зафиксированного baseline», а не «`typecheck:all` exit 0».

### Текущий baseline `typecheck:all` (красный УЖЕ, до любых правок)

Ревизия `3114264ee`, дерево как есть: `bun run typecheck:all` завершается **не 0**. В этом дереве цепь обрывается уже на шаге `packages/browser-intel` (2 ошибки класса `AttachmentTranscript` в `packages/shared/src/protocol/dto.ts:15` и `packages/shared/src/utils/files.ts:6`), а независимо от этого красными являются и другие шаги цепи в leaky-окружении (`apps/electron` — 4 ошибки `@rox/ui` из чужого чекаута; `packages/pi-agent-server` — собственные ошибки `src/*.test.ts` плюс тот же класс; `packages/server-core` — 4 ошибки). Подтверждённые оркестратором предсуществующие точки baseline: `packages/shared/src/utils/files.ts:453`, `packages/shared/src/protocol/dto.ts:15`, `packages/shared/src/utils/files.ts:6`, `packages/server-core/src/.../native-content-integration.test.ts:89`. **Это baseline — план его не чинит и не должен улучшать.** Он важен по двум причинам: (1) новые воркспейсы обязаны быть вставлены в **начало** цепи, иначе `&&`-обрыв baseline не даст до них дойти; (2) гейт формулируется как «нет НОВЫХ ошибок», а не «exit 0 всего».

### Кто вызывает корневой `typecheck` (grep по `.github/workflows`, `scripts/`)

- В `.github/workflows/**` **нет** вызова `bun run typecheck` (корневого). Есть только `bun run webui:typecheck` (`sqlite-runtime-recovery.yml:73`) и `bun run typecheck:electron` (`ui-route-recovery.yml:63`).
- В `scripts/**` корневой `typecheck` тоже не вызывается: `scripts/final-readiness-recheck.ts:42` запускает **воркспейсный** `bun run typecheck` (cwd = воркспейс), а для корня использует `typecheck:all` (`:46`); `validate:dev`/`validate:ci` (`package.json:65,68`) вызывают `typecheck:all` напрямую.
- То есть корневой `typecheck` — это **ручной удобный алиас**, у которого нет ни одного CI-потребителя; его имя обещает «typecheck репозитория», а делает он только `shared`.

## Scope

**In scope** (единственный файл, который ты правишь):

- `package.json` (корень) — ровно две строки скриптов: `:26` (`typecheck`) и `:32` (`typecheck:all`).

**Out of scope** (не трогать, даже если выглядит связанным):

- Любые `tsconfig*.json` (в т.ч. `apps/viewer/tsconfig.json`) — красные воркспейсы здесь не чинятся.
- Любые исходники и тесты воркспейсов (`apps/cli`, `apps/webui`, `apps/viewer`, `packages/messaging-gateway` и др.).
- Любые `package.json` воркспейсов (`apps/*/package.json`, `packages/*/package.json`) и `workers/pages/package.json`.
- `bun.lock`, `.github/workflows/**`, `scripts/**`, `docs/**`, `plans/**`.
- Форматирование/переупорядочивание любых других строк `package.json`.

## Executor steps (только правки файлов)

1. Открой `/Users/t/Projects/archive/rox-one-e01-wt/package.json`. Замени **значение** скрипта `"typecheck"` (строка `:26`):

   Было:
   ```
       "typecheck": "bun run typecheck:shared",
   ```
   Стало:
   ```
       "typecheck": "bun run typecheck:all",
   ```
   Больше в этой строке ничего не меняй.

2. В том же файле замени **значение** скрипта `"typecheck:all"` (строка `:32`), добавив в **начало** цепи пять зелёных воркспейсов. Было (как есть на `3114264ee`):
   ```
       "typecheck:all": "cd packages/core && bun run tsc --noEmit && cd ../browser-intel && bun run tsc --noEmit && cd ../shared && bun run tsc --noEmit && cd ../server-core && bun run tsc --noEmit && cd ../server && bun run tsc --noEmit && cd ../session-tools-core && bun run tsc --noEmit && cd ../pi-agent-server && bun run typecheck && cd ../../apps/electron && bun run typecheck && cd ../../packages/ui && bun run tsc --noEmit && cd ../.. && bun run typecheck:pages-worker && bun run workspace-service:typecheck",
   ```
   Стало (добавлены ровно пять `--cwd`-шагов в начало; хвост цепи — байт-в-байт прежний):
   ```
       "typecheck:all": "bun run --cwd apps/cloud-gateway typecheck && bun run --cwd packages/cloud-runner typecheck && bun run --cwd packages/messaging-discord-worker typecheck && bun run --cwd packages/messaging-whatsapp-worker typecheck && bun run --cwd packages/test-harness typecheck && cd packages/core && bun run tsc --noEmit && cd ../browser-intel && bun run tsc --noEmit && cd ../shared && bun run tsc --noEmit && cd ../server-core && bun run tsc --noEmit && cd ../server && bun run tsc --noEmit && cd ../session-tools-core && bun run tsc --noEmit && cd ../pi-agent-server && bun run typecheck && cd ../../apps/electron && bun run typecheck && cd ../../packages/ui && bun run tsc --noEmit && cd ../.. && bun run typecheck:pages-worker && bun run workspace-service:typecheck",
   ```

   Почему именно так:
   - `--cwd` уже используется в этом файле (`"workspace-service:typecheck": "bun run --cwd apps/workspace-service typecheck"`, `:35`) — это принятый в репо идиом, не новый паттерн.
   - Пять шагов добавлены **в начало**: цепь соединена `&&`, и существующий baseline-обрыв (шаг `browser-intel`/`server-core`) оборвал бы цепь **до** новых шагов, если добавить их в конец. В начале они гарантированно исполняются.
   - `cd`-цепь внутри `typecheck:all` начинается с корня (`cd packages/core`), поэтому `--cwd`-шаги перед ней не меняют `cwd` и не ломают последующие `cd`. Порядок/содержимое хвоста не меняй.

3. Ничего больше не добавляй и не удаляй (не заводи `cloud-gateway:typecheck` и т.п. вспомогательных скриптов — оркестратор вызывает воркспейсы напрямую через `--cwd`).

## Verification gates (оркестратор)

Все команды — с абсолютным cwd `/Users/t/Projects/archive/rox-one-e01-wt`. Замеры делать в чистом окружении, где `node_modules/@rox/*` резолвятся **в это дерево**, а не в `/Users/t/Projects/rox-one` (см. «Артефакт окружения» выше); если окружение leaky — гейт 2 всё равно разделяет «новые» и «baseline» ошибки.

1. **JSON валиден и правки на месте:**
   ```
   bun -e 'const p=JSON.parse(await Bun.file("package.json").text()); const all=p.scripts["typecheck:all"]; const need=["apps/cloud-gateway","packages/cloud-runner","packages/messaging-discord-worker","packages/messaging-whatsapp-worker","packages/test-harness"]; const miss=need.filter(d=>!all.includes("--cwd "+d+" typecheck")); if(miss.length){console.error("MISSING IN typecheck:all:",miss);process.exit(1)} if(p.scripts.typecheck!=="bun run typecheck:all"){console.error("typecheck semantics wrong:",p.scripts.typecheck);process.exit(1)} if(!all.includes("cd packages/core && bun run tsc --noEmit")){console.error("existing chain head lost");process.exit(1)} console.log("OK: package.json valid; 5 workspaces added; typecheck=typecheck:all; tail intact")'
   ```
   Ожидаемо: строка `OK: ...`, exit 0.

2. **Каждый новый воркспейс зелёный (негативный контроль для красных):**
   ```
   for w in apps/cloud-gateway packages/cloud-runner packages/messaging-discord-worker packages/messaging-whatsapp-worker packages/test-harness; do bun run --cwd "$w" typecheck; echo "$w exit=$?"; done
   ```
   Ожидаемо: пять раз `exit=0`.

3. **`typecheck:all` не даёт НОВЫХ ошибок относительно baseline (не «exit 0»):**
   ```
   bun run typecheck:all 2>&1 | tee /tmp/typecheck-all-009.log; echo "exit=$?"; echo "== TS count =="; grep -c 'error TS' /tmp/typecheck-all-009.log; echo "== errors from NEW workspaces (must be 0) =="; grep -E '^.*(apps/cloud-gateway|packages/cloud-runner|packages/messaging-discord-worker|packages/messaging-whatsapp-worker|packages/test-harness)[/(].*error TS' /tmp/typecheck-all-009.log | wc -l
   ```
   Ожидаемо: ошибки (если есть) приходят **только** из baseline-точек (`packages/shared/src/protocol/dto.ts:15`, `packages/shared/src/utils/files.ts:6` и/или шаг `packages/server-core`); строка `errors from NEW workspaces` = `0`. Любая `error TS` с путём, начинающимся на новый воркспейс, — провал гейта.

4. **Перекрёстный инвентарь: «каждый `package.json` со своим `typecheck` — в цепи ИЛИ явно исключён с причиной»:**
   ```
   bun -e 'const fs=require("fs");const ws=["apps","packages"].flatMap(g=>fs.readdirSync(g).map(n=>g+"/"+n)).filter(d=>fs.existsSync(d+"/package.json"));const withTc=ws.filter(d=>{try{return JSON.parse(fs.readFileSync(d+"/package.json","utf8")).scripts?.typecheck}catch{return false}});const s=JSON.parse(fs.readFileSync("package.json","utf8")).scripts;const hay=[s["typecheck:all"],s["typecheck:pages-worker"],s["workspace-service:typecheck"]].join(" ");const excluded=["apps/cli","apps/viewer","apps/webui","packages/messaging-gateway"];const unclassified=withTc.filter(d=>!hay.includes("/"+d.split("/").pop())&&!excluded.includes(d));console.log("with-typecheck:",withTc.length,"| in-chain:",withTc.filter(d=>hay.includes("/"+d.split("/").pop())).length,"| excluded:",excluded.length);if(withTc.length!==15||unclassified.length){console.error("UNCLASSIFIED:",unclassified);process.exit(1)}console.log("OK: 15 = chain + excluded, none unclassified")'
   ```
   Ожидаемо: `with-typecheck: 15 | in-chain: 11 | excluded: 4` → `OK: 15 = chain + excluded, none unclassified`, exit 0. (11 в цепи = `electron`, `browser-intel`, `pi-agent-server`, `server`, `session-tools-core`, `workspace-service` из старой цепи + 5 новых.)

5. **Семантика корневого `typecheck` подтверждена вызовом (и отсутствием CI-вызовов):**
   ```
   grep -rIn "run typecheck\b" .github/workflows/ scripts/ | grep -v 'typecheck:' ; echo "grep_exit=$?"
   bun run typecheck 2>&1 | head -3 ; echo "typecheck_exit=${PIPESTATUS[0]}"
   ```
   Ожидаемо: `grep` не находит вызовов корневого `bun run typecheck` (`grep_exit=1`); `bun run typecheck` теперь печатает первый шаг `$ bun run --cwd apps/cloud-gateway typecheck` (то есть равен `typecheck:all`), его код совпадает с кодом гейта 3. Смена семантики не влияет на CI — там вызывается `typecheck:all` через `validate:dev`/`validate:ci`.

6. **Замер длительности** (для отчёта; сравнить с baseline `typecheck:all` до правок, ~154 с в чистом чекауте по `docs/final-readiness/evidence/candidate-recheck.json`):
   ```
   s=$(date +%s); bun run typecheck:all >/dev/null 2>&1; echo "dur=$(( $(date +%s)-s ))s exit=$?"
   ```
   Ожидаемо: длительность ≈ baseline + `1..3` с на каждый новый воркспейс (суммарно ≈ +10 с). Если прирост сильно больше — разбираться (возможно, новый воркспейс тянет больше кода, чем измерено).

7. **Диф ограничен одним файлом:**
   ```
   git -C /Users/t/Projects/archive/rox-one-e01-wt status --short
   ```
   Ожидаемо: единственная модификация — `M package.json`. Никаких tsconfig/исходников/воркспейс-манифестов.

## Test plan

Отдельные тесты **не нужны**, и это осознанно:

- Правка — метаданные (`package.json`): две строки скриптов. Нет рантайм-поведения и нет шва для unit-теста; в репозитории нет теста «npm-поверхности скриптов», и заводить его здесь не нужно.
- Машинно-проверяемую защиту от регресса даёт **гейт 4** (инвентарь «15 = 11 в цепи + 4 исключённых»): если кто-то добавит воркспейс со своим `typecheck` и не впишет его ни в цепь, ни в исключения, гейт упадёт. Это и есть «тест» покрытия — команда с ожидаемым результатом, воспроизводимая на CI/локально.
- Регресс «новый зелёный воркспейс стал красным» ловит **гейт 2/3** (пер-воркспейс `exit 0` + «zero errors from NEW workspaces»).
- Baseline-краснота (`AttachmentTranscript`/`server-core`) намеренно **не** покрывается тестом и не чинится в этом плане — см. «Границы».

## Границы и escape hatch (STOP-условия)

Остановись и отчитайся, **не** импровизируя, если:

- Строка `package.json:26` или `:32` не совпадает с приведёнными в шагах (дерево дрейфнуло с `3114264ee`).
- Оказывается, что у одного из пяти «зелёных» воркспейсов (`apps/cloud-gateway`, `packages/cloud-runner`, `packages/messaging-discord-worker`, `packages/messaging-whatsapp-worker`, `packages/test-harness`) **нет** скрипта `typecheck` в его `package.json` — тогда `--cwd ... typecheck` упадёт; не подменяй команду, отчитайся.
- Правка требует тронуть файл вне Scope (любой `tsconfig`, любой воркспейс-`package.json`, `bun.lock`, workflows, исходники).
- Возникает соблазн «заодно» починить красные воркспейсы (`apps/cli`, `apps/webui`, `apps/viewer`, `packages/messaging-gateway`) или baseline `typecheck:all` — **НЕ делай этого**: они вне scope.

Отдельно, для красных воркспейсов — это осознанные исключения, НЕ STOP-условия для исполнителя (исполнитель их вообще не трогает). Их статус записан для будущих планов:

- **`apps/cli`** — known red (предсуществующий класс `@rox/core/types` не экспортирует `AttachmentTranscript`; тот же класс роняет `typecheck:all`). Не добавлять, пока класс не починен отдельно.
- **`apps/webui`** — known red (предсуществующий: `StoredAttachment.transcript` отсутствует в `packages/ui/src/components/chat/UserMessageBubble.tsx`; плюс ошибки из чужого чекаута). Не добавлять.
- **`apps/viewer`** — known red; основная видимая причина в этом дереве — артефакт окружения (ошибки из `/Users/t/Projects/rox-one/packages/...`); отдельная тема — `lib: ["ES2021"]` в `apps/viewer/tsconfig.json` против `Object.hasOwn`/`.at` в `packages/ui`/`packages/core` (TS2550/TS2339). Чинится отдельным планом (tsconfig/viewer), не здесь.
- **`packages/messaging-gateway`** — known red; смесь: (а) артефакт окружения (`@rox/shared/sources/builtin-mcp` не найден через `../../../../rox-one/...`); (б) собственный дрейф тестов — `src/__tests__/*` используют `accessMode` `'allow-list'`/`'open'`/`'owner-only'`, которых нет в `MessagingAccessMode` (`packages/messaging-gateway/src/types.ts:271`). Чинится отдельным планом.

## Maintenance note

- После правки корневой `typecheck` больше **не** быстрый subset — это полный гейт (`typecheck:all`), честно отражающий состояние репо (включая записанный baseline). Кому нужен быстрый subset shared — вызывать `bun run typecheck:shared` явно.
- Ревьюеру проверить: добавлены ровно пять `--cwd`-шагов в **начало** `typecheck:all`; хвост цепи (`cd packages/core && ... && bun run workspace-service:typecheck`) не изменён; `typecheck` = `bun run typecheck:all`; диф — только `package.json`; в новом воркспейсе нет введённых ошибок (гейт 3).
- Когда baseline `typecheck:all` (класс `AttachmentTranscript` в `packages/shared`) и известные красные воркспейсы будут починены отдельными планами — их надо будет добавить в `typecheck:all` тем же `--cwd`-идиомом; инвентарь-гейт 4 тогда обновится (число исключённых уменьшится).
- Если воркспейс-`typecheck` в будущем начнёт резолвить `@rox/*` через `node_modules` (а не через `paths`) — помнить про симлинк `node_modules` на другой чекаут в этом дереве: пер-воркспейс замеры надо читать с учётом «Артефакта окружения».