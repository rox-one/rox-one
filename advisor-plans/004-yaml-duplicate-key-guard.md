# Plan 004: Fail CI on duplicate YAML mapping keys (and clear the two live duplicates)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` if that file exists and a reviewer asked you to
> maintain it; otherwise report the status back to whoever dispatched you.
>
> **Drift check (run first)**: `git diff --stat 4418fca40..HEAD -- .github/workflows/ci.yml package.json registry/fragments/sessions.yaml scripts/check-yaml-duplicates.ts scripts/check-yaml-duplicates.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live files before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `4418fca40`, 2026-10-09
- **State**: **DONE** — implemented in the working tree at `4418fca40` (uncommitted). All
  files below already exist as described; the steps are the implementation record,
  and each step's verification command re-confirms the as-built result. The two
  live registry duplicates are already fixed.

## Why this matters

A duplicated mapping key in a YAML file is *legal-looking* but silently wrong:
most parsers keep the last value and drop the earlier one. GitHub Actions is
stricter — it **rejects the entire workflow file** when one of its steps has a
duplicate key, and the run then finishes instantly with an empty job list, so
the failure looks like "CI didn't run" rather than a red build. This repo
already lost real time to exactly that: a merge left two `env:` keys in a smoke
step and the workflow died silently (documented at
`docs/plans/2026-10-08-rox-user-batch.md:555`). Nothing in the repo guarded
against this, and two duplicate keys were live in the RX registry. This change
adds an npm script + one CI step that walk every hand-maintained YAML file with
`js-yaml` (which throws on duplicates, unlike the `Bun.YAML.parse` the registry
validator uses) and fail the build with the offending file and key, and it
removes the two existing duplicates.

## Current state

Facts the executor needs, all verified at `4418fca40`.

### 1. The toolchain — no new dependency

- `package.json:220` — `"js-yaml": "^4.1.1"` is a **direct root dependency**
  (the `"dependencies"` block starts at `package.json:180`). Already installed;
  `bun.lock` pins it.
- **Verified behaviour** (run from the repo root):

  ```
  $ bun -e 'import {load} from "js-yaml"; try { load("a: 1\na: 2\n") } catch (e) { console.log(e.message.split("\n")[0]) }'
  duplicated mapping key (2:1)

  $ bun -e 'console.log(JSON.stringify(Bun.YAML.parse("a: 1\na: 2\n")))'
  {"a":2}
  ```

  **`js-yaml`'s `load()` throws on a duplicate key; `Bun.YAML.parse` does not —
  it silently keeps the last value.** The guard therefore uses `js-yaml`.

- `scripts/rx-validate.ts:9` says *"js-yaml есть только транзитивно … не является
  прямой зависимостью корня"* and parses with `Bun.YAML.parse`
  (`scripts/rx-validate.ts:99`, `:317`). That comment is **incorrect** (js-yaml
  IS a direct dependency) and that parser is exactly why the registry duplicates
  below went unnoticed. `rx-validate.ts` is **out of scope** for this plan — the
  guard is additive; switching the validator to `js-yaml` is deferred (see
  "Follow-up").

### 2. The two live duplicates that were fixed — `registry/fragments/sessions.yaml`

**Duplicate A — `refs:` was repeated in entry `RX-TSK-0411` (originally lines
285 and 297).** Both lines were byte-identical; the second was a
merge leftover. It has been **removed**. Current state (lines 283-296):

```
283	  status: done
284	  origin: session-recovery-20260821-do-it-all-security-slices
285	  refs: [RX-SES-0008, RX-DOC-0006, RX-TSK-0412]
286	  note: |
...
296	    FR-6 (материализация), без доступа к произвольным путям.
```

**Duplicate B — `note:` was repeated in entry `RX-TSK-0419` (originally lines
419 and 423).** Under `Bun.YAML.parse` (what `rx-validate.ts` used) the first
note was silently discarded, so this was a real content bug. The two block
scalars held distinct facts and have been **merged into one `note: |`**, keeping
both paragraphs. Current state (lines 414-427):

```
414	  path: docs
415	  status: done
416	  origin: session-recovery-20260821-security-external-access-20260811
417	  refs: [RX-SES-0009, RX-DOC-0006]
418	  note: |
419	    Код pairing уже в дереве (packages/messaging-gateway/src/pairing.ts,
420	    PairingCodeDialog.tsx, TelegramSupergroupPairingDialog.tsx) — задача
421	    дублирует существующую функциональность. Подписанные релизы — D2.
422	    Не начато: WebAuthn/passkeys pairing, неизменяемые публичные ссылки,
423	    раздельные APP_ORIGIN и SHARE_ORIGIN, защищённая поставка релизов.
424	    После TLS и messaging authority, отдельным соглашением.
425	(blank)
426	- id: RX-TSK-0420
427	  title: Собрать факты Gate 0 у владельца
```

A full `js-yaml` scan over every candidate YAML file found **no other
duplicates**.

### 3. The incident this guards against

`docs/plans/2026-10-08-rox-user-batch.md:555` (verbatim):

> - **Найден и устранён дефект CI-инфраструктуры**: слияние с чужими правками оставило в шаге смоука **два ключа `env:`** (их `DEBUG: pw:browser` + наш `ROX_PRODUCT_TOUR_NATIVE_KEEP_PROFILE`). YAML принимает дубль молча (побеждает последний), а **GitHub Actions отклоняет весь файл**: прогоны на `ac7076c65` завершались мгновенно с пустым списком джобов. Оба ключа сведены в один `env:` (`a43d0a4e4`), все workflow проверены на дубли (чисто). Урок для батча: после каждого слияния валидир…

### 4. The guard's fixed target list — files that exist TODAY

`ls -1 .github/workflows` (20 files, all `.yml`):

```
apply-settings-ia-appshell-patch.yml
apply-settings-ia-remaining.yml
bench-strict.yml
ci.yml
cloud-runs-conformance.yml
desktop-release.yml
license-gate.yml
native.yml
opencode-review.yml
perf-budgets.yml
pocket-native-vault.yml
product-tour-native.yml
publish-desktop-release.yml
runtime-map.yml
sqlite-runtime-recovery.yml
toolchain-smoke.yml
ui-001-recovery.yml
ui-lint-ratchet.yml
ui-route-recovery.yml
validate-server.yml
```

```
$ ls registry registry/fragments
registry:
RX-LEGEND.md
fragments
rx-registry.yaml

