# Boot-closure wave — 2026-10-14/15

Slices that move code out of `index.html`'s **preloaded** graph (`<script src>` + `<link rel="modulepreload">`
closure). The gate and the manifest live in `scripts/check-bundle-size.ts` / `scripts/boot-manifest.ts`;
each slice ships a source-level guard under `apps/electron/src/renderer/__tests__/boot-closure-*.test.ts`
so a static import cannot silently come back.

## Slices

| PR | What left the closure | Guard test |
|---|---|---|
| #2037 | `SendToWorkspaceDialog`, `CreateProjectDialog`, `SendResourceToWorkspaceDialog` — closed on first frame | `boot-closure-closed-dialogs.test.ts` |
| #2044 | `utils/text.ts` → remark/unified/mdast + `strip-markdown` (one synchronous preview line for OS notifications) | `apps/electron/src/renderer/utils/__tests__` |
| #2083 | the twelve date-fns locales (76 modules) — `getDateLocale` used to import `DATE_LOCALES`, pulling every language's `formatDistance`/`localize`/`match` | `packages/shared/src/i18n/__tests__/locale-registry.test.ts`, `lazy-locales.test.ts` |
| #2075 | `EditPopover` (1.1k lines) + `lucide/…/grip-horizontal` — AppShell kept seven closed popovers mounted | `boot-closure-edit-popover.test.ts` |
| #2094 | `WhatsNewSheet`, `SeChatPictureInPicture`, `SuperEngineeringOnboardingDialog`, `SuperEngineeringOnboarding` — the SE extras host is imported for every profile | `boot-closure-se-extras.test.ts` |

Branch-measured `index.html` startup deltas reported in the PRs: #2044 −98,888 B; #2037 −7,910 B;
#2083 −53,732 B; #2075 −5,999 B. #2094 was landed without a local renderer build (the box was
oversubscribed); its evidence is the `bootSources` membership of all four lazy targets.

## Where the closure stands

Measured on a branch renderer build (`boot-edit-popover` worktree, 2026-10-15 00:38 MSK — i.e. `main` +
the EditPopover slice, **before** #2083 landed):

```
index.html static closure: 55 JS files, 2,613,213 B
  first-party code  ≈ 1,473 KB over 707 modules
  node_modules      ≈   819 KB over 532 modules
```

Method: parse `dist/renderer/index.html` for the static closure, then attribute each chunk's byte size to
its `.map` `sources` proportionally to the on-disk size of those sources.

**Caveats.** The proportional attribution is a proxy, not `renderedLength`: files that are mostly erased
at build time (type-only modules such as `src/shared/types.ts`, 59.5 KB attributed / 210 KB on disk) and
binary assets (the two 466 KB avatar PNGs, emitted as separate files and *not* in the JS closure) are
over-attributed. Use it for ranking third-party code and runtime modules, not for exact first-party bytes.
The exact per-module numbers come from the Vite bundle report:

```
ROX_BUNDLE_REPORT=out.json ROX_BUNDLE_REPORT_GRAPH=1 bun run electron:build:renderer
bun scripts/bench/startup-closure-report.ts out.json
```

## Ranked remaining levers

Third-party code in the eager graph, with the module that owns each (from the same attribution):

| Bytes | Package | Reached from |
|---:|---|---|
| 126.5 KB | `react-dom` | irreducible |
| 45.2 KB | `i18next` | `@rox/shared/i18n/lazy` — eager by design |
| 32.7 KB | `tailwind-merge` | `lib/utils.ts` `cn()` — every styled component |
| ~62 KB | `zod` (v4 core + classic + json-schema-processors) | config/session validation reachable from boot |
| 24.6 KB | `buffer` | `bootstrap.ts` polyfill (`rendererGlobals.Buffer ??= Buffer`) |
| 23.5 KB | `filtrex` | views expression evaluator ← collection filters |
| 22.0 KB | `vaul` | `components/ui/drawer.tsx` |
| 19.4 KB | `sonner` | `components/ui/sonner.tsx` (root `Toaster`) |
| 11.2 KB | `@floating-ui/core` + `react-dom` | Radix popover/menu |

Date-fns still shows ≈118 KB in this build; #2083 removes the locale half of that (~76 modules) — the
remaining modules are `parse`/`format`/`startOfDay`/`formatDistanceToNowStrict` used by the session list
and label value popover, which are genuinely eager.

Largest first-party entries (attribution-adjusted ranking): `AppShell.tsx`, `App.tsx`,
`app-shell/SessionList.tsx`, `contexts/NavigationContext.tsx`, `components/ui/entity-list.tsx`,
`app-shell/SkillsListPanel.tsx`, `lib/personal-tasks.ts`, `platform/InspectorHost.tsx`. These are the app
core; shrinking them means moving *surfaces* (not leaf modules) behind routes, which is a product
decision, not a mechanical one.

## Not a lever

`assets/recorder-*.js` (1.38 MB) is **not** the meetings recorder. It is Rollup's shared chunk — 696
modules named after the first module in it — holding `ThemeContext`, `sonner`, Radix primitives, 153
lucide icons, shims and the meetings recorder together. Removing one importer does not remove the chunk
from the closure; shrinking it means changing chunking (or the modules that pull it in), not
lazy-loading a single file.
