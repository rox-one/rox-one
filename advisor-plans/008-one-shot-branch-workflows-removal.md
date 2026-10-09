# План 008: Удалить одноразовые branch-mutating workflow `apply-settings-ia-*` и их артефакты

> **Инструкции исполнителю**: ты — edit-only агент. Ты выполняешь **только удаление файлов**; не редактируй их содержимое и ничего не создавай. Команды верификации в этом плане прогоняет оркестратор, а не ты; тесты/линт/форматтер запускать не нужно, коммитить/пушить — тоже. Если сработал любой пункт из «Границы и escape hatch» — остановись и отчитайся.
>
> **Drift check (сначала)**: `git -C /Users/t/Projects/archive/rox-one-e01-wt diff --stat 3114264ee..HEAD -- .github/workflows patches scripts`
> Если затронутые файлы изменились с момента написания плана — сверить с «Текущее состояние»; при расхождении это STOP-условие.

## Шапка

- **Ревизия**: `3114264ee` (ветка `e01-decisions`, рабочее дерево `/Users/t/Projects/archive/rox-one-e01-wt`).
- **Находка**: TECH-05 (карточка `/tmp/improve-full.md:581-589`).
- **Impact**: низкий/средний (два `contents: write` workflow пишут в неподдерживаемую ветку `cursor/settings-ia-hub`, дублируют источник правды по AppShell; appshell-вариант жёстко падает при уже применённом патче). **Effort**: S. **Risk**: LOW. **Confidence**: HIGH (существование удалённой ветки не проверить — см. ниже).

## Почему это важно

В `.github/workflows/` лежат два `workflow_dispatch`-воркфлоу, которые по кнопке делают checkout ветки `cursor/settings-ia-hub`, применяют патч/скрипт и **пушат обратно в неё** (`permissions: contents: write`). Это разовые «примени патч к ветке» операции, завершённые вручную и оставшиеся в репозитории как мусор: они дублируют источник правды по AppShell-навигации, а appshell-вариант падает (`git apply` без `--check`), если патч уже применён. Вместе с ними в дереве лежат сам патч и node-скрипт правки локалей, нужные только этим workflow. Удаление убирает два write-воркфлоу с неподдерживаемой ветки и три мёртвых артефакта, ни на что живое не влияя.

## Текущее состояние

Все факты проверены на `3114264ee`.

- `.github/workflows/apply-settings-ia-appshell-patch.yml` — 25 строк, полностью:

```yaml
name: apply-settings-ia-appshell-patch

on:
  workflow_dispatch:

permissions:
  contents: write

jobs:
  apply:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: cursor/settings-ia-hub
          token: ${{ secrets.GITHUB_TOKEN }}
      - name: Apply AppShell patch
        run: |
          set -euo pipefail
          git apply --verbose patches/settings-ia-appshell.patch
          git config user.name "id-2"
          git config user.email "gronxie@yandex.com"
          git add apps/electron/src/renderer/components/app-shell/AppShell.tsx
          git commit -m "feat(shell): hide middle nav for Memory/Tasks/Meetings/Projects/Pages"
          git push origin HEAD:cursor/settings-ia-hub
```
  (`:7` `contents: write`, `:20` `git apply … patches/settings-ia-appshell.patch`, `:25` `git push origin HEAD:cursor/settings-ia-hub`.)