registry/fragments:
build.yaml
features.yaml
harness.yaml
links.yaml
nav.yaml
security.yaml
sessions.yaml

$ ls apps/electron/electron-builder.yml
apps/electron/electron-builder.yml

$ ls services
rox-maild
$ ls services/rox-maild
Dockerfile
README.md
docker-compose.yml
package.json
src
test
tsconfig.json

$ ls ops
fleet-infra
$ find ops -name '*.yml' | wc -l
68
$ find ops -name '*.yaml' | wc -l
0

$ find deploy -type f
deploy/pocket-sso/id.rox.one.nginx.conf
deploy/pocket-sso/rox-sso-safe-log.conf
```

Note: `deploy/` **exists but contains no YAML today** (only two nginx `.conf`
files); the guard still lists `deploy/**/*.yml` / `*.yaml` so it picks up YAML
if any is ever added. Total files the guard matches today: **98**
(20 workflows + 1 electron-builder + 8 registry + 68 ops + 1 docker-compose).
There is **no** `packages/shared/src/registry/` — the registry lives at repo-root
`registry/`.

### 5. The wiring (as built)

`package.json:132-133` (one new line added after the neighbouring `check-*`):

```json
    "check-version": "bun run scripts/check-version.ts",
    "check-yaml-duplicates": "bun run scripts/check-yaml-duplicates.ts",
```

`.github/workflows/ci.yml`, job `validate`, lines 27-34 (one new step between
`bun test packages/core` and `bun run validate:ci`):

```yaml
      - run: bun test packages/core
      - name: Guard against duplicate YAML mapping keys
        # GitHub Actions rejects a workflow file with a duplicated key; js-yaml load() catches it.
        run: bun run check-yaml-duplicates
      - run: bun run validate:ci
        env:
          # The hosted Electron TypeScript graph exceeded Node's default ~2 GiB heap.
          NODE_OPTIONS: --max-old-space-size=4096
