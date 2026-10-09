# WP-01 spike — memory repository baseline

**Throwaway spike. Do not ship.**

Decides whether the "memory as a git repository" projection (spec
`docs/plans/2026-10-09-memory-repository-and-dreaming.md` §6, WP-01) meets its
budget on a realistic corpus before the feature is built out:

- ≤ 2 s for a full materialize + `git init`/`add`/`commit` cycle over both banks;
- human-readable diffs.

## What it does

1. Builds a realistic corpus: ~200 lessons per bank across categories, 30 days
   of `history/YYYY-MM-DD.md`, `context.md` and `preferences.md`.
2. Materializes both banks through the real `MemoryRepoService` (which renders
   via `MemoryRepoMaterializer` and drives `git` through `git-exec`).
3. Prints wall time, a second (no-op) materialize time, repo bytes and three
   sample `git diff`/`show` outputs.
4. Exercises the no-git snapshot fallback as a second measurement.

## Run

```bash
bun run spikes/memory-repo-baseline/spike.ts
```

Everything runs in a fresh temp dir under the OS temp directory; nothing is
written to `~/Documents`/`~/Desktop` and nothing is committed to the product
repo.

## Measured report

Corpus: **200 lessons × 2 banks + 30 days of `history/YYYY-MM-DD.md`**, run
through the real `MemoryRepoService` (git init/add/commit) on macOS arm64.
Acceptance: ≤ 2 s full cycle, ≤ 1 MiB per 1000 lessons, human-readable diffs.

Recorded run (the numbers quoted in plan §0):

```json
{
  "corpus": { "lessonsPerBank": 200, "banks": 2, "historyDays": 30 },
  "wallTime": { "fullCycleMs": 942, "noopRematerialize": "39 ms" },
  "bytesPer1000WorktreeOnly": 452608,
  "bytesPer1000Lessons": 1062113,
  "acceptance": { "cycleUnder2s": true, "under1MiBPer1000Lessons": false, "readableDiffs": true }
}
```

Re-run on 2026-10-09 (`bun run spikes/memory-repo-baseline/spike.ts`); timing
varies with machine load, the byte figures reproduce — full cycle **1133 ms**
(main materialize 551 ms, workspace materialize 525 ms), no-op rematerialize **57 ms**, work tree
**452 608 B**, total with `.git-rox` **1 062 110 B** per 1000 lessons
(`repoBytes` 424 844; `mainMaterialize` 204 files, `ws` 233 files), acceptance
`{ "cycleUnder2s": true, "under1MiBPer1000Lessons": false, "readableDiffs": true }`.

**Verdict: accepted with a documented deviation.** The cycle budget (≤ 2 s) is
met with large margin. The size budget is exceeded by **≈ +1.3 %** (1 062 110 B
vs 1 048 576 B per 1000 lessons). This is accepted deliberately: real scopes are
capped at `LESSON_LIMITS.total = 200` per scope
(`packages/shared/src/memory/types.ts`), so a bank is ≈ 85 KB in practice, and
the diffs stay human-readable. The spike therefore does **not** block the
feature; corpus sizes beyond the production cap are a separate measurement, not
part of the WP-01 acceptance.