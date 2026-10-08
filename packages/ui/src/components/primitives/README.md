# Entity UI primitives (W1-08, #1505)

Entity-agnostic building blocks from UI-SPEC §4, exported from
`@rox/ui/primitives`. They render only through Rox tokens. Every visible
string goes through `t()` under the `entities.ui.*` namespace, in all 12
locales. None of them read feature flags: the entity-aware wrappers in
`apps/electron/src/renderer/components/entities/` own the gating.

| Primitive | File | Purpose / key props |
|---|---|---|
| `StatusBadge` | `status-badge/StatusBadge.tsx` | Glyph + text status, never colour-only. `status` ∈ `STATUS_BADGE_KEYS` (on_track, caution, off_track, pending, outdated, paused, achieved, completed, missed); `size` `sm`/`xs`. |
| `ProgressBar`, `PieProgress` | `progress-bar/ProgressBar.tsx` | `done/total` or `percent`, clamped 0–100 (`resolveProgressPercent`). ProgressBar has `role=progressbar`. |
| `PersonField` | `person-field/PersonField.tsx` | Champion / Reviewer (or custom `{label, help}`) picker with ⓘ help, search list (↑↓/Enter/Esc) and clear. `PeopleList`, `PersonAvatar` and `filterPeople` live alongside it. |
| `SubscribersPicker` | `subscribers-picker/SubscribersPicker.tsx` | Facepile plus a dialog with a multi-select people list and a "notify everyone" switch. |
| `ContextualDatePicker` | `contextual-date/ContextualDatePicker.tsx` | Day / Month / Quarter / Year tabs. Value `{precision, date}` is normalised to the start of the period (`normalizeContextualDate`) and formatted in UTC per locale. |
| `PrivacyField` | `privacy-field/PrivacyField.tsx` | Radio group of access levels. Space levels appear only with `spaceName`, link levels only with `includeLinkOptions`. Supports read-only. |
| `ReactionsBar` | `reactions/ReactionsBar.tsx` | Reaction chips (`aria-pressed`) plus a built-in quick palette; `applyReactionToggle` is the reducer. |
| `CommentsThread` | `comments/CommentsThread.tsx` | Threaded comments: reply, edit, delete (soft), and reactions. `renderBody` / `renderComposer` slots let a host plug in a rich editor; the default composer is a textarea (⌘/Ctrl+Enter sends). |
| `ActivityTimeline` | `activity-timeline/ActivityTimeline.tsx` | Groups events by day (today / yesterday) and renders them through per-type `renderers`, with a generic fallback. |
| `GanttView` | `gantt/GanttView.tsx` | Timeline shell: week / month / quarter zoom, today marker, and bars as buttons. Bars move with ←/→ or by pointer drag, calling `onReschedule`. Layout maths live in `gantt-layout.ts`. |
| `TreeTable` | `tree-table/TreeTable.tsx` | `role=treegrid` with aria-level / posinset / setsize / expanded; keys ↑↓→← and Enter. `rowProps(row)` attaches drag sources and context menus. |

Shared class tokens (`FOCUS_RING`, `MOTION_FAST`, `HOVER_TINT`,
`SELECTED_TINT`, `POPOVER_SURFACE`) are in `tokens.ts`. Motion is 120 ms
and switches off under `prefers-reduced-motion`.

Stories: playground → *Entity Lists* → `w1-08-*`
(`apps/electron/src/renderer/playground/registry/entity-primitives.tsx`).

Tests:
- `primitives/__tests__/primitives-helpers.test.ts` covers the helpers.
- `apps/electron/src/renderer/components/entities/__tests__/` holds the snapshots (light/dark × RU/EN) and the axe checks.