```

Rationale for the job: `validate` runs on every push and every PR, so a
duplicate introduced by a merge is caught on the PR; placing the step before
`validate:ci` fails fast. It runs on the `ubuntu-24.04`/`macos-15` matrix so the
guard runs twice — the script is sub-second, so that is fine.

`.github/workflows/product-tour-native.yml` is **out of scope** and untouched.

### 6. Repo conventions to match

- Scripts are `bun`-run TypeScript with a shebang, run directly (no build step):
  `scripts/check-version.ts:1-2` (`#!/usr/bin/env bun` + one-line doc comment).
- Tests live next to the code and use `bun:test` with real child processes and
  `mkdtempSync` temp dirs: `scripts/product-tour/native-process.test.ts:1-20`.
- Package scripts use the key style `check-version`, `rx:validate`,
  `lint:i18n:parity`; the new plain `check-yaml-duplicates` fits.

## Commands you will need

| Purpose            | Command                                            | Expected on success                                    |
|--------------------|----------------------------------------------------|--------------------------------------------------------|
| Run the guard      | `bun scripts/check-yaml-duplicates.ts`             | exit 0, prints `no duplicate mapping keys in 98 files.` |
| Run via npm script | `bun run check-yaml-duplicates`                    | same as above                                           |
| Guard test         | `bun test scripts/check-yaml-duplicates.test.ts`   | 3 pass, 0 fail                                          |
| Registry validator | `bun run rx:validate`                              | `0 ошибок` (path warnings allowed)                      |
| Shared typecheck   | `bun run typecheck:shared`                         | exit 0 (baseline; unaffected by this plan)              |
| Electron typecheck | `bun run typecheck:electron`                       | exit 0 (baseline; unaffected by this plan)              |

(`bun run typecheck:*` does **not** cover root `scripts/` — `scripts/check-version.ts`
is likewise uncovered — so the guard is verified by *running* it and by its test.)

## Scope

**In scope** (the only files changed):

- `scripts/check-yaml-duplicates.ts` — created (103 lines; source in step 1).
- `scripts/check-yaml-duplicates.test.ts` — created (42 lines; step 5).
- `package.json` — one line added to `scripts` block (step 2).
- `.github/workflows/ci.yml` — one step added to the `validate` job (step 3).
- `registry/fragments/sessions.yaml` — the two duplicate keys removed/merged (step 4).

**Out of scope** (do NOT touch, even though they look related):

- `.github/workflows/product-tour-native.yml` — explicitly excluded; the guard
  only *reads* it.
- `ops/**`, `deploy/**`, `services/**`, `apps/electron/electron-builder.yml`,
  `registry/rx-registry.yaml`, and any `registry/fragments/*` file other than
  `sessions.yaml`.
- `scripts/rx-validate.ts` — its stale comment (`:9`) and `Bun.YAML.parse`
  usage (`:99`, `:317`) are a separate change; do not edit it here.
- No dependency additions, no formatting/reordering of unrelated lines, no
  test-expectation edits outside the two created files.

## Git workflow

- Branch: `advisor/004-yaml-duplicate-key-guard` (repo uses `fix/…`, `docs/…`,
  `test/…`; `advisor/…` for plan work is fine).
- Commit per logical unit: guard + test, wiring, registry fix.
- Commit message style matches the repo (Conventional Commits, e.g.
  `test(ci): guard the channel snapshot in the product-tour suite`); suggested:
  `chore(ci): guard against duplicate YAML keys`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

Each step below is already applied in the working tree; the **Verify** line
re-confirms the as-built result.

### Step 1: `scripts/check-yaml-duplicates.ts` (created)

As-built content (103 lines) — this is the file on disk:

