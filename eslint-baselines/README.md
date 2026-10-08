# UI lint ratchet (`ui-tokens.json`)

UI-A2 (#1568). The rox/* ESLint token rules and stylelint count raw z-index / colour / radius /
primitive-bypass violations per rule, per file. `scripts/lint-baseline.ts` compares those counts
with this baseline. CI runs it on every PR (`.github/workflows/ui-lint-ratchet.yml`).

```bash
bun run lint:ui-tokens            # --check: counts may only go down
bun run lint:ui-tokens:update     # rewrite the baseline (refuses to record growth); runs with
                                  #   --base origin/main so renamed files move to their new path
bun run lint:ui-tokens:update --base origin/<stack-base>   # stacked PR: a later --base wins
```

## What counts

- Every message of a gated rule counts once, including ones a disable comment would suppress.
  Inline config is ignored while counting (`noInlineConfig` / `ignoreDisables`).
- The one exemption: a **next-line** or **same-line** directive that names the rule and carries a
  non-empty `-- justification`:

  ```tsx
  // eslint-disable-next-line rox/no-hardcoded-z-index -- layering above the shell titlebar
  <div className="z-[60]" />
  ```

  File-wide, block, bare (no rule) and reason-less disables still count.
- Files: every `.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs` and `.css` file under the UI trees, except
  tests (`__tests__`, `*.test.*`, `*.spec.*`), `.d.*` and `dist`. Only the owned configs decide
  what is skipped: the script's ESLint `ignores` (no `eslint.config.*`, no `.eslintignore`) and
  `.stylelintrc.cjs` `ignoreFiles` (stylelint runs with `ignorePath: /dev/null`, so a root
  `.stylelintignore` has no effect). The run fails if a linter skipped any other file.
- A rule at 0 flips from warning to error (its severity is recorded in the baseline).
- The ratchet only ever fails on growth. Decreases are reported and stay recorded until the next
  `--update`, so the baseline is a ceiling, not a mirror. Run `--update` to lock decreases in.

## Ungated until a compliant fix exists

These stay **editor warnings** but are excluded from the growth gate (recorded under `ungated`,
never under `files`). TODO: remove the exemption in `apps/electron/eslint-rules/ui-tokens.cjs`
when the fix lands.

| Rule / messageId | Why ungated | Lands with |
| --- | --- | --- |
| `rox/no-raw-error-render` (all) | no `presentError` yet | #1569 (UI-A3) |
| `rox/prefer-primitives` `rawCheckbox` | no Checkbox primitive yet | #1592 (UI-C1) |

Ungating is a weakening: adding a rule or messageId to `UNGATED` (or widening a list to the whole
rule) fails the PR versus the base baseline until an owner adds the `ui-baseline-override` label,
and `--check` fails while `UNGATED` and this file's `ungated` section disagree (run `--update`).

`<select>`, `role="tab"`, raw tooltips and fixed overlays stay gated: Select, Tabs, Tooltip and
Dialog primitives exist.

## Renames and the base branch

`--base <ref>` reads `git diff -M -l0 --name-status <ref>` (no rename limit) for renames.

- **A PR that moves a file must rebaseline.** `--check --base` fails while the committed baseline
  still lists a renamed file under its old path: the PR itself would pass, but after the merge the
  push-to-main run (no `--base`) and every later PR would see the new path with no baseline entry.
  Fix it with `bun run lint:ui-tokens:update --base <ref>` (the PR's base branch; the script
  defaults to `origin/main`) and commit the baseline. `--update --base` moves the renamed file's
  counts to its new path, so a move is not growth; `--update` without `--base` cannot tell a move
  from a new file and refuses it.
- On pull requests CI compares with the merge commit's own base (`--base HEAD^1`, the commit the
  merge was built on, not the moving branch tip). It reads that commit's baseline
  (`git show HEAD^1:eslint-baselines/ui-tokens.json`) and fails if any (file, rule) count grew or a
  rule's severity was weakened versus that copy — editing this file in the same PR cannot raise the
  ceiling. Owners approve genuine growth with the **`ui-baseline-override`** label (re-runs the
  check).
- `/eslint-baselines/`, both `eslint-rules/` directories, `scripts/lint-baseline.ts`,
  `scripts/stylelint/`, `.stylelintrc.cjs` and the workflow are owned by @agisota
  (`.github/CODEOWNERS`; binds when branch protection requires code-owner review).

```bash
bun scripts/lint-baseline.ts --update --base origin/main --allow-increase apps/electron/src/Foo.tsx   # exactly these files
```

## Partial runs

`--targets` lints only the named directories and skips the whole-repo checks (flip-to-error,
severity drift). `--update --targets` on the default baseline is refused outright: it would drop
every un-linted file. Use `--prefix-merge` to replace only the targeted prefixes and keep the rest.

## Rebaselining after another UI PR

The baseline must hold on this branch and on merges with `main` and with in-flight UI PRs, or the
next merge fails CI. Build it as the per-file max:

```bash
# 1. counts on this branch
bun scripts/lint-baseline.ts --print /tmp/branch.json
# 2. a throwaway worktree of the merge result (origin/main, then the other UI PR, then this branch)
git worktree add --detach /tmp/ui-merge origin/main
git -C /tmp/ui-merge merge --no-commit --no-ff <other-ui-pr> <this-branch>
ln -s "$PWD/node_modules" /tmp/ui-merge/node_modules   # remove it before any bun install there
bun scripts/lint-baseline.ts --root /tmp/ui-merge --print /tmp/merged.json
# 3. record the max
bun scripts/lint-baseline.ts --update --base origin/main --merge /tmp/branch.json --merge /tmp/merged.json
```

Growth the new detection introduces is a one-time rebaseline: name every grown file with
`--allow-increase`, say why in the commit message, and get owner review (CODEOWNERS).
