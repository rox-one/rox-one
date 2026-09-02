# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-09-02
- Primary product surfaces: Sessions, Map Canvas, Local Knowledge/Notes, embedded Browser, Tasks/Calendar, onboarding.
- Evidence reviewed: live Electron screenshots from 2026-09-02, `docs/superpowers/specs/2026-09-02-rox-local-first-platform-epic.md`, `apps/electron/src/renderer/pages/NotesPage.tsx`, `KnowledgeHome.tsx`, `KnowledgeNotebookTree.tsx`, `SessionWorkflowEditor.tsx`, and the current playground/visual baselines.

## Brand

- Personality: premium, calm, native macOS command center; sophisticated rather than generic "AI app".
- Trust signals: explicit state, readable Russian copy, visible ownership of local data, reversible actions, stable hierarchy.
- Avoid: opaque black rectangles, dev-overlay controls, unexplained AI jargon, fake provider/model badges, oversized pills, native controls embedded in premium surfaces.

## Product goals

- Make a session, knowledge note, task and browser context feel like one connected personal operating space.
- Make the local Markdown vault trustworthy and immediately useful even when optional services are unavailable.
- Preserve direct manipulation: write, link, comment, collapse, navigate, return to the same browser panel.
- Non-goals: imitate another product pixel-for-pixel; hide permissions, sync or AI processing behind ambiguous controls.
- Success signals: note creation never depends on SiYuan, a first-time user understands onboarding without AI knowledge, and navigation remains legible with multiple panels open.

## Personas and jobs

- Primary personas: Russian-speaking individual operators, researchers and builders; both AI newcomers and expert multi-agent users.
- User jobs: capture a thought; turn it into a linked note/task; inspect an agent session; maintain a reusable local knowledge base; coordinate work without losing context.
- Key contexts of use: macOS desktop, dense long-running workspace, narrow split panels, keyboard plus pointer.

## Information architecture

- Primary navigation: workspace sidebar → Sessions / Knowledge / Tasks / Browser / Settings.
- Knowledge note: collapsible vault/navigation rail → document outline → editor canvas → comments/metadata rail.
- Session Map is a pipeline trace/draft surface; it is not a document mode.
- Document modes are document-specific: read/write, outline, linked notes, comments, properties and history.

## Design principles

- One surface, one mental model: session controls never appear as document controls.
- Reveal complexity progressively: optional onboarding and side rails must collapse without deleting context.
- Treat structure as data: headings, tasks, links, comments and columns are actual document entities, not visual decorations.
- Tradeoff: native behavior and readable hierarchy take priority over maximal density.

## Visual language

- Color: graphite/dark neutral base, clearly separated elevated panels, one restrained Rox accent for active/primary state; errors are red but not glassy or noisy.
- Typography: prefer `Daytona W04 Condensed` when its licensed webfont asset is supplied; current system fallback chain is `TT Norms Pro Condensed`, `SF Pro Text`, `PingFang SC`, sans-serif. Do not pretend the requested condensed Daytona face is installed when it is not.
- Spacing/layout rhythm: 4/8px grid, document columns separated by subtle borders and deliberate gutters; no visually merged panes.
- Shape/radius/elevation: 6–8px controls, 10–12px floating surfaces, thin high-contrast border plus restrained shadow.
- Motion: 160–220ms ease-out for side rail collapse/expand; respect reduced motion.
- Imagery/iconography: thin Lucide-style icons with a contrast hierarchy; icons support labels rather than replace comprehensibility.

## Components

- Existing components to reuse: `NotesPage`, `NoteInspector`, `DropdownMenu`/`StyledDropdown`, `PanelSlot`, `SurfaceTabs`, existing annotation/highlight primitives, editor block model.
- New/changed components: optional onboarding rules editor; rule-label picker; document outline rail; comment threads rail; note breadcrumbs; collapsible/resizable knowledge rails; wiki-link creation controller; columns block.
- Variants and states: onboarding skip/add/edit; rule labels `Обязательно`, `Запрет`, `На усмотрение`, custom; comments empty/active/resolved; rail open/collapsed; note/link creation optimistic/saved/error.
- Token/component ownership: shared color/spacing/radius tokens remain in existing CSS/theme system; note-specific composition stays under `pages/notes` and `knowledge`.

## Accessibility

- Target standard: WCAG 2.1 AA for contrast and keyboard access.
- Keyboard/focus behavior: all rails, breadcrumbs, comment actions and rule labels have visible focus and semantic names; Escape closes transient menus, not a document.
- Contrast/readability: avoid gray-on-black body text; editor content and pane boundaries meet readable contrast.
- Screen-reader semantics: headings produce a navigable outline; comments announce selected ranges and resolution state.
- Reduced motion and sensory considerations: rail animations disable or shorten under reduced-motion preference.

## Responsive behavior

- Supported breakpoints/devices: desktop-first Electron, tablet split view, narrow panel/mobile fallback.
- Layout adaptations: left navigation collapses first, then outline/comments become overlay drawers; editor remains the persistent center column.
- Touch/hover differences: hover docks have accessible persistent alternatives; comment/menu actions stay tap-reachable.

## Interaction states

- Loading: skeleton/quiet progress, never an empty black pane presented as success.
- Empty: give one concrete next action in plain Russian.
- Error: say what failed, what remains local, and a recoverable next action; never expose raw timeout/internal channel names as primary copy.
- Success: short confirmation adjacent to the changed document/rule, not a global blocking modal.
- Disabled: explain why and what enables it.
- Offline/slow network: local notes keep working; optional cloud/sync state is clearly secondary.

## Content voice

- Tone: concise, human Russian for people unfamiliar with AI; calm, specific and non-patronising.
- Terminology: use `правило`, `заметка`, `ссылка`, `комментарий`, `сохранить`, `показать`; avoid unexplained `memory`, `lesson`, `kernel`, `runtime` in primary UI.
- Microcopy rules: describe effect first, use a verb for actions, name permanent/conditional scope explicitly.

## Implementation constraints

- Framework/styling system: Electron + React + Tailwind/Radix; reuse native component primitives before adding a new library.
- Design-token constraints: retain existing theme variables; add aliases rather than hard-code local hex shadows.
- Performance constraints: document opening and rail toggles must not trigger full vault scans; optional side rails are lazy.
- Compatibility constraints: Markdown, wikilinks, task lists, headings and frontmatter remain portable; SiYuan is optional/legacy only.
- Test/screenshot expectations: focused unit tests for document entities and state transitions; Electron typecheck/lint; renderer build; screenshot-backed smoke for onboarding and notes rails.

## Open questions

- [ ] License/asset source for `Daytona W04 Condensed`; current machine exposes only a Daytona W04 Fat Italic face, so the requested condensed face cannot yet be bundled honestly.
- [ ] Comment transport: local-first per-note comments versus cloud collaboration thread model; needs sync/collaboration wave contract.
- [ ] Multi-column Markdown serialization: decide portable fenced block syntax versus editor-only layout metadata before writes ship.