```ts
#!/usr/bin/env bun
/**
 * Duplicate-YAML-key guard.
 *
 * js-yaml's load() throws on a duplicated mapping key, but Bun.YAML.parse
 * (used by scripts/rx-validate.ts) silently keeps the last one — verified:
 * Bun.YAML.parse('a: 1\na: 2\n') === { a: 2 }. GitHub Actions *rejects* a
 * workflow file whose YAML has a duplicate key, which is how one duplicated
 * `env:` key silently killed a whole workflow
 * (docs/plans/2026-10-08-rox-user-batch.md:555). This script walks a fixed
 * list of hand-maintained YAML files and fails on any duplicate key.
 *
 * Usage:
 *   bun scripts/check-yaml-duplicates.ts              # scan the default targets
 *   bun scripts/check-yaml-duplicates.ts <file>...    # scan explicit files (testing)
 *
 * Exit code: 1 if any duplicate key was found (or the target list matched no
 * files), 0 otherwise. js-yaml stops at the first duplicate in a file, so
 * after fixing one, re-run to reveal the next.
 */
import { Glob } from 'bun'
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { load, YAMLException } from 'js-yaml'

const ROOT = process.env.ROX_YAML_ROOT ?? join(import.meta.dir, '..')

/** Fixed, explicit set of hand-maintained YAML locations. */
const TARGET_GLOBS = [
  '.github/workflows/*.yml',
  '.github/workflows/*.yaml',
  'apps/electron/electron-builder.yml',
  'registry/rx-registry.yaml',
  'registry/fragments/*.yaml',
  'deploy/**/*.yml',
  'deploy/**/*.yaml',
  'ops/**/*.yml',
  'ops/**/*.yaml',
  'services/*/docker-compose*.yml',
  'services/*/docker-compose*.yaml',
]

const displayPath = (abs: string): string => {
  const rel = relative(ROOT, abs)
  return rel.startsWith('..') ? abs : rel
}

const targets = new Map<string, string>() // display -> absolute
const explicit = process.argv.slice(2)
if (explicit.length > 0) {
  for (const p of explicit) {
    const abs = resolve(p)
    targets.set(displayPath(abs), abs)
  }
} else {
  for (const pattern of TARGET_GLOBS) {
    for (const rel of new Glob(pattern).scanSync(ROOT)) {
      targets.set(rel, join(ROOT, rel))
    }
  }
}

const sorted = [...targets.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

const duplicateKeyOf = (err: YAMLException, text: string): string => {
  const line = text.split('\n')[err.mark.line] ?? ''
  const tail = line.slice(err.mark.column)
  const m = tail.match(/^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:\s][^:]*?)\s*:/)
  return m ? m[1].replace(/^['"]|['"]$/g, '') : tail.trim()
}

const offenders: { file: string; key: string; line: number }[] = []
const skipped: { file: string; reason: string }[] = []

for (const [display, abs] of sorted) {
  const text = readFileSync(abs, 'utf8')
  try {
    load(text)
  } catch (err) {
    if (err instanceof YAMLException && /duplicated mapping key/.test(err.message)) {
      offenders.push({ file: display, key: duplicateKeyOf(err, text), line: err.mark.line + 1 })
    } else if (err instanceof YAMLException) {
      skipped.push({ file: display, reason: err.message.split('\n')[0] })
    } else {
      throw err
    }
  }
}

if (sorted.length === 0) {
  console.error('check-yaml-duplicates: no files matched the target list (path list is broken)')
  process.exit(1)
}

for (const s of skipped) console.warn(`skip (not a duplicate-key error): ${s.file}: ${s.reason}`)

if (offenders.length > 0) {
  console.error(`Found duplicate mapping keys in ${offenders.length} file(s):`)
  for (const o of offenders) console.error(`  ${o.file}: duplicated key '${o.key}' (line ${o.line})`)
  process.exit(1)
}

console.log(`check-yaml-duplicates: no duplicate mapping keys in ${sorted.length} files.`)
```

Design notes: the default target list is the fixed set from §4; positional
arguments override it (used by the test and by the `/tmp` negative check). The
script reports only the **first** duplicate per file, because that is where
`js-yaml` throws. `ROX_YAML_ROOT` is an escape hatch for running the guard
against a different tree (used while validating the design); it defaults to the
repo root derived from the script's own directory.

**Verify**: `bun scripts/check-yaml-duplicates.ts; echo "exit=$?"` →
`check-yaml-duplicates: no duplicate mapping keys in 98 files.` and `exit=0`.

### Step 2: npm script (added)

`package.json:133` was inserted directly after `"check-version"` (line 132):