- `.github/workflows/apply-settings-ia-remaining.yml` — 36 строк; тот же каркас (`ref: cursor/settings-ia-hub`, `contents: write`), но применяет патч условно (`:20-24` `git apply --check … || echo "already applied"`), затем `:25` `node scripts/patch-settings-ia-locales.mjs`, коммитит `AppShell.tsx` + `en.json`/`ru.json` и `:36` пушит в `cursor/settings-ia-hub`.
- `patches/` содержит **ровно один** файл: `patches/settings-ia-appshell.patch` (3188 байт). Других `*-settings-ia*` патчей нет.
- `scripts/` содержит **ровно один** `settings-ia`-файл: `scripts/patch-settings-ia-locales.mjs`. Других нет.
- Полная «серия» по grep `-i settings-ia` (см. гейты) = перечисленные выше 4 файла; больше ничего.
- **Ссылки**: живых потребителей нет — ни один workflow, скрипт, тест или конфиг не вызывает эти workflow и не читает патч/скрипт (`workflow_run`/`uses:`/`workflow_call` по ним отсутствуют; в `.github/` кроме самих файлов совпадений нет). Остаются только текстовые упоминания в **исторических evidence-манифестах** — датированных снимках SHA файлов:
  - `docs/final-readiness/execution/cloud/OWNER-UI-001/verification/**/UI-001-expanded-stdio-validate-committed-976a377-verification.json` (SHA-хэши обоих workflow и `patch-settings-ia-locales.mjs`);
  - `docs/cloud-all-surfaces-direct-010-evidence-20261001/**` (source-before/after, negative-smoke, electron-types — SHA-хэши тех же файлов).

  Это **не потребители**, а неизменяемые записи о прошлом состоянии дерева; план их не трогает, и их наличие — ожидаемое исключение из «ссылок нет».

### Почему это безопасно удалить

- Оба workflow запускаются только вручную (`on: workflow_dispatch`) и целятся в ветку `cursor/settings-ia-hub`, которая по своей природе неподдерживаемая; сама ветка вне аудируемого дерева, поэтому её существование не проверяется (Confidence поэтому HIGH по дереву, а не по ветке).
- Локально-значимый результат (скрытая middle-nav + ключи локалей) уже в дереве — файлы `apps/electron/src/renderer/components/app-shell/AppShell.tsx`, `packages/shared/src/i18n/locales/en.json`, `.../ru.json` не входят в scope и не должны меняться.

## Scope

**In scope** (единственные файлы, которые ты удаляешь — `git rm`/удаление, без правок содержимого):

- `.github/workflows/apply-settings-ia-appshell-patch.yml`
- `.github/workflows/apply-settings-ia-remaining.yml`
- `patches/settings-ia-appshell.patch`
- `scripts/patch-settings-ia-locales.mjs`

**Out of scope** (не трогать):

