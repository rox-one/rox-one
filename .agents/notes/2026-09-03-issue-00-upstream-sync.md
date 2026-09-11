# Issue 00 — Upstream synchronization (2026-09-03)

Wave 0 hygiene on `cursor/rox-wave0-perf-harness-7899`, branched from
`main` at the snapshot HEAD.

## Fetch

```text
git fetch origin main
```

`origin/main` did not move relative to the VM snapshot.

## Merge base and drift

| Check | Result |
|---|---|
| `HEAD` | `d6f343cb15646efc2b875051c7395cc0de5a8184` |
| `origin/main` | `d6f343cb15646efc2b875051c7395cc0de5a8184` |
| merge-base | `d6f343cb15646efc2b875051c7395cc0de5a8184` |
| `git log -1 --format='%H %s' origin/main` | `d6f343cb15646efc2b875051c7395cc0de5a8184 Merge pull request #61 from rox-one/docs/uew-m7-handoff` |
| `git rev-list --left-right --count origin/main...HEAD` | `0	0` |

Acceptance for the left side is met: `origin/main` has **0** commits not in
`HEAD`. No rebase or merge was required. Rox history is unchanged.

## Conflict audit (Notes, Canvas, AppShell, Cloud Runs, i18n)

No upstream files changed, so there is no source/spec conflict against
`origin/main`. Plan/intent/spec files were copied from source commit
`1f56af31d3658ee9880105361ad5312324f36ab8` on
`origin/codex/rox-ui-dev-loop-20260901` because they were absent on `main`.

## Hygiene

- `.omo/` and unrelated junk were not staged.
- `git diff --check` passed on the pre-change tree (empty).

## Remote SHA readback

Recorded after the first push of this branch (filled in the PR body).
The branch is expected to be *ahead* of `origin/main` once Wave 0 commits
land; the Issue 00 gate is only “0 on the left.”