```json
    "check-yaml-duplicates": "bun run scripts/check-yaml-duplicates.ts",
```

**Verify**: `grep -n '"check-yaml-duplicates"' package.json` → exactly one match
(the line above). Then `bun run check-yaml-duplicates; echo "exit=$?"` → the
same clean output as step 1.

### Step 3: CI step (added)

One step was added to the `validate` job of `.github/workflows/ci.yml` between
the `bun test packages/core` and `bun run validate:ci` steps, exactly as quoted
in §5 (`- name: Guard against duplicate YAML mapping keys` / `run: bun run
check-yaml-duplicates`). Nothing was added to `product-tour-native.yml`.

**Verify**: `sed -n '27,34p' .github/workflows/ci.yml` → the three steps in the
order shown in §5.

### Step 4: Remove the two registry duplicates (done)

`registry/fragments/sessions.yaml`:
- Duplicate A: deleted the second, byte-identical
  `  refs: [RX-SES-0008, RX-DOC-0006, RX-TSK-0412]` line that followed the
  `note:` block of `RX-TSK-0411` (the one before the note is kept).
- Duplicate B: merged the two `note: |` block scalars of `RX-TSK-0419` into one,
  keeping both paragraphs (see the current state in §2).

The net diff is exactly: one `refs:` line removed, one `note: |` line removed.
No other line changed.

**Verify**: `bun scripts/check-yaml-duplicates.ts` → exit 0 as in step 1, and
`bun run rx:validate` → ends with `Итог: 0 ошибок` (registry still valid; the
`path does not exist` warnings are pre-existing and unrelated).

### Step 5: `scripts/check-yaml-duplicates.test.ts` (created)

As-built content (42 lines), modelled on
`scripts/product-tour/native-process.test.ts` (real child process + isolated
temp dir):

```ts
import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dir, 'check-yaml-duplicates.ts')

const runGuard = (args: string[]) => spawnSync('bun', [SCRIPT, ...args], { encoding: 'utf8' })

// Real child-process checks; every fixture lives in an isolated temp directory.
test('reports a duplicated mapping key and exits non-zero', () => {
  const directory = mkdtempSync(join(tmpdir(), 'check-yaml-duplicates-'))
  try {
    const file = join(directory, 'duplicate.yml')
    writeFileSync(file, "refs: ['a', 'b']\nrefs: ['a', 'b']\n")
    const result = runGuard([file])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("duplicated key 'refs'")
    expect(result.stderr).toContain(file)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('accepts a file whose keys are unique and exits zero', () => {
  const directory = mkdtempSync(join(tmpdir(), 'check-yaml-duplicates-'))
  try {
    const file = join(directory, 'unique.yml')
    writeFileSync(file, 'refs: [a, b]\nnote: |\n  ok\n')
    const result = runGuard([file])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('no duplicate mapping keys in 1 files')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the repository hand-maintained YAML set is free of duplicate keys', () => {
  const result = runGuard([])
  expect(result.stdout).toContain('no duplicate mapping keys')
  expect(result.status).toBe(0)
})
```

**Verify**: `bun test scripts/check-yaml-duplicates.test.ts` → 3 pass, 0 fail.

### Step 6: Negative check with a crafted `/tmp` duplicate (as required)

Never craft a duplicate inside a repo file for this; use `/tmp`:

```sh
printf 'refs: [a, b]\nrefs: [a, b]\n' > /tmp/rox-dup.yaml
bun scripts/check-yaml-duplicates.ts /tmp/rox-dup.yaml; echo "exit=$?"
rm -f /tmp/rox-dup.yaml
```

**Verify** — observed:

```
Found duplicate mapping keys in 1 file(s):
  /tmp/rox-dup.yaml: duplicated key 'refs' (line 2)
exit=1
```

And the clean counterpart (`printf 'refs: [a, b]\nother: ok\n' > /tmp/rox-clean.yaml`)
→ `check-yaml-duplicates: no duplicate mapping keys in 1 files.` and `exit=0`.

## Test plan

- **New tests**: `scripts/check-yaml-duplicates.test.ts` (step 5), three cases:
  duplicate-key file → exit 1 naming the key; clean file → exit 0; default repo
  walk → exit 0. These cover the bug class (silent duplicate), the happy path,
  and the fixed path list.
