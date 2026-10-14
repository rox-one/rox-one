# index.html startup JS closure — WP1/WP7 (2026-10-14)

Measured by `bun scripts/check-bundle-size.ts` (static `<script src>` + modulepreload closure of
index.html) on a Linux renderer build of main 3adaf11ca + #1890 (`vite build --sourcemap false`; source
maps are never measured).

| | raw | gzip | files |
|---|---:|---:|---:|
| before (3adaf11ca + #1890) | 4,190,622 B | 1,264,667 B | 48 |
| after (perf/startup-js-diet) | 3,985,031 B | 1,205,226 B | 51 |
| delta | −205,591 B (−4.9%) | −59,441 B (−4.7%) | +3 |

Recorded budget before this change was 4,173,986 B (main had already drifted 16.6 KB over it).

Moved out of the eager graph (all preloaded after first paint by `lib/idle-preload.ts`):
- chrono-node + react-day-picker + calendar: LabelValuePopover's date editor is now the lazy
  `label-date-editor.tsx`; vendor-dates is pinned to date-fns only.
- `@uiw/react-json-view`: JSONPreviewOverlay / ActivityCardsOverlay marked side-effect free (barrel-only).
- OnboardingDialog (AppShell), RoxCliCredentialStep (ChatDisplay), WorkspaceCreationScreen
  (+ @paper-design/shaders, AccountMenu): React.lazy.
- KnowledgeHome screen: its atoms/helpers moved to `knowledge-home-model.ts`, so the shell no longer
  imports the screen statically.

Attribution: `ROX_BUNDLE_REPORT=out.json [ROX_BUNDLE_REPORT_GRAPH=1] bun run electron:build:renderer`
then `bun scripts/bench/startup-closure-report.ts out.json`.

Why `useOnboarding` is 2 MB: it is not onboarding code. Rollup names the shared app-shell chunk after
its first module; it holds AppShell/ChatPage/FreeFormInput/product-tour etc. The remaining big eager
item is the chat stack (ChatPage is the static default route → Markdown → react-markdown, rehype-raw/
parse5, micromark, motion), kept eager on purpose for chat first paint.