- Все остальные workflow в `.github/workflows/**` (включая `ci.yml`, `product-tour-native.yml`, `ui-001-recovery.yml` и прочие `ui-*`) — они не связаны с этими двумя.
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx`, `packages/shared/src/i18n/locales/{en,ru}.json` — результат патча уже в дереве; не менять.
- **`docs/final-readiness/**` и `docs/cloud-all-surfaces-direct-010-evidence-20261001/**`** — исторические evidence-манифесты со SHA-хэшами; не редактировать (записи о прошлом, не потребители).
- `.github/CODEOWNERS`, любые `scripts/**` кроме `patch-settings-ia-locales.mjs`.

## Executor steps (только правки файлов)

1. Удали четыре файла (содержимое не редактируй):

   - `/Users/t/Projects/archive/rox-one-e01-wt/.github/workflows/apply-settings-ia-appshell-patch.yml`
   - `/Users/t/Projects/archive/rox-one-e01-wt/.github/workflows/apply-settings-ia-remaining.yml`
   - `/Users/t/Projects/archive/rox-one-e01-wt/patches/settings-ia-appshell.patch`
   - `/Users/t/Projects/archive/rox-one-e01-wt/scripts/patch-settings-ia-locales.mjs`

   После удаления каталог `patches/` становится пустым и исчезает сам (git не хранит пустые каталоги) — отдельно ничего удалять/создавать не нужно.

2. Больше **ничего** не меняй: ни один другой файл (включая доки и evidence-манифесты) не входит в эту правку.

## Verification gates (оркестратор)

Все команды — с абсолютным cwd `/Users/t/Projects/archive/rox-one-e01-wt`.

1. Файлов нет:

   ```
   ls .github/workflows/apply-settings-ia-appshell-patch.yml .github/workflows/apply-settings-ia-remaining.yml patches/settings-ia-appshell.patch scripts/patch-settings-ia-locales.mjs
   ```
   Ожидаемо: четыре «No such file or directory». Каталог `patches/` также отсутствует: `ls -d patches` → «No such file or directory».

2. Серия «settings-ia» пуста:

   ```
   ls patches/ scripts/ 2>/dev/null | grep -i settings-ia ; echo "exit=$?"
   ```
   Ожидаемо: пустой вывод, `exit=1`.

3. Список workflow без них — 18 файлов (было 20), двух имён нет:

   ```
   ls -1 .github/workflows/ | wc -l          # ожидаемо 18
   ls -1 .github/workflows/ | grep -c 'apply-settings-ia'   # ожидаемо 0 (grep exit 1)
   ls -1 .github/workflows/ | grep -E 'ci\.yml|product-tour-native\.yml|ui-001-recovery\.yml'
   ```
   Ожидаемо: `18`; `0`; три соседних workflow на месте.

4. Негативный grep по живым ссылкам (исключая исторические evidence-манифесты):

   ```
   grep -rIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=final-readiness --exclude-dir=cloud-all-surfaces-direct-010-evidence-20261001 -E 'apply-settings-ia|settings-ia-appshell|patch-settings-ia-locales' . ; echo "exit=$?"
   ```
   Ожидаемо: пустой вывод, `exit=1`. (Разрешённый остаток — только evidence-манифесты из Out of scope; их наличие не считается нарушением.)

5. Остальные workflow не сломаны и изменены только удалением:

   ```
   git -C /Users/t/Projects/archive/rox-one-e01-wt status --short
   git -C /Users/t/Projects/archive/rox-one-e01-wt diff --stat -- .github/workflows
   ```
   Ожидаемо: `git status` показывает только 4 удаления (`D`) ровно по in-scope путям, без модификаций (`M`) каких-либо файлов. `diff --stat` по `.github/workflows` не содержит изменённых (`M`) файлов — только удаления.

## Test plan

Отдельные тесты **не нужны**, и это осознанно:

- Изменение — чистое удаление неиспользуемых файлов; нет рантайм-поведения и нет шва для unit-теста.
- Проверка корректности — это машинные гейты выше (`ls` отсутствия, `grep` отсутствия живых ссылок, неизменность соседних workflow, диф только на удаления). Гонять `bun test`/`bun run test` не требуется: ни один тест не ссылается на эти файлы (подтверждено grep'ом по репо).
- Гард от повторного появления подобных одноразовых write-workflow — вне scope (категория D-04 «честность дерева», отдельная задача).

## Границы и escape hatch (STOP-условия)

Остановись и отчитайся, **не** импровизируя, если:

- Какой-либо из четырёх файлов отсутствует **до** начала работы (дерево дрейфнуло с `3114264ee`).
- Найден **живой** потребитель (ссылка в workflow/скрипте/конфиге/тесте), которого не было при написании плана, — тогда удаление может что-то ломать.
- `scripts/patch-settings-ia-locales.mjs` используется ещё чем-то, кроме `apply-settings-ia-remaining.yml`.
- Правка требует тронуть файл вне Scope — включая соблазн «почистить» SHA-хэши в `docs/final-readiness/**` или `docs/cloud-all-surfaces-direct-010-evidence-20261001/**` (нельзя: это исторические evidence-манифесты).

## Maintenance note

- Удаление необратимо меняет историю в `cursor/settings-ia-hub` только в том смысле, что переприменить патч этой кнопкой больше нельзя; сам результат уже в дереве (`AppShell.tsx`, локали). Если ветка/патч когда-нибудь понадобятся снова — восстановить из git-истории по удалённым путям.
- Ревьюеру проверить: удалены ровно 4 файла и каталог `patches/`; остальные 18 workflow не изменены; диф содержит только удаления; evidence-манифесты не тронуты.
- Исторические evidence-манифесты (`docs/final-readiness/**`, `docs/cloud-all-surfaces-direct-010-evidence-20261001/**`) намеренно содержат SHA-хэши удалённых файлов как запись о прошлом состоянии — не «исправлять» их.