- **Structural pattern to follow**: `scripts/product-tour/native-process.test.ts`
  (`bun:test`, real child process, `mkdtempSync` temp dir).
- **Existing behaviour to protect**: `bun run rx:validate` (the registry edit
  must not invalidate RX ids) and `bun run test:product-tour` (untouched).
- **Verification**: `bun test scripts/check-yaml-duplicates.test.ts` → 3 pass;
  `bun run rx:validate` → `0 ошибок`.

## Done criteria

Machine-checkable. ALL hold as built:

- [ ] `bun scripts/check-yaml-duplicates.ts` exits 0 and prints
      `check-yaml-duplicates: no duplicate mapping keys in 98 files.`
- [ ] `bun run check-yaml-duplicates` prints the same (npm script exists)
- [ ] `bun test scripts/check-yaml-duplicates.test.ts` exits 0, 3 tests pass
- [ ] `bun scripts/check-yaml-duplicates.ts /tmp/rox-dup.yaml` exits 1 naming
      `duplicated key 'refs'` (step 6); a clean `/tmp` file exits 0
- [ ] `bun run rx:validate` reports `0 ошибок`
- [ ] `grep -c '"check-yaml-duplicates"' package.json` → `1`
- [ ] `grep -c 'Guard against duplicate YAML mapping keys' .github/workflows/ci.yml` → `1`
- [ ] `git diff --stat -- .github/workflows/product-tour-native.yml` → empty
- [ ] `git diff -- registry/fragments/sessions.yaml` shows exactly one removed
      `refs:` line and one removed `note: |` line

## STOP conditions

Stop and report (do not improvise) if:

- Any "Current state" excerpt no longer matches the live file (the tree has
  drifted since `4418fca40`).
- The guard reports a duplicate **in a file other than** the ones listed in §2.
  Fix it **only** if it is under `.github/workflows/`; otherwise STOP and report
  the file + key as a follow-up (do not edit `ops/`, `deploy/`, `services/`,
  `registry/rx-registry.yaml`, or `electron-builder.yml`).
- The guard reports a duplicate in `.github/workflows/product-tour-native.yml`
  — that file is out of scope; STOP and report.
- `.github/workflows/ci.yml` does not contain the `validate` job with the steps
  quoted in §5 (the workflow has been restructured).
- `js-yaml` cannot be imported from a root `scripts/` file (dependency graph
  changed).
- `.github/workflows/ci.yml` itself gains a duplicate key (GitHub would reject
  the file and the guard would never run) — report immediately.

## Follow-up (not part of this plan)

- If the guard ever finds duplicates outside the in-scope files, record them
  (file, key, line) as a separate change rather than fixing them here. As of
  `4418fca40` there are none.
- `scripts/rx-validate.ts:9` claims js-yaml is transitive-only (it is a direct
  dependency) and parses with `Bun.YAML.parse` (`:99`, `:317`), which silently
  accepts duplicates — switching it to `js-yaml` would make the registry
  validator reject duplicates itself. Deliberately deferred: separate owner and
  separate change.

## Maintenance notes

- **Keep the target list current.** `TARGET_GLOBS` is a fixed list; if a new
  directory of hand-maintained YAML appears (e.g. `charts/`, `infra/`), add its
  glob there. The script prints the scanned file count, so a shrinking count is
  a signal the list has rotted.
- **One duplicate per file per run.** `js-yaml` throws at the first duplicate,
  so a file with two duplicates is reported once; after fixing, re-run to reveal
  the next. This is intentional and documented in the script header.
- **A reviewer should check** that the new CI step is inside `validate` (not
  duplicated elsewhere), that `product-tour-native.yml` is byte-identical, and
  that the `sessions.yaml` diff only removes one `refs:` line and one `note:`
  line (the merged note keeps both paragraphs).
- **Self-coverage gap:** the guard lives in `ci.yml`, so a duplicate key in
  `ci.yml` itself will still be rejected by GitHub before the guard runs. It
  covers every *other* YAML file, including sibling workflows.
- **`ROX_YAML_ROOT`** is an intentional test/escape hatch for running the guard
  against another tree; it must never be set in CI.