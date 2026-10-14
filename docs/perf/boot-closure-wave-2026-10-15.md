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
| #2083 | the twelve date-fns locales (76 modules) — `getDateLocale` imported `DATE_LOCALES`, pulling every language's `formatDistance`/`localize`/`match` | `packages/shared/src/i18n/__tests__/locale-registry.test.ts`, `lazy-locales.test.ts` |
| #2075 | `EditPopover` (1.1k lines) + `lucide/…/grip-horizontal` — AppShell kept seven closed popovers mounted | `boot-closure-edit-popover.test.ts` |
| #2094 | `WhatsNewSheet`, `SeChatPictureInPicture`, `SuperEngineeringOnboardingDialog`, `SuperEngineeringOnboarding` — the SE extras host is imported for every profile | `boot-closure-se-extras.test.ts` |

Branch-measured `index.html` startup deltas from the PRs: #2044 −98,888 B; #2037 −7,910 B; #2083 −53,732 B;
#2075 −5,999 B. #2094 was landed without a local renderer build (the box was oversubscribed); its evidence
is the `bootSources` membership of all four lazy targets.

The regenerated manifest confirms the two largest slices are holding on `main`:

```
- src/renderer/components/ui/EditPopover.tsx          (#2075)
- node_modules/lucide-react/…/grip-horizontal.js     (#2075)
  (and no date-fns locale modules remain — #2083)
```

## Where the closure stands

Sourcemap renderer build of `main` @ `f1d1e2fb7` (the same build the #2104 re-record committed):

```
index.html static closure: 56 JS files, 2,639,304 B
  first-party code  ≈ 1,514 KB / ~700 modules
  node_modules      ≈   803 KB / ~500 modules
```

Method: parse `dist/renderer/index.html` for the static closure, then attribute each chunk's byte size to
its `.map` `sources` proportionally to the on-disk size of those sources. Exact per-module numbers come
from the Vite bundle report:

```
ROX_BUNDLE_REPORT=out.json ROX_BUNDLE_REPORT_GRAPH=1 bun run electron:build:renderer
bun scripts/bench/startup-closure-report.ts out.json
```

**Caveats.** The proportional split is a proxy, not `renderedLength`: modules that are mostly erased at
build time (type-only files such as `src/shared/types.ts` — 60 KB attributed against 210 KB on disk) and
binary assets (the two 466 KB avatar PNGs, emitted as separate files and *not* in the JS closure) are
over-attributed. Use it to rank third-party and runtime code, not to size first-party files exactly.

## Ranked remaining levers

Third-party code in the eager graph, with the module that owns it:

| Bytes | Package | Reached from |
|---:|---|---|
| 126.5 KB | `react-dom` | irreducible |
| 45.2 KB | `i18next` | `@rox/shared/i18n/lazy` — eager by design |
| **39.1 KB** | **`zod` v3 — `canvas-core`'s vendored copy** | **`vendor-zod` manual chunk: `manualChunks` keys on the package name, so the nested v3 copy is merged into the eager zod chunk** |
| 32.8 KB | `tailwind-merge` | `lib/utils.ts` `cn()` — every styled component |
| ~57 KB | `zod` v4 (core + classic + processors + util) | config/session validation reachable from boot |
| 24.6 KB | `buffer` | `bootstrap.ts` polyfill (`rendererGlobals.Buffer ??= Buffer`) |
| 23.5 KB | `filtrex` | views expression evaluator ← collection filters |
| 22.1 KB | `vaul` | `components/ui/drawer.tsx` |
| 19.5 KB | `sonner` | `components/ui/sonner.tsx` (root `Toaster`) |

The cleanest of these is the canvas-core copy: `packages/canvas-core/node_modules/zod/v3/**` is a lazy
package's dependency, but the prefix-based `manualChunks` rule (`/^(?:zod)$/ → 'vendor-zod'`) hoists it
into the chunk the boot graph already needs, so ~39 KB of a board-model dependency ships on every launch.
Splitting the nested copy into its own chunk (or dropping the nested install in favour of the root zod)
removes it from the closure.

First-party entries, attribution-adjusted: `AppShell.tsx`, `App.tsx`, `app-shell/SessionList.tsx`,
`contexts/NavigationContext.tsx`, `components/ui/entity-list.tsx`, `app-shell/SkillsListPanel.tsx`,
`lib/personal-tasks.ts`, `platform/InspectorHost.tsx`. These are the app core; shrinking them means moving
*surfaces* behind routes, which is a product decision rather than a mechanical one.

## Arrived in the closure since the last manifest (merges, not this program)

The #2104 manifest diff is the fastest way to see what came in eagerly while the program was running:

```
+ src/renderer/components/shell/{NotificationCenter,notification-sources,notifications}   (top50 #9)
+ src/renderer/components/shell/{SplitToggle,split-mode}
+ src/renderer/features/guided-tour/{GuidedTour,model,state}
+ src/renderer/pages/settings/{SettingsScreenSidebar,settings-sidebar}
+ src/components/glass/use-glass-motion.ts
+ packages/canvas-core/node_modules/zod/v3/**                                            (7 modules)
+ 10 lucide icons (bell, hand, wallet, store, puzzle, …)
```

NotificationCenter is the most attractive of these: `TopBar` imports it unconditionally, so the bell, its
popover, `notification-sources.ts` and the notification store all preload — the sources subscription does
have to stay eager (it collects while the panel is closed), but the panel UI does not.

## Not a lever

`assets/recorder-*.js` (1.38 MB) is **not** the meetings recorder. It is Rollup's shared chunk — 696
modules named after the first module in it — holding `ThemeContext`, `sonner`, Radix primitives, 153 lucide
icons, shims and the meetings recorder together. Lazy-loading one importer does not remove the chunk from
the closure; shrinking it means changing chunking, not moving a single file.
