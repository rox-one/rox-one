/**
 * Shared pool worker entry (ADR-0024). Bundled to
 * `apps/electron/dist/pool-worker.cjs` by scripts/electron-build-main.ts and
 * scripts/electron-dev.ts. Import only dependency-light handler modules here.
 */
import { defaultWorkerHandlers } from './handlers.ts';
import { runWorkerLoop } from './worker-runtime.ts';
import '../browser/history-worker.ts';
import '../skills/skill-index-worker.ts';

runWorkerLoop(defaultWorkerHandlers);

⚠ 1 unresolved conflict detected
- ours = HEAD
- theirs = cb2e01488 (perf(skills): incremental catalog index and skills:query (#1865))
NOTICE: Inspect a block by reading `conflict://<N>` (add `/ours` / `/theirs` / `/base` to render a single side). Resolve with `write({ path: "conflict://<N>", content })`, or bulk-resolve every registered conflict with `write({ path: "conflict://*", content })`. Writes replace ONLY the marker block (markers + all sides) — never repeat the lines before/after it; they stay in place.
`content` shorthand: a line that is exactly `@ours` / `@theirs` / `@base` / `@both` expands to that recorded section. `@both` is ours-then-theirs with no separator — only for additive conflicts where each side adds something different; NEVER for competing edits of the same lines (pick a side or write the combined text). Lines that are not a token pass through verbatim, so `"// keep both\n@ours\n@theirs"` literally writes the comment, then ours, then theirs.
Per-id bulk: `write({ path: "conflict://*", content: "1: @ours\n2: @theirs\n…" })` resolves each listed id with that side in ONE call — the cheapest way through many pick-one conflicts; unlisted ids stay registered.
Resolve each block faithfully: keep one side (`@ours`/`@theirs`), or combine them when both intents apply — never invent content beyond the recorded sides, and never stack both sides of competing edits. Resolve several conflicts in a single turn by issuing multiple `write` calls at once; ids stay valid as earlier blocks are resolved.

──── #1  L8-12 ────
<<< ours
import '../browser/history-worker.ts';
>>> theirs
import '../skills/skill-index-worker.ts';