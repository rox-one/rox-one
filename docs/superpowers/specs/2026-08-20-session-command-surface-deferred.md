# Session list as a command surface (deferred)

**Date:** 2026-08-20  
**Status:** Deferred — after compact chrome + native filter/display menus + slices  
**Repo:** `rox-one/rox-one`

This is **not** in the current implementation batch. It is the “большой редизайн сессий”: the navigator stops being a chat inbox with extra chips and becomes a **command surface** for work.

## 1. Why later

Points 1–2 (native menus + slices/quick grouping) already change chrome. A full session-row redesign touches `SessionList`, `SessionItem`, grouping, hover actions, density, and possibly selection/bulk. Doing it in the same PR would mix visual polish with a new information architecture.

## 2. Product picture (what it would feel like)

The middle column is still Sessions, but each row is a **work object**, not a transcript title:

- Leading: status glyph + optional project stripe (already exists; keep).
- Primary: title, one line.
- Secondary, on hover or in comfortable density: last activity, model, due, unread.
- Trailing, **only on hover / keyboard focus**: pin, more, open board card, assign project — never a permanent icon dump.
- Groups are first-class: sticky group headers with counts, collapse, “select group”.
- Empty groups (when enabled) are drop lanes, not dead space.

The header is a **toolbar of one cluster**: view cycle · group · display · filter/slices. No second personality between list and board.

## 3. Forks (pick one stack before building)

### 3.1 Density

| Option | Feel | Cost |
|--------|------|------|
| **A. Two densities** (`comfortable` / `compact`) in Display | Expensive apps do this; compact ≈ current, comfortable shows due/model | Small persistence field on `CollectionDisplay` |
| **B. One density, hover reveals meta** | Cleaner default; less settings | Hover is easy to miss on trackpad; keyboard needs equivalent |
| **C. Always-on meta chips** | Maximum information | Crowds 260px sidebar; we just escaped this |

**Recommend A**, default comfortable on desktop ≥280px, compact when navigator is squeezed.

### 3.2 Row actions

| Option | Feel | Cost |
|--------|------|------|
| **A. Hover trailing + `…` menu** (Linear) | Native, cheap | Need focus-visible parity |
| **B. Swipe / long-press (mobile-first)** | Good for webui compact | Extra gesture layer |
| **C. Command palette only** | Powerful, invisible | Bad for discovery |

**Recommend A + existing omnibox**, no swipe in v1.

### 3.3 Saved views vs smart views vs slices

Today: sidebar smart views (`ViewConfig` / filtrex) **and** collection filters **and** (now) slices.

| Option | Architecture |
|--------|----------------|
| **A. Unify**: slices *are* user smart views stored next to `ViewConfig` | One model, one sidebar list |
| **B. Keep two layers**: system smart views in the rail; user slices only in the filter menu | Least migration |
| **C. Replace smart views** with slices in the rail | Product change, risky |

**Recommend B for the next iteration, A as the real redesign.** Document A in this spec so we do not grow a third storage.

### 3.4 Grouping chrome

| Option | |
|--------|--|
| **A. Group-by lives only in Display + header Layers menu** (what 1–2 shipped) | Enough |
| **B. Inline group tabs** under the header (Status \| Project \| Due) | Faster, burns vertical space |
| **C. Board-like lanes inside the list** | Confuses list vs kanban |

**Recommend A**; B only if usage shows group-by is the #1 action.

### 3.5 Session as entity vs chat

| Option | |
|--------|--|
| **A. Row opens chat** (today) | No behavior change |
| **B. Row opens a workbench** (preview + chat + files) | Aligns with workbench v2; large |
| **C. Split: click title → chat, click status → board card** | Discoverable, extra targets |

**Recommend C as the redesign default**, B only behind workbench flags.

## 4. Configuration (when we build it)

Add to `CollectionDisplay` (workspace JSON, already versioned):

```
density: 'comfortable' | 'compact'
rowMeta: CollectionProperty[]   // subset shown as secondary line
hoverActions: boolean           // default true
```

Do **not** add a fourth localStorage map. Reuse `collection/display.json` and, for unified saved views (fork 3.3 A), the existing view-config store — not a new `collection-slices` forever.

## 5. Out of scope even then

- New collection layouts beyond list/board/table.
- Replacing kanban.
- Entity tabs (map/outline/graph) on an open session.

## 6. Exit criteria for the redesign

- A 260px navigator never shows a chip runway.
- Hover/focus always reveals at least one action on a session row.
- Group headers have counts and collapse without jumping scroll.
- Saved slices and smart views do not duplicate in two UIs (fork 3.3 resolved).
- Comfortable vs compact is a Display setting, not a hidden breakpoint-only behavior.

## 7. Suggested sequence after 1–2

1. Density + hover actions on `SessionItem` (fork 3.1 A + 3.2 A).  
2. Group header counts/collapse polish.  
3. Decision on 3.3 A vs B (unify storage).  
4. Click-target split (3.5 C) if workbench is stable.
