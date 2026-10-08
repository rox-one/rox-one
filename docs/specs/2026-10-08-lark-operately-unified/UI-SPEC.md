# UI-SPEC: Rox Unified Suite (Lark + Operately UI merged onto the Rox shell)

**Version:** unified **v2**, 2026-10-08 (MSK) (v1 kept in `v1/`) · **Baseline:** `rox-one/rox-one` @ `aedff592` (read-only) · **Companions:** PRD (decisions ADR-U01…U20), DATA-MODEL, TECH-SPEC, PLAN.

## 0. How to read this document
- **Part A (this part)** is authoritative. It defines how every surface looks and behaves inside the Rox shell, which Rox UI is kept or replaced, and the merged Lark + Operately screens.
- **Part B** is the Phase-2 Lark UI-SPEC §2–§12, kept verbatim as the detailed reference for exact Lark menus, labels and measurements.
- **Part C** is the Operately UI spec (OPERATELY-SPEC §2–§7, §13), kept verbatim as the detailed reference for Operately screens.
- **Precedence:** Part A > Part B / Part C. Where Part B or C describe a Lark/Operately-only shell element (Lark slate rail, Operately top nav, Lark palette, Lark global search modal), **Part A §2–§3 replaces it**.
- **v2 additions:**
  - §2.6: profiles, motion tokens, help popovers;
  - §18: collaboration UI;
  - §19: cross-surface creation flows;
  - §20: personal Drive;
  - §21: onboarding + welcome DM;
  - §22: agent UI;
  - §23: invitations / placeholders;
  - §24: automations;
  - plus additions to §3.2, §12, §14, §15 and §16.
- **v2.1 additions** (Mark, 2026-10-08):
  - §25: the agent panel «@rox» on every surface (docking, states, motion, context contract, coexistence with quick and collaboration panels);
  - §26: surface chrome, i.e. the left sidebar and top bar per surface (matrices A and B);
  - §27: per-surface UX with ASCII wireframes, features, layouts and states;
  - §28: cross-functional capabilities X-13…X-26;
  - plus changes to §1, §3.3 and §15.

  §18–§24 are Part A and take precedence over any Part B / Part C description of comments, sharing or Drive.
- **Labels:** menu labels are given in EN exactly as Lark/Operately show them, then RU in «guillemets». RU is the default UI language; all 12 locales get keys.

**Screenshot references** (paths inside `lark-rox-unified.zip`):
- `screenshots/lark/{msg,docs,cmt,wiki,user}/<NN>-<name>.jpg`. Part B's `[S: msg/10]` = `screenshots/lark/msg/10-*.jpg`.
- `screenshots/operately/01-goal-overview.jpg`, `screenshots/operately/02-project-overview.jpg`.

Evidence tags: `[S: …]` screenshot, `[DOCS]` docs only, `[UNVERIFIED]`, `[ROX EXT]` Rox extension, `[OP]` Operately code, `[SHOT]` Operately user screenshot.

---

## 1. What existing Rox UI is kept vs replaced

| Existing Rox UI (file) | Decision | Notes |
|---|---|---|
| Mode rail + titlebar pill (`platform/modes-seed.ts`) | **KEEP**, add 4 modes (messenger 25, calendar 35, goals 45, contacts 55), flag-gated | No labelled Lark rail (ADR-U11) |
| Classic layout (default) / unified five-slot shell (flag-off) | **KEEP both**; each surface specifies both (§3.3) | `featureUnifiedShellAtom` stays false |
| Omnibox ⌘K (`platform/Omnibox*.tsx`, `omnibox-*.ts`) | **KEEP**, add category chips and providers | Replaces Lark's global search modal and Operately's quick search (S-10 #1) |
| Right action rail (`platform/InspectorActionRail.tsx`) | **EXTEND**: "+" menu gains Message, Doc, Goal, Project, Meeting; v2.1: a first item **@rox** (agent panel toggle and minimised pill, §25) | Same component |
| Inspector panel stack (`atoms/panel-stack.ts`) | **EXTEND** with panel kinds `chat.quick.*`, `chat.settings`, `chat.search`, `thread`, `task.detail`, `entity.preview`, `referenced-in` | Lark side panels = INSPECTOR |
| TasksPage + TaskSidebar + TaskDetail + QuickEntry (`pages/tasks/*`) | **EXTEND**: sidebar gains Lark sections; TaskDetail becomes the merged detail pane; QuickEntry reused for `/task` and "+ Create task" | Things views unchanged |
| NotesPage, NotesViewHost, NoteInspector, TipTap editor (`pages/notes/*`, `packages/ui/src/components/markdown/*`) | **EXTEND**: Docs home view; Lark doc chrome (header/Share/···/TOC/comments) wraps the same editor; collaboration extension added | No editor fork (S-10 #9) |
| ProjectInfoPage, ProjectRoadmapPage, ProjectTimeline (`pages/project/*`) | **REPLACE the Info page layout** with the Operately project page; roadmap/timeline/requirements/AI move to the "Workspace" tab unchanged | OKR section moves to goals (links) |
| MeetingsPage + MeetingsSidebar | **EXTEND**: Lark landing (Start / Join), in-call UI | Local capture flows unchanged |
| InboxPage + InboxSidebar + mail views | **EXTEND**: views Review, Notifications, Mentions; Mail gets the Lark client layout | Existing kinds unchanged |
| FeedPage | **EXTEND**: Team tab renders domain activity grouped by day | — |
| HomeFrontPage | **EXTEND**: Operately home widgets + Workplace Apps section | Quick task input (#1091 restyle) kept |
| SearchPage | **BECOMES** Advanced search (⌘⇧F) | — |
| Dossier extra screen | **BECOMES** Contacts › Dossier view | Data migrated (MIG-06) |
| `components/calendar/CalendarStatusStrip` | **KEEP** in Tasks/Focus; real data from Calendar | — |
| Settings pages | **EXTEND** (Notifications, Messenger, Calendar accounts, Directory) | — |

## 2. Tokens: mapping Lark and Operately onto Rox
Rox tokens (`packages/ui/src/styles/index.css`) are the only colour source. The Lark sampled hex (Part B §2.2) and the Operately tokens (Part C §2.1) are **design intents** mapped to Rox variables. Dark theme follows Rox.

| Intent (Lark / Operately) | Rox token |
|---|---|
| Lark `rail.bg` #465069 / Operately top nav | existing rail surface `--surface-rail` (no slate frame) |
| Lark `primary` #1456F0 / Operately `brand-1` #3185FF | `--accent` |
| Lark `primary.subtle.bg` #D3DEF6 / #E6F0FF, `list.row.selected.bg` #E3EDFC | `color-mix(in oklch, var(--accent) 14%, var(--background))` (selected), 8% (hover) |
| Lark `filter.bg` / `sidepanel.bg` #F8F9FA | `--navigator` / `--surface-elevated` |
| Lark `list.bg` #FCFCFC, `pane.bg` #FFF | `--paper` / `--background` |
| Lark `text.primary/secondary/tertiary` | `--text-primary` / `--text-secondary` / `--text-muted` |
| Lark `border` #DEE0E3 / Operately `stroke-base` | `--border-subtle` |
| Lark `danger` #F54A45, `rail.badge` | `--destructive` |
| Lark tags BOT / Agent / Public / Official / External | `--status-warning` / purple accent / `--status-info` tints (10–14% bg + 600 text) |
| Operately `surface-bg` warm cream | **not adopted** (Rox `--canvas`) |
| Operately page card (white card on bg, max-w-6xl) | Rox MAIN content max-width 1152 (= max-w-6xl) on `--paper` |

**Status badge colours** (Operately set, ADR-U07):

| Key | EN | RU (PRD §11 #4) | Rox token | Icon |
|---|---|---|---|---|
| on_track | On track | По плану | `--status-success` | ● |
| caution | Caution | Внимание | `--status-warning` | ● |
| off_track | Off track | Отстаёт | `--status-danger` | ● |
| pending | Pending | Не начато | `--status-info` | ● |
| outdated | Outdated | Устарело | `--status-neutral` | ● |
| paused | Paused | На паузе | `--status-neutral` | ⏸ |
| achieved / completed | Achieved / Completed | Достигнуто / Завершено | `--status-success` | ✓ |
| missed | Missed | Не достигнуто | `--status-danger` | ✕ |

**Task status colours:** gray → `--status-neutral`, blue → `--status-info`, green → `--status-success`, red → `--status-danger`. Amber and purple are extra custom colours.

**Dimensions:**
- **Adopted from Lark** (Part B §2.1, "Adopted" column): chat row 60, side panel 328, task detail 560, docs sidebar 280, doc body 768, menu item 32, dialog widths, composer min 48, search chips.
- **Not adopted:** rail 148 (ADR-U11) and messenger filter 148 → NAVIGATOR 220 (collapsible to 56).
- **Typography:** Rox Inter (`--font-sans`); the Lark sizes in Part B §2.3 apply.
- **Operately elements adopted:** section header pattern (bold 18 title + xxs ghost "Edit/Add" button), sidebar person fields (avatar 32 + bold name + dimmed title), tabs with count chips and an animated underline (200 ms).

### 2.6 v2: UI profiles, motion tokens and help popovers (omp remarks #1, #2, #9)

**Profiles.** Every v2 screen renders through Rox tokens only, so it works under both profiles with no forked components.

| Profile | Theme id | Character | Default? |
|---|---|---|---|
| Rox (default) | `rox-light` / `rox-dark` | light, compact / condensed, Inter + Rox Mono for numbers / code | **yes** |
| super.engineering | `super-engineering` (`uiProfile='se'`) | dark glass agent-IDE, translucent panels, denser chrome | opt-in (Settings → Appearance) |

The SE profile overrides token values only: `--surface-*`, `--border-subtle`, `--paper`, the blur (`--glass-blur`, 0 in Rox) and radius tokens. Component code never checks the profile. Screenshot tests for v2 screens run in both profiles (TECH-SPEC §7).

**Motion tokens** (added to `packages/ui/src/styles/index.css` if not present):

| Token | Value | Use |
|---|---|---|
| `--motion-instant` | 80 ms | hover tint, checkbox tick |
| `--motion-fast` | 120 ms | popover / menu open, chip appear |
| `--motion-base` | 200 ms | panel slide, tab underline, card expand |
| `--motion-slow` | 320 ms | page-level transitions, drawer, onboarding steps |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | entering |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | leaving |
| `--ease-spring` | framer-motion spring `{stiffness: 420, damping: 34}` | drag-and-drop settle, cursor label |

`prefers-reduced-motion: reduce` turns transforms into 0-duration opacity changes (≤ 80 ms). Remote cursors then jump rather than glide.

**Help popovers («Справка»).** A ⓘ button (16 px, `--text-muted`, hover `--text-secondary`) next to every metric or policy. It opens a 320-wide popover containing:
- **Definition**;
- **Units**;
- **Formula** (in Rox Mono);
- **Source** (which data);
- **Example**;
- a "Learn more" link to the guide doc.

Popovers open on click (not hover), close on Esc or click-outside, and are keyboard reachable. Instances in v2: quota (§20.7), approval classes and rate limits (§22.5), read receipts (§18.8), rule idempotency (§24).

## 3. Shell

### 3.1 Rail (modes)

| Order | Mode | Icon (lucide) | RU / EN label (tooltip) | Badge | Flag |
|---|---|---|---|---|---|
| 10 | home | `house` | Главная / Home | — | — |
| 20 | chat | `message-square-text` | Чат / Chat | unread agent replies | — |
| 25 | **messenger** | `messages-square` | Мессенджер / Messenger | unread total (red), mentions | `workbench.mode.messenger.v1` |
| 30 | meetings | `video` | Встречи / Meetings | live call dot | existing |
| 35 | **calendar** | `calendar-days` | Календарь / Calendar | today's next event time (tooltip) | `workbench.mode.calendar.v1` |
| 40 | tasks | `circle-check` | Задачи / Tasks | Today count | existing |
| 45 | **goals** | `target` | Цели и проекты / Goals & Projects | — | `workbench.mode.goals.v1` |
| 50 | notes | `file-text` | Документы / Docs | — | existing (relabel; PRD §11 #2) |
| 55 | **contacts** | `contact` | Контакты / Contacts | new contact requests | `workbench.mode.contacts.v1` |
| 60 | feed | `rss` | Лента / Feed | — | existing |
| 70 | inbox | `inbox` | Входящие / Inbox | waiting count + **Review** count | existing |

### 3.2 Global create (right action rail "+" and ⌘N in the shell)
The menu adds the Lark ⊕ items. Order:
1. New session («Новая сессия»)
2. **New message** («Новое сообщение»: New Chat / New Group / New Channel ›)
3. New task («Новая задача»)
4. New doc («Новый документ» ›: Doc · Note (private) · Base · Form · Mind map · Folder)
5. New event («Новое событие»)
6. **New meeting** («Новая встреча»: Start now / Schedule)
7. **New goal** («Новая цель»)
8. **New project** («Новый проект»)
9. **New space** («Новое пространство»)
   - v2: **New team…** («Новая команда…», §23.1)
   - v2: **Upload to Drive** («Загрузить на диск», §20.4)
10. — divider —
11. Invite people («Пригласить людей»)
12. Browser
13. Terminal

Each item is hidden while its flag is off.

### 3.3 Layouts per surface

| Surface | Classic layout (default) | Unified five-slot (flag) |
|---|---|---|
| Messenger | Mode sidebar (280): collapsible **Filter** header (Chats, Unread, Flagged, Mentions, Labels, DMs, Groups, Docs, Threads & Topics, Done) + chat list below; main = conversation; quick panels slide in at the right (328) | NAVIGATOR 220 = filter column (collapse → 56 icons); COLLECTION 320 (264–420) = chat list; MAIN = conversation; INSPECTOR 328 = quick panels / settings / thread |
| Docs | Mode sidebar (280) = Docs sidebar (Search, Home, Drive, Wiki, Pinned Wiki, Folders, private vault tree); main = Docs home / doc; TOC inside main; comments panel in the right panel | NAVIGATOR = Docs sidebar; COLLECTION hidden for docs (shown for folder listings); MAIN = doc; INSPECTOR = comments / doc details / Referenced in |
| Tasks | Sidebar (224, Lark width) = merged Things + Lark sidebar; main = list/board; detail pane 560 on the right | NAVIGATOR = sidebar; MAIN = list/board; INSPECTOR (560 override) = detail |
| Goals & Projects | Sidebar (240): Work Map, My work, Goals, Projects, My OKRs, Alignment, Reviews, Spaces ▸ (list), KPIs, Templates; main = page | NAVIGATOR = same list; MAIN = page; INSPECTOR = Referenced in / activity (optional) |
| Calendar | Sidebar (240) = mini month + calendars + rooms; main = grid | NAVIGATOR = sidebar; MAIN = grid; INSPECTOR = event detail |
| Contacts | Sidebar (280) = Lark Contacts list (+ Directory, Org chart, Dossier); main = list/profile | NAVIGATOR / COLLECTION / MAIN |
| Inbox (Review) | Existing InboxSidebar + new views | unchanged mapping |

**v2.1:** with `workbench.chrome.surfaces.v1` on, §26 (left sidebar and top bar per surface) and §27 (per-surface wireframes) refine this table. Widths in §26.2 take precedence.

### 3.4 Omnibox (⌘K) categories
- **Placeholder:** «Поиск по сообщениям, документам, задачам, целям, проектам, людям…» (EN "Search messages, docs, tasks, goals, projects, people…").
- **Chip row:** All · Messages · Docs · Tasks · Goals · Projects · Milestones · Check-ins · Spaces · People · Calendar · Files · Bases · Mail · Sessions · More ▾. **More ▾** opens Settings for reorder/hide (Lark behaviour, `msg/06`).
- **Empty query:** "Frequently used" (Lark), then the existing Omnibox commands.
- **Results:** grouped, 5 per group, with "Show all in Advanced search ⌘⇧F" (Operately footer "Search all content for "%{query}"").
- **Row:** EntityChip (icon + title) + container (space › project) + kind label + status chip if any. ↵ opens, ⌘↵ opens in a new tab, ⌥↵ inserts a reference into the focused composer or editor.

## 4. Shared components (wave 1, `packages/ui` + `apps/electron/src/renderer/components/entities/`)

| Component | Spec |
|---|---|
| **EntityChip** | Inline 20px pill: kind icon 14 + title (max 240, ellipsis) + optional status dot. Hover after 300 ms opens the HoverCard; click opens the route; ⌘-click opens a new tab. No access: lock icon + "Restricted" («Нет доступа»). Deleted: strikethrough + "Deleted". Moved: follows `movedTo` transparently |
| **EntityHoverCard** | 320 wide, radius 8, shadow-popover: header (icon, title, kind, container); body = kind-specific preview (PRD §7.6); footer actions (max 3) |
| **EntityCard** | Chat/doc embed version of the preview (max 420), live-updating; actions per PRD §7.6 |
| **ReferencedIn** | Section «Упоминается в» / "Referenced in": grouped by kind (Chats, Docs, Tasks, Goals, Projects, Meetings, Other), counts, rows = EntityChip + relation label + time; "Show all" → inspector panel `referenced-in` |
| **EntityPicker** | 560 dialog: search input "Find anything in Rox…" «Найти объект в Rox…», kind filter chips (as Omnibox), recent items, keyboard nav; returns `kind:id` |
| **MentionMenu** (TipTap suggestion) | `@` = people first, then entities; `[[` = docs first, then any; `#` = tags (notes) |
| **StatusBadge** | §2 table; sizes sm (chip) / xs (dot + label) |
| **StatusPicker** | Popover listing On track / Caution / Off track (+ Pending for new) with Operately descriptions (Part C §3.1), `%{reviewer}` replaced by the reviewer's first name |
| **PersonField** | Avatar 32 + bold name + dimmed title; empty state "Set champion" etc.; picker with directory search; ⓘ tooltip text from Part C (Champion: "Responsible for … progress", Reviewer …) |
| **ContextualDateField** | Calendar popover with tabs Day · Month · Quarter · Year; display "Mar 5", "March 2026", "Q2 2026", "2026"; "Set date" placeholder (SHOT) |
| **PrivacyField** | Options (Operately labels): "Only invited people" · "Everyone in ⟨space⟩ can view / comment / edit" · "Everyone in the company can view / comment / edit"; docs add Lark link options |
| **CommentsSection** | Flat list (Operately) + optional reply threads (Lark docs); composer = TipTap minimal (Aa ☺ @ 🖼 📎 ➤, Lark task composer); reactions per comment; edit/delete own |
| **ReactionBar** | Emoji chips with counts; "+" opens emoji-mart |
| **ActivityTimeline** | Day-grouped events (Operately feed; Lark task "Comment" activity lines); renderer per `domain_event.type` |
| **SidePanelFrame** | Lark 328 panel: title 16/600, header link, ×, create card, list, empty / loading / error states (Part B §4.4) |
| **GanttView** | Shared view type (ADR-U10): month grid, "Today" marker, bars with status colour, drag to reschedule (emits commands), zoom Week / Month / Quarter. Label «Гантт» |
| **PieProgress** | 16/20px pie (Operately target and milestone progress) |
| **AuthorityBadge** | Tiny label on private notes/tasks: «Личное» (local) vs space name (workspace); tooltip explains sharing |

## 5. Messenger (mode `messenger`): Part B §4 adapted

**Kept verbatim from Part B §4:**
- filter items and order;
- chat row anatomy and the row context menus (1:1/bot and pinned group);
- header variants and icons;
- native side panels: Tasks, Search in chat, Settings 1:1/group, Group Settings sub-panel with all permission selects and system lines;
- chat tabs and Add tab dialog;
- message area (dividers, cards, bubbles, reply quote, voice, agent extras);
- hover toolbar and More menu;
- composer (buttons, formatting bar, Expand post editor, emoji picker);
- group creation, Add members dialog, channels and topic groups, states table, shortcuts.

**Deltas (Part A wins):**
1. **Layout** per §3.3. The Lark slate frame and 6px card gaps are replaced by Rox panel borders (`--border-subtle`).
2. **Filter list** gains **Spaces** (space chats, after Groups) and **Bots & Agents** (after DMs). Each is hidden by default in the filter manager (⚙) and enabled by the user.
3. **Chat header** (all variants): 🔍 Search in chat · 📝 Docs · ✔ Tasks · 📅 Calendar · 👥 Contacts · 🎥 Call · ⚙ Settings / ···.
   - Space chats add a 🎯 **Goals** button, which is hidden by default ("Edit header buttons").
   - The panels follow Part B §4.4 with the PRD §7.8 changes.
4. **Space chat header:** the subtitle shows "Space · N members" and a space chip linking to the space page. Default tabs: Chat · Goals · Projects · Tasks · KPIs · Docs (PRD §7.7).
5. **Entity-discussion chat** (from "Discuss in chat"):
   - The header shows the entity chip ("About: ⟨goal⟩"), and the default tabs are Chat · ⟨entity⟩.
   - The first system line reads «Чат создан для обсуждения ⟨entity⟩» ("Chat created to discuss ⟨entity⟩").
6. **Composer:**
   - The ⊕ More menu follows PRD §7.4 (Lark 8 items, divider, **Create**: Meeting, Event, Goal, Project, Milestone, Check-in, Base record, then **Link Rox item…**).
   - The `/` slash palette (PRD §7.3) is a 360-wide popover above the composer. Rows show icon, command, description (RU/EN) and shortcut hint. Typing filters; ↑↓/↵ select; Esc closes.
   - **Command arguments are parsed inline:**
     - `@person` → assignee / attendee;
     - natural-language dates (existing `quick-entry.ts` RU/EN parser);
     - `#list` → task list;
     - `~project` → project.
   - Before submit, a preview chip row shows the parsed values. For example, `/task Купить домен @Анна завтра` shows chips [Задача] [Анна] [Завтра] above the composer, and ↵ creates.
7. **Unfurl:** a pasted Rox link becomes an EntityCard below the message text. The ✕ on hover removes the preview (message-level `unfurl:false`).
8. **Message More menu:** PRD §7.5 additions after Export to Docs: **Create ▸**, **Link to ▸**, **Ask Rox**, **Copy as reference**.
   - Create ▸ opens the same prefilled creators as the slash commands, with the message text as title / description and the message as `derived-from`.
9. **Ask Rox:**
   - It opens the Chat mode with a new session (title = first 60 chars). The selected messages are attached as context mentions `[channel-message:…]`.
   - A private system line in the chat (visible only to the user) reads «Открыта сессия Rox ↗».
   - If the user chooses "Share answer", the session card is posted back.
10. **Agent chats (bot DMs):**
    - They keep the Lark agent look (`msg/34–36`): reasoning block, compaction bubble, Chat · File · Docs tabs.
    - The header adds "Open session ↗" (opens the bound AI session in Chat).
11. **States added:**
    - **Pending sync:** a clock glyph on own message; tooltip «Ожидает отправки».
    - **Bridged chat:** a header tag "Telegram" / "Lark" etc., with tag style External.
    - **No server:** an empty state «Мессенджеру нужен подключённый сервер рабочего пространства» with a [Подключить] button that opens Settings › Workspace.

**Transitions:**
- Selecting a chat updates the URL `messenger/{chatId}`.
- Opening a quick panel pushes the inspector panel kind (`chat.quick.tasks`) and remembers it per chat (`chat_member.open_panel`).
- Clicking an EntityCard navigates to the entity in the same tab. ⌘-click opens a new tab. ⌥-click opens it in the inspector "entity.preview" panel without leaving the chat.

## 6. Docs (= Notes, mode `notes`): Part B §5 adapted

### 6.1 Sidebar (280), top to bottom
1. 🔍 Search («Поиск»), which opens the Omnibox scoped to Docs.
2. ⌂ **Home** («Главная»).
3. ◎ **Drive** («Диск»).
4. ▤ **Wiki** («Вики»).
5. **Pinned Wiki** (list).
6. **Shared folders** («Общие папки»): space folders, goal / project folders.
7. **My notes** («Мои заметки»): the **existing vault tree**, unchanged. It includes Daily, templates, projects folders and keeps the existing note views switcher (document / table / base / canvas / outline / graph).
8. Footer: Trash («Корзина»), Templates («Шаблоны»).

### 6.2 Docs home (Part B §5.1, `docs/01–09`)
- **Kept:** the three action cards (**New**, **Upload**, **Templates**), tabs **Recent · Owned by Me · Shared With Me · Favorites · +**, Filter, Display Settings, list/grid toggle, table columns **Name · Location · Owner · Created · Recent ↓**, row hover ···, right-click menu.
- **Rox rules:**
  - Private notes appear in Recent and Owned by Me with an **AuthorityBadge «Личное»**. Location = vault path.
  - Shared docs show the folder / space path.
- **＋New menu** (Part B §5.1 order, adapted):
  - Docs («Документ», shared if created in a shared folder, otherwise private);
  - Note («Заметка», always private Markdown);
  - Base;
  - Form;
  - MindNotes («Майнд-карта»);
  - Folder;
  - *Applications*: Board (Excalidraw), Flowchart (mermaid).
  - Sheets and Slides are hidden (out of scope).

### 6.3 Document page
- **Kept from Part B §5.2:** header (breadcrumb, title, last modified, Share, mode menu Editing ▾, 🔔, ···, ＋), ··· menu items and submenus, Share popover, Permission settings dialog, block handle menu, Insert Below taxonomy, selection toolbar, block style menu, search palette ⌘F (in-doc find; Lark's ⌘J is reassigned to the agent panel in v2.1, §15), doc footer (like + comment box), TOC column, comments.
- **Two states:**
  - **Private note** (`authority=local`):
    - The header shows the AuthorityBadge «Личное». **Share** opens the Share popover with only one primary action at the top: **«Сделать общим документом…»** ("Move to shared Docs…"). The Lark invite field and link settings are disabled until the doc is moved, with the tooltip «Сначала переместите заметку в общие документы».
    - Comments use the existing inline markers.
    - No presence avatars are shown.
  - **Shared doc** (`authority=workspace`):
    - The full Lark Share popover and Permission settings apply.
    - Presence avatars (max 5 + "+N") sit left of Share. Remote cursors show name flags.
    - The comments panel holds anchored threads.
    - Version history comes from the ··· menu: "Version history" («История версий») lists `doc_snapshot` versions (Operately "Compare" and "Restore").
- **Move to shared Docs dialog** (560), MIG-10:
  - Title «Переместить в общие документы» / "Move to shared Docs".
  - Body:
    - «Заметка станет общим документом с совместным редактированием. Файл Markdown останется в хранилище как копия только для чтения и будет обновляться автоматически.»
    - «Комментарии (N) будут перенесены.»
    - «Ссылки на заметку продолжат работать.»
  - Fields:
    - **Location** («Расположение»): folder picker, defaulting to "My shared docs" or the current space folder;
    - **Share with** («Доступ»): people / chat / space picker;
    - **Link access**: Off · Org can view · Anyone with the link (policy-gated).
  - Buttons: **Cancel** · **Move** («Переместить»).
  - Progress: a spinner, then the toast «Документ перемещён. Теперь его можно редактировать вместе.» with an [Open] button.
- **Read-only mirror state** (the local `.md` opened from the vault after migration): a banner «Это копия общего документа ⟨title⟩. Изменения вносите в общем документе.» with [Open shared doc]. The editor is read-only.
- **Reverse:** ··· › "Move back to private" («Вернуть в личные заметки»). It is enabled only for the owner when there are no other editors.
- **Mentions:**
  - `@` people / entities and `[[` docs / any entity insert EntityChips.
  - A pasted Rox link becomes a chip, or a card when alone on a line ("Display as: Chip · Card", Lark-style link display menu).
  - `/` slash palette Insert Below gains **Rox ▸** Task list (embedded live task list view), Goal card, Project card, KPI chart, Base view, Calendar agenda, Chat card.
- **Sidebar right panel tabs** (inspector): Comments · Details (owner, created, location, authority) · Referenced in.

### 6.4 Wiki, Drive, posts, Docs & Files
- **Wiki** (Part B §5.3): space cards; tree with node ··· menu and +; space info. Wiki pages are `note` (subtype `wiki-page`, shared).
- **Drive:** a folder listing in the Docs home table layout.
  - Row types: doc, note (private shortcut), file, link (Operately link types with brand icons), base, folder.
  - Upload ▾: Upload file / Upload folder / Import.
  - **Add link** dialog (Operately): URL, Title, Type (auto-detected), Description.
- **Docs & Files** tab on goal / project / space pages: the same Drive listing component bound to the owner's root folder.
  - Its header "Docs & Files" carries the buttons **+ New ▾** (Document · Folder · Upload file · Add link) and **⋯** (Copy folder link).
  - Operately "drafts" are listed under a "Drafts" chip.
- **Discussions** (posts, `note` subtype `post`):
  - **List:** a card per post (title, author avatar, excerpt, comment count, date), filters All / Drafts, button **New discussion** («Новое обсуждение»).
  - **Editor:** title + body (TipTap); "When I post this, notify: Everyone / Only the people I select / No one" (Operately subscriber picker); buttons **Post** · **Save as draft** · **Schedule ▾**.
  - **Post page:** title, author, body, reactions, comments, subscribers footer.
  - On publish, a post card goes into the space chat (or the goal/project's linked chat if one exists).

## 7. Tasks (mode `tasks`): Things + Lark (Part B §10) + Operately (Part C §5.8)

### 7.1 Sidebar (224; Lark width; sections collapsible)
1. **Quick Entry** button "+ New Task ▾" at the top (Lark split button; menu: **New Task** Ctrl+N, **New Task List** Ctrl+L). The existing ⌘N Quick Entry stays bound.
2. **Planning (Things):** Входящие · Сегодня (+ Этот вечер) · Планы · В любое время · Когда-нибудь · Журнал · Корзина. These are existing items with the existing counts.
3. **Lark:** 👤 Owned («Мои», count) · 🔖 Subscribed («Подписки») · 🕘 Activities («Активность») · ⛓ Connect Agents («Подключить агентов»).
4. **▾ Quick Access:** All Tasks · Created · Assigned · Completed (EN Lark labels; RU «Все задачи · Созданные мной · Назначенные мне · Завершённые»).
5. **Task Lists** («Списки задач») **+**:
   - list groups (former Things areas, collapsible) containing lists (former Things projects, with progress pie);
   - shared lists show a people glyph;
   - project boards appear under a group **Projects** («Проекты») and space boards under **Spaces**, both read-only placement.
6. **+ New Group** («+ Новая группа»).
7. **Tags** (Things tags; collapsible).

Flag `tasks.lark.v1` off: the sidebar is exactly today's Things sidebar (sections 3–6 hidden, Things "Areas/Projects" labels kept).

### 7.2 Main area
- **Header:** title (current view), **New Task ▾** (primary), view tabs:
  - Things views: List only (existing UI, unchanged).
  - Lark views (Owned / Quick Access / task lists): **List | Kanban | Table | Gantt**.
  - Project / space boards: **List | Board** (Operately naming) + Gantt.
- **Toolbar (Lark):** + New Task ▾ · **Ongoing ⇄** (Ongoing / Completed / All Tasks) · **Filter** · **Sort by: …** · **Group by: …** · **Customize**.
  - Fields, options and columns are exactly as Part B §10.1, plus these Operately fields, appended:
    - Filter fields: **Status**, **Priority**, **Size**, **Milestone**, **Project**, **Space**, **Assignee**.
    - Sort by: **Priority**, **Status**.
    - Group by: **Status**, **Priority**, **Milestone**, **Assignee**, **Task List**, **Section**.
    - Customize columns: **Status**, **Priority**, **Size**, **Milestone**, **Project**, **Space**, **Assignees**.
- **Operately Display menu** (project / space boards): List | Board · ☐ Show closed statuses · **Manage statuses…** («Настроить статусы…»).
- **Rows:**
  - Lark row (Part B §10.1): ○ checkbox, title, subtask count, Start, Due, task list chip, creator, created at.
  - The checkbox reflects the status: an open status shows an empty circle; in-progress shows the Operately half circle; done ✓; canceled ✕.
  - With the Status column on, a StatusBadge-style task status chip is shown. Priority glyphs: urgent ‼ red, high ↑ orange, normal –, low ↓, none blank.
- **Kanban / Board:**
  - Lark Kanban groups by the chosen Group by (default "Custom Group" = sections).
  - Operately Board = columns per status of the effective status set, with a column count and "+" per column. Cards show title, assignee avatars, due, priority glyph, milestone chip. Drag between columns = `task.set_status`.
  - "Show closed statuses" toggles the Done / Canceled columns.
- **List grouped by milestone** (project Tasks tab default): groups "⚑ ⟨Milestone⟩ (due) n/m" + "No milestone"; group header ⋯ → Open milestone.
- **Gantt:** start → due bars (tasks without a start use due − 1 day); dependencies (`blocks`) drawn as arrows; milestones as ◆.
- **Things views** keep their exact current UI. A Things-view row for a shared task gets small assignee avatars and the status chip only when the status is not pending/done.

### 7.3 Detail pane (560; merged Lark `cmt/28` + Operately task page)
Top to bottom:
1. **Header:** **✓ Mark Complete** (outline primary; becomes "Reopen" when closed) · 🔖 Subscribe · ⇪ Share · ⧉ Copy link · ··· · ×.
   - The ··· menu is Operately's: Copy URL · Move to… (list / project / space) · Duplicate · Archive · Delete, plus Rox items Convert to project · Delegate to agent («Поручить агенту», existing) · Discuss in chat.
2. **Title** (20/600, inline edit). Chip "Created in ⟨origin⟩" = an EntityChip of the `origin` (e.g. the chat message), Lark "Created in Rox".
3. **Field grid** (label 96 + value; Operately sidebar fields merged with Lark):

   | Field | Notes |
   |---|---|
   | Status | status picker of the effective set |
   | Assignees | Lark "owner chip" → multi-person field |
   | Due date | Lark chips Today / Tomorrow / Other + contextual precision; start date via "Other" |
   | Priority | none / low / normal / high / urgent |
   | Size | xs–xl |
   | Milestone | |
   | Project | |
   | Task lists | chips + "+ Add to Task List"; section ▾ per list |
   | When | Things: Today / Evening / Someday / date; personal to the viewer |
   | Reminders | Things reminder time + Operately rules: Before due (N days) / On due day / When overdue / On date |
   | Repeat | |
   | Tags | |
   | Custom fields | |

4. ≡ **Description** (TipTap; Markdown for private tasks).
5. ⊢ **Sub-tasks** (+ Add Sub-task) and ☑ **Checklist** (existing Things checklist).
6. 📎 **Attachments** (+ Add Attachment).
7. **Dependencies:** Blocked by / Blocking.
8. **Referenced in.**
9. **Comments & activity** (Lark "Comment" section + Operately timeline): CommentsSection interleaved with ActivityTimeline lines ("Anna changed status to In progress · 10:24").
10. **Footer:** composer "Add a comment" (Aa ☺ @ 🖼 📎 ➤) and **Add Subscribers** (subscriber avatars).

**Private task variant:** comments, subscribers and assignees are replaced by the note «Личная задача. Назначьте участника или добавьте в общий список, чтобы работать вместе.» with an [Share…] button.

### 7.4 Dialogs
- **Share prompt** (triggered by assigning someone, adding to a shared list/project/space, or Share):
  - Title «Сделать задачу общей?»
  - Body «Задача будет храниться в рабочем пространстве ⟨name⟩ и станет видна участникам ⟨container⟩. Ссылки на неё сохранятся.»
  - Buttons Cancel · **Share** («Сделать общей»).
- **Manage statuses** (Operately "Customize statuses" modal, Part C §5.8): list of statuses with colour (gray/blue/green/red + amber/purple), label, icon, "closed" toggle, drag to reorder, + Add status; footer Cancel · Save. Scope line: «Статусы для: ⟨project / space / list⟩».
- **Create task modal** (Operately, used from project/space boards; Lark quick-create elsewhere): Title, Notes, Assignees, Due date, Milestone, Status · Create (key `c` on boards, Operately) · "Create more" checkbox.
- **Milestone "Complete" dialog:** «В вехе есть N открытых задач»; options Move to ⟨next milestone⟩ / Leave open / Mark all done; Complete.

## 8. Goals & Projects (mode `goals`): Operately (Part C) + Lark OKR (Part B §11)

**Adaptation rules (apply to every Part C screen):**
- Operately's top nav (Home / Company / My work / Review / bell / +New / search) is replaced by:
  - the mode sidebar (§3.3): Work Map, My work, Goals, Projects, My OKRs, Alignment, Reviews, Spaces ▸, KPIs, Templates;
  - Inbox › Review (§12);
  - the shell "+" (§3.2);
  - the Omnibox (§3.4).
- **Page container:** Rox MAIN with max-width 1152 and the Operately grid (main 8 / sidebar 4 columns). Breadcrumb at top-left ("Product Development › Goals").
- **SHOT labels win over code labels** (Part C §13): "Last Check-In", "Goal Description", "Check-Ins".
- **Every goal/project page appends three Rox-only blocks** to the sidebar, after Privacy and before Actions:
  - **Chats** («Чаты»): the linked discussion chat or space chat, with [Discuss in chat].
  - **Referenced in.**
  - **Notifications** («Уведомления»): Subscribe / Unsubscribe and the subscriber count, Operately subscriptions.
- **Actions lists** add the Rox items **Share to chat…** and **Copy link** (Copy URL already exists for projects).

### 8.1 Landing = Home (Part C §5.1)
- Greeting "Good morning, Mark!", "Your Spaces" grid [Invite People] [Add Space], "What's new?" feed.
- The space cards open the space page.
- The same widget set appears on the Rox Home when `goals.v1` is on ("My goals & projects" card, "Due soon", feed).

### 8.2 Work Map (Part C §5.2), sidebar item "Work Map" («Карта работ»; default)
- Columns, tabs (All work / Goals / Projects / Completed / Paused), progress tooltips, empty states and the profile variant are verbatim.
- **View toggle: Table | Gantt** («Таблица | Гантт»), ADR-U10. The Operately "Timeline" label is not used. Gantt keeps the "Today · date" marker, the status-coloured bars and the footer "%{count} hidden without dates".
- **Row hover actions:** "+" (add child), ⋯ (Open · Copy link · Share to chat · Move to space · Close/Pause).
- **Rox additions:**
  - a **Cycle** filter chip (OKR cycles; "All time" default);
  - a **Space** filter;
  - a "Show KPIs" toggle (KPI rows nested under aligned goals, read-only).

### 8.3 Goals, Projects lists
- Sidebar items "Goals" / "Projects" open the Work Map pre-filtered (tab = goals / projects).
- "My work" = profile Work Map (Tasks | Assigned | Reviewing | Paused | Completed | Activity | About) for me. Its Tasks tab embeds the Tasks "Assigned" view.

### 8.4 Add item modal and full pages (Part C §5.3)
- The fields and hint copy are verbatim.
- **Space** defaults to the current space, or "Personal" (local workspace only).
- **Template** (projects) appears when templates exist.
- **Rox addition:** **OKR cycle** (goals; optional select «Цикл OKR»). Selecting a cycle sets `goal_kind='objective'` and fills the dates from the cycle.

### 8.5 Goal page (Part C §5.4; SHOT 01 `screenshots/operately/01-goal-overview.jpg`)
- **Verbatim:** header, tabs (Overview · Check-Ins · Discussions · Docs & Files · Activity), Overview sections (banner, Goal Description, Targets, Checklist, Subgoals & Projects, Docs & Files preview, Contributors), sidebar fields 1–10, the delete modal and its blocked variant.
- **Rox / Lark merge:**
  - **Targets:**
    - each target row shows **weight %** when the goal is an objective in a cycle (Lark auto weights);
    - "Update" opens the popover "Update %{name}" with **New Value**, plus an optional **Comment** field. Saving creates a `check-in` with `source='kr_update'` (Lark progress record).
    - An optional per-target status chip shows if `status_override` is set (Lark per-KR status). The override is set from the ⋯ menu "Set status".
  - **Subgoals & Projects** also lists **aligned** items (Lark alignment) under a sub-header "Aligned" («Связанные»), dimmed, with a link glyph.
  - The **Discussions** tab = posts with `parent_ref=goal`.
  - The **Docs & Files** tab = the goal folder (§6.4).

### 8.6 Check-in form and page (Part C §5.5)
- Verbatim: status picker with descriptions, Update Targets, Update Checklist, Due Date, rich text, "Show previous check-in", the notify radio, Submit / Save as draft / Schedule, validation, the 3-day edit lock, the check-in page with acknowledgement, reactions, comments and subscribers.
- **Rox additions:**
  - **"Draft with Rox"** («Черновик с Rox») ghost button above the editor (M17). It creates a ChangeProposal and fills the editor with a draft from the tasks completed since the last check-in, milestone changes, linked chat highlights and doc edits. The user edits, then submits.
  - On publish, a check-in card is posted to the linked chat(s) (space chat by default). The reviewer gets an Inbox Review item and an Assistant DM card [Acknowledge] [Open].

### 8.7 Close / Reopen / Retrospective (Part C §5.6)
- Verbatim, including the warning list of active children.
- The retrospective is stored as `review` and opens at `goals/review/{id}`.

### 8.8 Project page (Part C §5.7; SHOT 02 `screenshots/operately/02-project-overview.jpg`)
- **Verbatim:**
  - SHOT layout: Description, Milestones (Upcoming + "▶ Show N completed"), Resources chips with ↗, sidebar Last check-in, Parent goal, Champion, Reviewer, Contributors with responsibility;
  - the code-only sections appended below Contributors (Start / Due dates, Privacy, Notifications, Actions);
  - the tasks pill "◔ 42% tasks completed 5/12".
- **Tabs:** Overview · Tasks · Check-ins · Discussions · Docs & Files · Activity · **Workspace** («Рабочая область», Rox-only, last).
  - Workspace hosts the existing ProjectInfo content (sessions list, working directory, assets, MEMORY.md, kanban columns, repository bindings) and the **Roadmap** sub-tab (existing `ProjectRoadmapPage` + `ProjectTimeline`, goal / DoD / requirements / risks / questions / AI modes).
- **Tasks tab** = the Tasks Board/List bound to the project's task list (§7.2), with the toolbar milestone selector (Operately).
- **Actions:** Copy URL · Move · Pause / Resume · Close · Export as Markdown · Save as template · Delete, plus Share to chat. Pause, resume and close pages are verbatim.
- **Resources:** [Add resource] opens a menu: Link existing doc / file (EntityPicker) · Add link (Drive link dialog) · Upload file. Chips render EntityChips with ↗.

### 8.9 Milestone page (Part C §5.8.4)
- Verbatim: title, due date, description, tasks list (filtered board), comments and activity timeline, and the **Complete** dialog (§7.4).
- Rox: Referenced in, plus a "Show on Gantt" link.

### 8.10 My OKRs (Lark, Part B §11 `wiki/15–17`, `user/05`)
- **Layout:** left column (≈230) with "Search employee" and **My OKRs**, person rows (my reports from `manager_id`), and a « collapse handle.
- **Main:**
  - person header and cycle switcher ‹ **Oct 2026** | Sep 2026 › (cycles from `okr_cycle`);
  - objective cards O1, O2… (= goals with `goal_kind='objective'` in the cycle, champion = person), each with KR rows (targets / checks) and **weights**;
  - draft objectives (`publish_state='draft'`) show the footer strip **Publish** / **Cancel** / 🔒 / **Saved**.
- **Empty:** "No content", **+ Add an Objective**, **Import from another cycle** («Импортировать из другого цикла», which copies goals as drafts).
- **Status chips** use the Operately set: "At risk" is **not** shown, and Lark "No status" displays as Pending (ADR-U07).
- Clicking an objective opens the Goal page. Lark's objective drawer is not built separately.
- **Weight validation:** "Weights must add up to 100%" («Сумма весов должна быть 100%»). Lark wording was [UNVERIFIED]; this is Rox copy.

### 8.11 Alignment, Reviews
- **Alignment:** the Work Map table component in tree mode, rooted at company goals, showing `parent` + `aligned-to` edges. A toggle "Graph" renders the same data with `@xyflow/react` + dagre (Phase-2 choice).
- **Reviews:** a list of `review` rows (goal / project retrospectives and cycle reviews), filters by cycle / space / status, and [New cycle review] (creates `review(subject_type=okr_cycle)` with a doc).

### 8.12 Spaces (Part C §5.14–5.15)
- **Verbatim:**
  - space page header with name, purpose, members stack, [Join] / [Leave];
  - tool cards: Goals & Projects, Discussions, Documents & Files, Tasks, KPIs, Templates;
  - "Configure tools" toggles; New space (Name, Purpose); access management pages;
  - delete by typing the name (`ConfirmByTypingModal`).
- **Rox:**
  - a tool card **Chat** («Чат») first: latest 3 messages and an [Open chat] button;
  - **Documents & Files** opens the space folder in Docs;
  - **Tasks** = the space Kanban (Operately) on the space task list.

### 8.13 KPIs (Part C §5.16)
- Verbatim: cards (value, delta, sparkline, champion, cadence) and the detail page (chart, annotations, Log update, history).
- Charts use ECharts.
- Rox: an "Aligned goals" field (`aligned-to`), Share to chat, and an Inbox Review item when an entry is due.

### 8.14 Templates (Part C §5.17) and Markdown export (Part C §5.20)
- **Templates:** list, template page, "Create project from template" (start date → relative dates), "Save as template" from a project.
- **Export as Markdown** downloads a `.md`. With a connected vault, there is also **"Save to Docs"**, which creates a private note.

## 9. Calendar (mode `calendar`): Part B §8 adapted
- Verbatim Part B §8: week default; Day | Week | Month; sidebar (mini month, My calendars, Subscribed, Rooms); top bar; event quick-create popover; create / edit dialog; settings; notification options; people search; add-calendar menu; row hover.
- **Rox:**
  - **Overlays** («Слои») in the sidebar: "Tasks with due dates" (read-only chips, never events), "Milestones", "Check-ins due". Each is an `in-calendar` projection; nothing is copied.
  - **Event dialog** adds:
    - **Video meeting** toggle ("Rox Meeting", creates a `call` bound to the event);
    - **Chat** field (link or create an event chat);
    - **Linked items** (EntityPicker: goal / project / doc agenda).
  - **Event detail** (inspector) gets a "Referenced in" section and buttons [Join] [Open chat] [Agenda doc].
  - Accounts come from Settings › Calendar accounts (Google, Outlook, CalDAV; Yandex / Mail.ru via CalDAV). States: "No calendars connected" («Календари не подключены») [Подключить].

## 10. Meetings (mode `meetings`): Part B §9 adapted
- The landing is added on top of the existing MeetingsPage: **Start a meeting** (primary) · **Join a meeting** (outline) · existing **Record locally** · history list (existing Meetings sidebar).
- **In-call UI:** Part B §9 docs-based layout, built on LiveKit components with Rox tokens.
  - The right panels (328) are Participants · Chat (= the meeting's chat, a Messenger `channel` of kind group, linked) · Minutes (live transcript from the existing Whisper pipeline when consented) · Notes (a shared doc, `minutes`).
- **After the call:** the existing finalize / proposals UI (MeetingProposal approve → task / note) is unchanged, plus a summary card posted to the meeting chat.

## 11. Contacts (mode `contacts`): Part B §4.11 + Part C §5.12 + Dossier
- **Left column (280):**
  - title **Contacts**;
  - organisation row (workspace name + **Manage**);
  - items **Directory** («Сотрудники»), **Org chart** («Оргструктура»), **External Contacts**, **New Contacts**, **Starred Contacts**, **My Groups**, **Dossier** («Досье»);
  - Help Desk hidden (out of scope).
- **Directory:** a table with Name, Title, Department, Manager, Local time, Status. Filters: department, type (member / guest / bot).
- **Org chart:** Operately org chart over `manager_id`.
- **Profile** (page and DM panel):
  - header (avatar 64, name, title, department, local time, status, buttons Message · Call · Schedule · ⋯);
  - tabs **Tasks | Assigned | Reviewing | Paused | Completed | Activity | About** (Operately);
  - "About" = Lark profile fields + custom fields.
- **Dossier:** the existing screen layout reading `contact_card`, with touches (sessions, meetings, tasks, notes, chats) as EntityChips and the existing "before the call" brief.

## 12. Inbox: Review, Notifications, Mail
- **InboxSidebar views (order):** Все / All · **Ревью / Review** (badge) · **Упоминания / Mentions** · Решения / Decisions · Сообщения / Messages · **Уведомления / Notifications** · Почта / Mail · Отложенные / Snoozed · Готово / Done.
- **Review** (Part C §5.9, verbatim groups):
  - **Due soon / overdue** (my check-ins due, my tasks due, milestones due, KPI updates due);
  - **Needs your review** (check-ins and retrospectives awaiting my acknowledgement);
  - **My upcoming work.**
  - **v2: Needs your approval** («Нужно ваше подтверждение»): agent approval requests, shown at the top (§22.3).
  - Row: type icon, title, container, due (red if overdue), primary action button (Check in · Acknowledge · Open · Log update).
  - Empty: «Всё просмотрено» ("You're all caught up").
- **Notifications:** a day-grouped list of notification rows (actor avatar, sentence, entity chip, time, unread dot), **Mark all read** («Отметить все как прочитанные»), filter chips by kind.
- **Mail:** the Lark mail client layout (Part B §12.2, docs-based): Compose, folders, message list, reading pane with **Share to chat** and **Create task** («Создать задачу»).

## 13. Base, Forms, Workplace
- **Base:** Part B §6 verbatim (grid, Add View menu, toolbar, filter, row height, fields panel, field types, share, ··· menu, automation centre, Kanban / Gallery / Gantt / Calendar views).
  - Rox: the table source picker ("Custom table" or "Rox data: Tasks / Goals / Projects / Docs / Meetings"). Adapter tables show a source banner «Данные из ⟨Задачи⟩. Изменения сохраняются в задачах.»
- **Forms:** Part B §7 verbatim.
- **Workplace:** a Home section **Apps** («Приложения»), Part B §12.1:
  - Favorites card, All Apps category tabs;
  - tiles = Rox surfaces, Pages, connected integrations, bots;
  - "Find more apps" → the existing Integrations catalog;
  - opening an app opens a surface tab.

## 14. Global states and transitions

| State | Where | Look / copy (RU · EN) | Transition |
|---|---|---|---|
| Loading | lists, panels | 3–5 skeleton rows (Lark shimmer) | → content / error |
| Empty | every list | illustration 96 + Lark/Operately copy (Part B/C), RU translated | create CTA |
| Error | panels | inline banner «Не удалось загрузить. Повторить» · "Couldn't load. Retry" | Retry |
| No access | entity page / card | lock 48 + «Нет доступа к ⟨kind⟩» + [Запросить доступ] | sends `access_request` |
| Minimal access | Work Map row / tree | title + status only, dimmed, no link | — |
| Offline / pending sync | shared entities | clock glyph + «Ожидает синхронизации»; top banner when offline > 10 s | auto-resume on reconnect |
| Conflict | detail panes | v2: per-field ConflictChip «Изменено ⟨имя⟩» with [Оставить моё] [Принять их] (§18.7); the banner remains for multi-field conflicts | field diff popover |
| Agent pending (v2) | entity created by an agent awaiting approval | dashed outline + «Ожидает подтверждения» chip | approval card (§22.2) |
| Placeholder (v2) | avatars / chips of invitees | dashed avatar + «Приглашён» | activation morph (§23.2) |
| Authority moved | local copies, old links | auto-redirect; toast «Объект перемещён в общее пространство» | — |
| Deleted / tombstone | chips, cards | strikethrough title + «Удалено» | — |
| Flag off | routes of disabled modes | route resolves to Home with toast «Функция пока отключена» | — |
| Server required | Messenger, Spaces, shared Docs without a workspace connection | empty state + [Подключить рабочее пространство] | Settings › Workspace |

## 15. Keyboard shortcuts (merged; registered in `renderer/actions/definitions.ts`)

| Shortcut | Action | Source | Conflict resolution |
|---|---|---|---|
| ⌘K | Omnibox | Rox / Lark | same |
| ⌘⇧F | Advanced search | Rox | — |
| ⌘N | Quick Entry (Tasks) / New in current mode | Things / Lark (Ctrl+N New Task) | mode-aware |
| ⌘L | New Task List (Tasks) | Lark Ctrl+L | Tasks mode only |
| ⌃1…4 (v2.1; was ⌘⇧1…4) | Chat quick panels Docs / Tasks / Calendar / Contacts | [ROX EXT] | Messenger only. ⌘⇧1…4 are already bound to `collection.viewList/Board/Table/Heatmap` at `aedff592`, so v2 used a conflicting chord |
| ⌥↑ / ⌥↓ | Previous / next chat (Messenger); move task (Tasks) | Lark / Things | mode-aware |
| ⌘F (v2.1; was ⌘J) | Find in doc | Lark Docs | Docs only; mode-aware over `app.search` (⌘F) |
| ⌘J (v2.1) | Toggle the agent panel «@rox» | [ROX EXT] | global; unbound at `aedff592` (§25.2) |
| ⌘⇧J (v2.1) | Ask @rox about the selection | [ROX EXT] | global |
| ⌘⇧H (v2.1) | Remind me / snooze the focused item (X-16) | [ROX EXT] | list and page focus |
| ⌘B | Collapse / expand the left sidebar (existing `view.toggleSidebar`) | Rox | all surfaces (§26.1) |
| c | New task on project/space board | Operately | board focus only |
| e | Edit check-in / goal description | Operately | page focus only |
| ⌘↵ | Submit check-in / send post | Operately / Lark | — |
| Esc | Close panel / dialog | all | — |
| ⌘⇧T (v2) | Create task from selection / focused message | [ROX EXT] | Docs, Messenger |
| ⌘⌥M (v2) | Comment on selection | Google Docs convention | Docs |
| ⌘⇧S (v2) | Share dialog | [ROX EXT] | any shareable object |
| ⌥⌘I (v2) | Toggle the inspector collaboration panel (edge reveal / pin) | [ROX EXT] | §18.6 |
| Space (v2) | Quick preview of a file | macOS Quick Look | Drive lists |

## 16. Key new strings (EN / RU)

| Key (namespace.key) | EN | RU |
|---|---|---|
| `entities.referencedIn` | Referenced in | Упоминается в |
| `entities.shareToChat` | Share to chat… | Отправить в чат… |
| `entities.discussInChat` | Discuss in chat | Обсудить в чате |
| `entities.createTaskFrom` | Create task from this | Создать задачу |
| `entities.linkItem` | Link Rox item… | Ссылка на объект Rox… |
| `entities.restricted` | Restricted | Нет доступа |
| `docs.moveToShared` | Move to shared Docs… | Сделать общим документом… |
| `docs.private` | Private | Личное |
| `tasks.shareTitle` | Share this task? | Сделать задачу общей? |
| `tasks.manageStatuses` | Manage statuses… | Настроить статусы… |
| `goals.mode` | Goals & Projects | Цели и проекты |
| `goals.workMap` | Work Map | Карта работ |
| `goals.gantt` | Gantt | Гантт |
| `goals.checkIn` | Check in | Отметиться |
| `goals.lastCheckIn` | Last Check-In | Последний чек-ин |
| `goals.acknowledge` | Acknowledge | Подтвердить |
| `goals.draftWithRox` | Draft with Rox | Черновик с Rox |
| `messenger.mode` | Messenger | Мессенджер |
| `messenger.askRox` | Ask Rox | Спросить Rox |
| `inbox.review` | Review | Ревью |
| `status.caution` | Caution | Внимание |
| `collab.activeNow` (v2) | Active now | Сейчас здесь |
| `collab.following` (v2) | You're following %{name} · Esc | Вы следуете за %{name} · Esc |
| `collab.comment` (v2) | Comment | Комментарий |
| `collab.resolve` (v2) | Resolve | Решить |
| `collab.reopen` (v2) | Reopen | Открыть снова |
| `collab.assignAsTask` (v2) | Assign as task | Создать задачу |
| `collab.mode.editing` (v2) | Editing | Редактирование |
| `collab.mode.suggesting` (v2) | Suggesting | Предложения |
| `collab.mode.viewing` (v2) | Viewing | Просмотр |
| `collab.acceptAll` (v2) | Accept all | Принять все |
| `collab.share` (v2) | Share | Поделиться |
| `collab.readBy` (v2) | Read by %{count} | Прочитали %{count} |
| `collab.viewedBy` (v2) | Viewed by | Кто просматривал |
| `collab.offline` (v2) | You're offline. Changes are saved and will sync. | Нет подключения. Изменения сохраняются и будут синхронизированы. |
| `collab.keepMine` (v2) | Keep mine | Оставить моё |
| `collab.acceptTheirs` (v2) | Accept theirs | Принять их |
| `xsc.createTask` (v2) | Create task | Создать задачу |
| `xsc.createEvent` (v2) | Create event | Создать событие |
| `xsc.saveToDoc` (v2) | Save to doc | Сохранить в документ |
| `xsc.newGroupWith` (v2) | New group with selected | Новая группа с выбранными |
| `drive.title` (v2) | Drive | Диск |
| `drive.myDrive` (v2) | My Drive | Мой диск |
| `drive.sharedWithMe` (v2) | Shared with me | Доступные мне |
| `drive.recent` (v2) | Recent | Недавние |
| `drive.starred` (v2) | Starred | Помеченные |
| `drive.trash` (v2) | Trash | Корзина |
| `drive.storage` (v2) | Storage | Хранилище |
| `drive.quotaUsed` (v2) | %{used} of %{quota} used | %{used} из %{quota} использовано |
| `drive.agentArtifacts` (v2) | Agent artifacts | Артефакты агентов |
| `drive.chatFiles` (v2) | Files from chats | Файлы из чатов |
| `drive.quotaFull` (v2) | Storage is full. Free up space to upload files. | Хранилище заполнено. Освободите место, чтобы загружать файлы. |
| `agent.name` (v2) | Rox (your agent) | Rox (ваш агент) |
| `agent.needsApproval` (v2) | Needs your approval | Требует подтверждения |
| `agent.approve` (v2) | Approve | Подтвердить |
| `agent.alwaysAllowHere` (v2) | Always allow in this chat… | Всегда разрешать в этом чате… |
| `agent.pause` (v2) | Pause agent | Приостановить агента |
| `agent.auditLog` (v2) | Action log | Журнал действий |
| `agent.rateLimited` (v2) | Limit reached, retrying in %{s} s | Лимит: повторю через %{s} с |
| `invite.pending` (v2) | Invited | Приглашён |
| `chat.createGroup` (v2) | New group chat | Новый групповой чат |
| `chat.createChannel` (v2) | New channel | Новый канал |
| `chat.private` (v2) | Private | Приватный |
| `chat.privateHint` (v2) | Only invited members can see this chat and its history | Только приглашённые участники видят этот чат и его историю |
| `chat.publicHint` (v2) | Anyone on the team can find and join | Любой участник команды может найти и присоединиться |
| `chat.browse` (v2) | Browse chats | Обзор чатов |
| `chat.general` (v2) | General | Общий |
| `automation.title` (v2) | Automations | Автоматизации |

## 17. Screenshot reference index

| Area | Files (in zip) | Used by |
|---|---|---|
| Messenger | `screenshots/lark/msg/01…39` (40 files incl. 03b) | §5, Part B §3–§4 |
| Docs home / doc page / Base / Forms | `screenshots/lark/docs/01–09, 40–61, 70–105` (67) | §6, §13, Part B §5–§7 |
| Calendar / Meetings / Tasks | `screenshots/lark/cmt/01–32` (32) | §7, §9, §10, Part B §8–§10 |
| Wiki / Mail / OKR / Workplace | `screenshots/lark/wiki/01–20` (20) | §6.4, §8.10, §13, Part B §5.3, §11, §12 |
| Mark's Lark desktop shots | `screenshots/lark/user/01–06` | Docs mind map / TOC / graph, Tasks Owned, OKR |
| Operately goal page | `screenshots/operately/01-goal-overview.jpg` | §8.5, Part C §13.1 |
| Operately project page | `screenshots/operately/02-project-overview.jpg` | §8.8, Part C §13.2 |



---

# Part A, v2 additions (§18–§24)

These sections are authoritative for the v2 requirements (PRD §7.10–§7.15).

Every screen block lists:
- **State:** what data and situation is shown;
- **Composition:** the chrome and components, top-left to bottom-right, with sizes;
- **Motion:** what animates, with token, duration and easing (§2.6);
- **Transitions:** where each action leads.

That is enough to rebuild the design from text (omp remark #3). All screens use Rox tokens only and render in both profiles (§2.6).

## 18. Collaboration UI

### 18.0 Principles
1. **One collaboration kit**, in `apps/electron/src/renderer/components/collab/`: `PresenceDot`, `Facepile`, `RemoteCursor`, `CommentThread`, `SuggestionMark`, `ShareDialog`, `ReceiptTicks`, `ConflictChip`, `OfflineBanner`. Every surface reuses it.
2. **Everything is visible where the work happens:**
   - presence on the object;
   - comments next to the text;
   - receipts under the message.
3. **Collaboration side panels use the inspector slot** (§18.6); there are no floating windows.
4. **Private / local objects show no collaboration chrome**, only the AuthorityBadge «Личное» and a "Share…" entry point.

### 18.1 Presence

**PresenceDot**
- **State:** `online | away | dnd | offline | placeholder`, from Valkey presence (DATA-MODEL §5.17). Placeholder = invited, not activated.
- **Composition:** an 8 px dot at the avatar's bottom-right with a 2 px ring in the avatar's background colour.
  - online `--status-success`;
  - away `--status-warning` (hollow);
  - DND `--destructive` with a white bar;
  - offline: no dot;
  - placeholder: dashed 1 px avatar border + «Приглашён» tooltip.
- **Motion:** status change cross-fades over `--motion-fast`. No pulsing (calm UI).
- **Transitions:** hover over the avatar for 300 ms → person HoverCard (status text, local time, "Message", "View profile").

**Facepile («Сейчас здесь» / "Active now")**
- **State:** principals currently viewing the object (docs, task detail, event detail, goal / project page, base), as reported by the awareness channel. It counts people, not tabs.
- **Composition:**
  - right side of the object header, left of Share;
  - up to 4 avatars at 24 px, overlapped by −6 px, each with a 2 px coloured ring (= their cursor colour);
  - a "+N" bubble for the rest.
  - Tooltip: «Анна редактирует · Олег просматривает».
- **Motion:** an avatar enters with scale .8 → 1 and fade over `--motion-fast` `--ease-out`, and leaves with fade over `--motion-fast`. Reordering animates with layout (`--motion-base`).
- **Transitions:**
  - click an avatar → **Follow** mode: my viewport tracks theirs; a 2 px coloured frame surrounds MAIN with the label «Вы следуете за Анной · Esc»;
  - Esc or scrolling yourself → stop following;
  - click +N → a popover list with "Follow" buttons.

**Typing indicators.** These show in chat composers and comment threads: «Анна печатает…» with three dots (opacity wave over 900 ms, loop; static under reduced motion). The indicator is shown only after 400 ms of continuous typing and is hidden 3 s after the last keystroke.

**Rail and lists.** Messenger chat rows show the PresenceDot on DM avatars. The Contacts list has an "Online" filter chip.

### 18.2 Co-editing in shared docs
- **State:** a shared doc (`note.authority='workspace'`) connected to Hocuspocus. Peers are connected.
- **Composition:**
  - **Remote caret:** a 2 px bar in the peer's colour, with a name label above it (12 px, 600 weight, white text on the peer colour, radius 4, 4×6 px padding).
  - **Remote selection:** the peer colour at 20% alpha.
  - **Peer colours:** 8 accessible hues derived from `--accent` rotation (OKLCH, L 0.62, C 0.15). A peer's colour is stable for the session.
  - Header: Facepile + a connection dot («Синхронизировано» / «Подключение…» / «Офлайн»).
- **Motion:**
  - remote carets glide over 80 ms linear between positions (jump when the distance is > 1 viewport);
  - the name label fades out after 1.5 s of peer inactivity and reappears on movement (`--motion-fast`).
- **Transitions:** clicking a remote label → Follow (as in §18.1). Losing the connection → header dot amber, «Изменения сохраняются локально» (§18.7).

### 18.3 Comments, mentions and threads
**Entry points:**
- select text → bubble menu **Comment** («Комментарий», ⌘⌥M);
- block handle ⋮⋮ → «Комментировать блок»;
- entity pages (task, event, goal, project, file) → the CommentsSection (existing component, now threaded).

**Inline comment composer**
- **State:** the selection is anchored. A draft is held locally until sent.
- **Composition:**
  - a 320-wide card in the comments panel, vertically aligned to the anchor;
  - author avatar 24 + name;
  - a TipTap-minimal editor with placeholder «Комментарий… @ — упомянуть, @rox — поручить агенту»;
  - toolbar `@ ☺ 📎`;
  - buttons [Отмена] [Отправить ⌘↵].
  - The anchor text gets `--status-warning` at 25% alpha.
- **Motion:** the card slides in from the right by 8 px with fade over `--motion-fast`. The highlight fades in over `--motion-instant`.
- **Transitions:**
  - Send → thread created (comment `thread_status=open`) and mentions notified;
  - Esc with an empty draft → closes; Esc with text → «Удалить черновик?» confirm.

**Thread card** (in the comments panel; also a popover on hover over the highlight)
- **State:** open or resolved. It has replies, reactions, and a suggestion link if any.
- **Composition:**
  - Header: quote excerpt (1 line, italic, `--text-muted`), ⋯ menu (Edit, Delete, Copy link, **Assign as task** «Создать задачу», Mute thread), and a ✓ **Resolve** button.
  - Body: comments with avatar, name, time («2 мин»), text with mention chips and entity chips, reaction bar.
  - Reply box (collapsed 32 px «Ответить…», expands on focus).
- **Motion:**
  - a new reply appears with height expand plus fade over `--motion-base`;
  - resolving collapses the card to a 28 px row «Решено · Анна» over `--motion-base`, then hides it if the "Open" filter is active.
- **Transitions:**
  - Resolve → `comments.resolve_thread` (notifies participants);
  - Reopen from the Resolved filter;
  - "Assign as task" → a task quick-entry popover prefilled with the comment text, assignee = the mentioned person, link `derived-from` comment (§19.2 mechanics);
  - click the quote → scroll the doc to the anchor and flash it (two pulses of 200 ms).

**Comments panel filter.** Chips Все · Открытые · Мои · Упоминания · Решённые, sort by position or by time. The panel header shows a count «Комментарии 7».

**Mentions** (`@` in any composer). The MentionMenu (§4) orders results as:
1. people in this object / chat;
2. other people;
3. `@rox` (my agent), then other agents;
4. entities.

Mentioning someone without access opens an inline prompt: «У Ивана нет доступа. [Дать доступ: комментатор ▾] [Упомянуть без доступа]».

### 18.4 Suggestion mode
**Mode switch** (doc header, right of the Facepile): a segmented control
- **Редактирование** (✎);
- **Предложения** (✎ with a dot);
- **Просмотр** (👁).

Commenters see only Предложения / Просмотр. The doc default comes from `doc.suggest_mode_default`.

- **State:** suggestion mode is active for me. Open suggestions exist.
- **Composition:**
  - Inserted text: underlined 2 px in the author colour, background 12% author colour.
  - Deleted text: strikethrough in the author colour, background 8%.
  - Format changes: a dotted underline with a tooltip «Жирный → Обычный».
  - Each suggestion has a card in the comments panel: avatar, «Анна предлагает: вставить «…»», [✓ Принять] [✕ Отклонить], reply box.
  - Header overflow ⋯ → «Принять все» / «Отклонить все» (with a count).
- **Motion:**
  - accepting animates the marks to normal text (colour fade over `--motion-base`) and the card collapses;
  - rejecting fades the inserted text out over `--motion-fast` and deleted text loses its strike.
- **Transitions:**
  - Accept / Reject → `docs.decide_suggestion` → author notified;
  - concurrent edits that make a suggestion inapplicable mark it `stale` («Устарело — текст изменён») with [Отклонить] only.

### 18.5 Permissions and sharing (ShareDialog)
**Entry:** the Share button («Поделиться») in the header of every shareable kind, ⌘⇧S, or the ⋯ → Share… entry.

- **State:** current grants, link settings, inherited access (from space / folder), pending access requests.
- **Composition:** a dialog 560 wide, radius 12.
  1. Title «Поделиться «⟨название⟩»» + ⚙ (advanced: who can reshare, download / copy for viewers).
  2. Invite input: chips for people / groups / spaces / chats / emails (emails → invitation flow §23); role dropdown (Читатель · Комментатор · Редактор · Управляющий); toggle «Уведомить» with an optional message.
  3. "Люди с доступом" list: avatar, name, email, role dropdown, ✕; inherited rows are dimmed with «через ⟨Пространство⟩» and are not removable here; placeholder rows show «Приглашён».
  4. **Ссылка** section: dropdown (Выключена · Все в рабочем пространстве · Все, у кого есть ссылка), role (просмотр / комментарий / редактирование), expiry (никогда / 7 / 30 дней / дата); [Копировать ссылку].
  5. Access requests (if any): «Олег запрашивает доступ на редактирование» [Разрешить] [Отклонить].
  6. Footer: «Передать владение…» (owner only) · [Готово].
- **Motion:** the dialog scales .98 → 1 with fade over `--motion-fast`. Rows insert with height expand over `--motion-base`. Copy link → the button label becomes «Скопировано ✓» for 1.5 s.
- **Transitions:**
  - each change dispatches `acl.grant` / `acl.revoke` / `acl.set_link` immediately (no Save button) with a toast «Доступ обновлён · Отменить»;
  - a public link on a privileged-scope object asks for a confirmation;
  - when an agent triggers sharing, the action shows as an approval card instead (§22.2).

**Inherited and conflicting access:** granting less than the inherited role is disabled with the tooltip «Доступ наследуется от ⟨Пространство⟩».

### 18.6 Collaboration panels in the inspector slot (omp remark #7)
The comments, suggestions, activity, "Viewed by" and agent-approval panels are **inspector-slot panels**: right side, 328 wide (doc comments 360). Each panel has three states:

| State | Look | Trigger |
|---|---|---|
| **Скрыт** (hidden) | nothing rendered. The header button shows a count badge (e.g. 💬 3) | default for docs without open threads |
| **Показ у края** (edge reveal) | an 8 px hot zone at the right window edge; hovering 150 ms slides the panel in as an overlay (shadow-popover, does not reflow MAIN) | mouse to the edge, or ⌥⌘I tap |
| **Закреплён** (pinned) | the panel docks and MAIN reflows | 📌 in the panel header, or open from the header button |

- **Motion:** edge reveal is translateX(100% → 0) over `--motion-base` `--ease-out`; leaving the panel for 400 ms slides it out with `--ease-in`. Pin / unpin reflows MAIN with a layout animation over `--motion-base`.
- **Transitions:**
  - a new comment from someone else while the panel is hidden → the badge bumps (scale 1 → 1.2 → 1 over `--motion-fast`); the panel does not open on its own;
  - clicking a highlight in the doc opens the panel pinned and focused on that thread.

### 18.7 Offline and conflicts
**OfflineBanner**
- **State:** no connection to the workspace server for more than 10 s.
- **Composition:** a 32 px bar above MAIN with a `--status-warning` 12% background: ⚡ «Нет подключения. Изменения сохраняются и будут синхронизированы.» plus a «Подробнее» link that lists pending commands by entity. Pending items show a clock glyph (12 px) next to their title in lists.
- **Motion:** slides down over `--motion-base`. On reconnect the bar turns green «Синхронизировано» for 2 s, then slides up.
- **Transitions:** «Подробнее» → a popover with the outbox items (kind chip, title, time, [Отменить изменение]).

**ConflictChip** (non-doc entities)
- **State:** a command was rejected with `conflict {field, theirs, mine}`.
- **Composition:** inline next to the field: an amber chip «Изменено Анной» → popover: field name; «Ваше: Пт 15:00» / «Анны: Пт 16:00»; [Оставить моё] [Принять их]; «Показать историю».
- **Motion:** the chip shakes 2 px horizontally once (`--motion-fast`). It is static under reduced motion.
- **Transitions:**
  - Оставить моё → re-dispatch with the new `expectedRevision`;
  - Принять их → discard the local change.

**Access revoked while offline:** a toast «Доступ к «⟨название⟩» отозван. Ваши изменения сохранены как личный черновик.» with a link to the draft (a private note or local task).

**Docs:** there is no conflict UI; Yjs merges. Suggestions made offline remain suggestions.

### 18.8 Read receipts
- **Messages, DM:**
  - a single ✓ (`--text-muted`) = delivered to the server;
  - ✓✓ `--accent` = read;
  - shown under my last messages, at the bottom right of the bubble.
- **Messages, group (≤ 500):**
  - text «Прочитали 3» under my last message → click → a popover of avatars split into Прочитали / Не прочитали with times;
  - > 500 members: no receipts.
- **Privacy:** Settings → Privacy → «Показывать, что я прочитал(а)» (DMs only). When off, you don't see others' DM receipts either; the toggle's ⓘ explains this (help popover §2.6).
- **Docs:** header ⋯ → «Кто просматривал» shows a list from `doc_view` (avatar, first and last view). Hidden for docs with link-anyone viewers (count only).
- **Motion:** ✓ → ✓✓ cross-fades over `--motion-fast`; the count increments with a number roll over `--motion-fast`.

### 18.9 Shared task lists
- **State:** a task list with `share_mode` ≠ private, members and followers.
- **Composition:**
  - List header: title, Facepile of members, [Поделиться], [Чат списка] (opens the list chat tab), view switch (Список · Канбан · Гантт).
  - Rows show assignee avatars with PresenceDot and an «Изменено Анной · 2 мин» tooltip on the updated-time glyph.
  - The "Мой день / Today" toggle per row is personal (`work_item_user_state`) and invisible to others.
- **Motion:** live updates from others highlight the row for 1.2 s (accent 8% → 0, `--motion-slow`). Moves between sections animate with layout over `--motion-base`.
- **Transitions:** assigning someone who is not a member → the inline prompt «Добавить Ивана в список?».

### 18.10 Shared calendars
- **State:** calendars that I own, that are shared with me, or that I subscribe to (`calendar_member`).
- **Composition:**
  - Calendar sidebar groups: Мои календари · Общие со мной · Подписки. Each row: colour swatch, name, eye toggle, ⋯ (Поделиться…, Цвет, Уведомления, Отписаться).
  - Free-busy calendars render events as hatched «Занят» blocks with no title.
  - **Find a time** («Подобрать время»), in the event editor: attendee rows with busy bars on a time ruler and suggested slots as chips.
- **Motion:** toggling visibility fades the calendar's events over `--motion-fast`. Suggested slots appear with a stagger (30 ms each).
- **Transitions:** sharing → ShareDialog (§18.5) with roles Владелец · Редактор · Читатель · Только занятость.

## 19. Cross-surface creation flows (PRD §7.11)

**Common mechanics (all flows):**
- Every flow ends with a real entity created through its owner command (TECH-SPEC §12).
- The entity gets a `derived-from` link to its origin (doc block id / message seq), and a **live block or card** appears at the origin.
- The created entity's detail shows «Создано из ⟨Документ / Сообщение⟩» with a link that scrolls to and flashes the origin.
- **Private-note origin:** creating a workspace entity from a private note asks «Создать в рабочем пространстве ⟨…⟩?» [Создать] / [Оставить локально] (local task only).
- **Undo:** a toast «Задача создана · Отменить» (6 s). Undo dispatches the compensating command (archive the created entity and remove the block).

### 19.1 Doc → inline task block (X-01)
**Steps:**
1. In a doc, type `/task` (or `/задача`). Alternatively type `[] ` at the start of a line in a shared doc, then the text and ⌘↵; or use the toolbar ☐ «Задача».
2. The slash menu shows «Задача — создать задачу и вставить блок» (icon `circle-check`). Press Enter.
3. An **inline task block** appears in draft state:
   - checkbox (disabled while drafting);
   - title input with placeholder «Название задачи»;
   - chips «Исполнитель» (@) and «Срок» (natural language: «пт», «завтра 15:00», «next week»);
   - list chip (defaults to the doc's default list, or «Бэклог»);
   - ↵ «Создать».
4. Enter → `docs.insert_task_block` with a nested `tasks.create`. The block becomes live.
5. The live block shows:
   - checkbox;
   - title (click → task detail in the inspector);
   - assignee avatar;
   - due chip (red when overdue);
   - status chip if it isn't the default.
- **State:** draft → creating (spinner in the checkbox) → live; or error (red outline, «Не удалось создать · Повторить»).
- **Composition:** the block is 32 px high, inline with the text column (768). Hover shows the ⋮⋮ handle and ⋯ (Открыть, Копировать ссылку, Преобразовать в текст, Удалить блок / Удалить задачу).
- **Motion:** draft → live morphs the input to plain text over `--motion-fast`. Ticking the checkbox draws the check stroke over `--motion-instant`, then the title strikes through over `--motion-base`.
- **Transitions:**
  - the checkbox dispatches `tasks.complete`;
  - completing elsewhere updates the block live (subscription by ref);
  - deleting the block asks «Удалить только блок или задачу тоже?».

### 19.2 Doc selection → task (X-02)
1. Select text (one or more lines).
2. The bubble menu shows «Задача» (☐+), or press ⌘⇧T.
3. A quick-entry popover (360 wide), anchored under the selection:
   - title prefilled from the selection (first line, ≤ 200 chars);
   - remaining lines become the description;
   - a mention in the selection becomes the assignee; a date phrase becomes the due date (highlighted to show what was parsed);
   - list chip;
   - [Создать ↵].
4. Enter → `tasks.create_from_selection`. The selected text gets a subtle task anchor mark (dotted underline + ☐ glyph at the line end) linking to the task.
- **Motion:** the popover grows from the bubble (scale .96 → 1 over `--motion-fast`). On create, the ☐ glyph pops in (scale 0 → 1 with `--ease-spring`).
- **Transitions:** clicking the glyph opens the task in the inspector. The task's «Создано из» chip leads back to the anchor.

### 19.3 Checklist → tasks (X-03)
1. Block menu ⋮⋮ on a bullet or checklist → «Преобразовать в задачи».
2. A dialog «Создать N задач»:
   - one row per item, each with a checkbox (preselected) and editable title;
   - shared fields: list, assignee (optional), due (optional).
3. Create → `tasks.create_many_from_checklist`. Items are replaced by inline task blocks (§19.1).
- **Motion:** items morph into task blocks one by one with a stagger of 40 ms.

### 19.4 Doc → event (X-04)
1. Type `/event` («/событие»); or click any date chip (`/date` or an auto-detected date) → «Создать событие».
2. An **event block draft** appears:
   - title (prefilled from the current heading or line);
   - when (natural language + picker; duration defaults to 30 min);
   - attendees (@, defaulting to the doc's collaborators when invoked from a meeting-notes template);
   - toggle «Видеозвонок»;
   - calendar chip.
3. «Создать» → the confirmation preview: «Приглашения получат: Анна, Олег». Invites are consequential for agents only; humans confirm inline.
4. `docs.insert_event_block` → `calendar.create_event`. The block becomes a live **event card**:
   - date tile (day / month);
   - title and time range;
   - attendee avatars with RSVP glyphs (✓ / ? / ✕);
   - [Присоединиться] when a call exists and starts within 10 min;
   - «Заметки встречи» link (R1).
- **State:** draft / creating / live / cancelled (strikethrough + «Отменено»).
- **Motion:** the card flips from the draft form over `--motion-base` (Y rotation 8° plus fade; reduced motion: fade only).
- **Transitions:** click → event detail in the inspector. RSVP changes update live.

### 19.5 Doc → meeting (X-05)
1. `/meeting` («/встреча»). A popover asks: «Начать сейчас» or «Запланировать».
2. **Начать сейчас** → `vc.start_meeting {origin: doc block}`. A meeting block appears with a live «Идёт · 00:12 · 3 участника» status, [Присоединиться], and the doc is set as the meeting's notes.
3. **Запланировать** → the §19.4 flow with «Видеозвонок» on.
- **Motion:** while live, the red dot pulses (1.6 s loop; static under reduced motion).

### 19.6 Doc → task list embed (X-06)
1. `/tasks` («/задачи») → a picker: existing lists (search), «Новый список…», or a filter («Мои задачи на неделе»).
2. `docs.embed_view{ref: task-list}` inserts a live list view:
   - height 320, resizable;
   - header with the list name and view switch;
   - rows editable inline;
   - «+ Добавить задачу».
- **Motion:** rows from others highlight on change (as in §18.9).

### 19.7 Message → task (X-07)
1. Hover a message → the action bar (Lark): ☺ ↩ ⋯. Under ⋯, «Создать задачу» sits near the top. Alternatives: ⌘⇧T on a focused message, or reply with `/task`.
2. The task popover (360) anchored to the message:
   - title = message text (first 200 chars; links kept);
   - assignee = the message author if it isn't me, else none;
   - due parsed from the text;
   - list = the chat's default list;
   - followers = mentioned people;
   - attachments → links.
3. Create → `tasks.create_from_message`. A thread reply is posted as a system card: «Анна создала задачу · ⟨task card⟩», and the message gets a ☐ glyph with a count.
- **Motion:** the card enters with a slide-up of 6 px plus fade over `--motion-fast`.
- **Transitions:** the card's checkbox completes the task. The thread shows «✓ Выполнено Олегом».

### 19.8 Message → event / meeting (X-08)
1. ⋯ → «Создать событие» (or «Начать встречу»).
2. The event editor (dialog 560) is prefilled:
   - title from the message;
   - time parsed («завтра в 15») or the next free slot;
   - attendees = chat members (group ≤ 20, else only the mentioned people), with a toggle «Все участники чата (N)»;
   - description = message permalink.
3. Save → `calendar.create_event_from_message`. The event card posts in the thread with RSVP buttons. Meetings post [Присоединиться].

### 19.9 Message(s) → doc (X-09)
1. ⋯ → «Сохранить в документ», or multi-select messages (long-press or ⇧-click, which shows checkboxes and a bottom action bar «Выбрано 5 · В документ · Переслать · Задача»).
2. A dialog: «Новый документ» / «Добавить в существующий» (picker); the format is «Цитаты с авторами» or «Только текст».
3. `docs.create_from_messages`: quotes keep author, time and a permalink. The doc card posts in the chat.
- **Motion:** the selection checkboxes slide in from the left over `--motion-base`.

### 19.10 Chat → group chat (X-10)
1. `/group @Анна @Олег Название`, or the member list → select people → «Новая группа с выбранными». A DM header ⋯ → «Создать группу» adds the DM partner.
2. The **Create chat dialog** (§23.4) opens in group mode: name (prefilled), member chips (removable), toggle «Перенести последние N сообщений как контекст» (off by default, shows a preview), and the **«Приватный»** toggle (on by default for groups created from a chat).
3. `im.create_chat {from: chat}` → the new group opens with a system message «Создано из ⟨чат⟩». The origin chat gets a card «Создана группа ⟨…⟩».

### 19.11 Event → meeting notes + prep task (rule R1, automatic)
- **State:** a new event was created by me (organiser) and R1 is enabled.
- **What the user sees:**
  1. In the event detail, a section «Заметки встречи» shows a doc chip «⟨Название⟩ — ⟨дата⟩» and «В дневной заметке ⟨дата⟩».
  2. The daily note for that date gains a line «10:00 · ⟨Название⟩ → [Заметки]».
  3. The task «Подготовиться: ⟨Название⟩» appears in **Бэклог** with a «Черновик» chip, due at the event start.
  4. A one-time coach mark on the first run: «Rox создаёт заметки и задачу подготовки для ваших встреч · Настроить».
- **Motion:** the section appears with fade over `--motion-base` once the rule completes (usually < 2 s); before that, a skeleton line shows «Создаём заметки…».
- **Transitions:**
  - the doc chip opens the minutes (template: Повестка · Участники · Заметки · Решения · Задачи);
  - «Настроить» → Settings → Automations (§24);
  - deleting the draft task never recreates it (idempotency key).

## 20. Personal Drive («Диск»)

**Placement.** Inside the Docs mode (rail «Документы»). The Docs sidebar section «Диск» expands to:
- Главная диска;
- Мой диск;
- Доступные мне;
- Недавние;
- Помеченные;
- Корзина;
- a divider, then the virtual folders: Артефакты агентов · Файлы из чатов · Вложения заметок · Записи встреч;
- the **quota meter** at the sidebar bottom.

Route `docs/drive/*` (DATA-MODEL §3). Flag `drive.personal.v1`.

### 20.1 Drive home («Главная диска»)
- **State:** the user's drive with recent activity. A new account sees the empty state.
- **Composition** (MAIN, max-width 1152):
  1. Header: title «Диск» (24/600) · search field «Поиск на диске» (360) · [⬆ Загрузить ▾] (Файлы · Папку) · [+ Создать ▾] (Папка · Документ · Таблица Base · Форма).
  2. «Предлагаемые»: a horizontal row of 4–6 file cards (160×180: preview thumb 160×100, name 2 lines, reason «Вы открывали вчера» / «Анна изменила»).
  3. «Недавние»: a table of name (icon + name), location (breadcrumb chip), owner (avatar), modified («сегодня 14:20»), size (Rox Mono, right-aligned) and ⋯.
  4. Empty state: illustration 96, «Здесь появятся ваши файлы», «Перетащите файлы сюда или нажмите «Загрузить»», [Загрузить файлы], plus a hint line «Артефакты агентов и файлы из чатов появятся автоматически».
- **Motion:** cards fade and rise 4 px with a 30 ms stagger on first load (`--motion-base`). Skeletons shimmer while loading.
- **Transitions:** clicking a card or row → preview (§20.5); double-clicking a folder → the folder view; ⋯ → the context menu (§20.3).

### 20.2 My Drive / folder view («Мой диск»)
- **State:** the folder contents (folders first, then files), with a sort and a view mode (list / grid).
- **Composition:**
  - breadcrumb «Мой диск › Проекты › Rox» (each crumb is a drop target);
  - toolbar: view toggle ☰ / ▦ · sort («Имя», «Изменено», «Размер») · filter chips (Тип ▾, Владелец ▾, Изменено ▾) · [⬆ Загрузить] [+ Создать];
  - list rows are 40 high, with a checkbox on hover for multi-select;
  - the grid tile is 180×200.
  - Selection bar: «Выбрано 3 · Поделиться · Переместить · Скачать · Корзина · ✕».
- **Drag and drop:**
  - dragging OS files onto the window shows a full-MAIN overlay «Отпустите, чтобы загрузить в «⟨папка⟩»» (dashed `--accent` border, accent 6% background);
  - dragging items onto a folder row highlights it (accent 14%).
- **Motion:** the overlay fades over `--motion-fast`. Dropped items appear with height expand over `--motion-base`. Moved items collapse out of the list over `--motion-base`.
- **Transitions:** drop → the upload panel (§20.4). Moving into a folder shows the toast «Перемещено в ⟨папка⟩ · Отменить».

### 20.3 Context menu (file / folder)
- Открыть · Открыть в новой вкладке · Предпросмотр (Space);
- Поделиться… (ShareDialog §18.5) · Копировать ссылку;
- Переместить… · Создать ярлык в… · Сделать копию;
- Переименовать (F2) · Пометить ★;
- Версии… (files) · Скачать;
- Отправить в чат… · Создать задачу о файле · Упомянуть в документе…;
- Свойства (owner, size, created, source «Создано в сессии ⟨…⟩» for artifacts);
- В корзину (Del).

### 20.4 Upload panel
- **State:** one or more upload sessions (`upload_session`): queued / uploading / paused (offline) / completed / failed / quota-blocked.
- **Composition:**
  - bottom-right floating panel, 360 wide; header «Загрузка 3 файлов · 42%» with [–] collapse and [✕];
  - rows: type icon, name, progress bar 2 px `--accent`, «120 из 480 МБ · 12 с», row action ⏸ / ↻ / ✕;
  - completed rows show ✓ and «Открыть»;
  - quota-blocked rows: «Недостаточно места: нужно 2,1 ГБ, свободно 1,4 ГБ» + [Управлять хранилищем].
- **Motion:**
  - the panel slides up from the bottom over `--motion-base`;
  - progress bars animate width linearly;
  - on completion the bar fills, turns `--status-success`, and the row collapses after 3 s when the panel is collapsed.
- **Transitions:**
  - network loss → rows show «Пауза — нет сети», resume automatically (resumable multipart);
  - closing with active uploads asks «Отменить загрузки?».

### 20.5 Preview
- **State:** the file's current version and a preview status (`file_preview`: pending / ready / failed / unsupported).
- **Composition:** a full-window overlay (dark scrim `--background` at 92%):
  - Top bar: ← back, name, owner avatar, [Поделиться] [Скачать] [⋯] [Открыть в приложении] (for Docs / Base); version chip «Версия 3 ▾».
  - Centre viewer by type:
    - images: fit, with zoom (⌘+ / ⌘−) and pan;
    - PDF: pdf.js with a page strip on the left;
    - video / audio: player with a poster;
    - text / code: Shiki-highlighted, read-only, line numbers;
    - Markdown: rendered;
    - other: an icon + «Предпросмотр недоступен» + [Скачать].
  - Right panel (toggle 💬): comments on the file (entity-level threads, §18.3) + details.
  - ← → arrows move between files in the current list.
- **Motion:** opens with a zoom from the clicked thumbnail to the viewer (shared-layout, `--motion-slow`); closes back to the thumbnail. A pending preview shows a centred spinner + «Готовим предпросмотр…».
- **Transitions:** Esc closes; Space toggles from the list (Quick Look style).

### 20.6 Shared with me, Recent, Starred, Trash
- **Доступные мне:** table columns name · shared by (avatar + name) · date shared · ⋯ (Добавить ярлык в Мой диск, Убрать из списка). Grouping chips: Все · Люди · Пространства · Чаты.
- **Недавние:** grouped Сегодня / Вчера / На этой неделе / Ранее, with an activity column («Вы открыли», «Анна изменила»).
- **Помеченные:** a flat list of starred items. The empty state is «Отмечайте важные файлы звёздочкой ★».
- **Корзина:**
  - banner «Файлы удаляются навсегда через 30 дней. Они учитываются в занятом месте.» with [Очистить корзину];
  - columns: name · deleted («3 дня назад») · deleted by · original location · «Удалится через 27 дн.»;
  - row actions: [Восстановить] [Удалить навсегда] (confirm dialog with the size freed).
- **Motion:** restored rows slide out to the right and fade over `--motion-base`.

### 20.7 Storage page («Хранилище») and the quota meter
**Quota meter** (sidebar bottom)
- **Composition:** a 4 px bar (`--accent`, which turns `--status-warning` at ≥ 80% and `--destructive` at ≥ 95%), text «12,4 ГБ из 1 ТБ использовано» (13 px), and ⓘ.
- **Motion:** the bar width animates over `--motion-base` on change.
- **Transitions:** click → the Storage page.

**Storage page**
- **State:** `drive.used_bytes`, `trash_bytes`, `quota_bytes`, the breakdown by category, the largest files.
- **Composition:**
  1. A big number «12,4 ГБ» (32/600, Rox Mono) + «из 1 ТБ» + percentage.
  2. A stacked bar (12 px) by category, with legend chips: Документы · Изображения · Видео · Артефакты агентов · Файлы из чатов · Записи встреч · Другое · Корзина.
  3. «Самые большие файлы»: a table of name, location, size, last opened, [В корзину].
  4. Actions: [Очистить корзину (1,2 ГБ)], «Версии файлов занимают 3,4 ГБ» → a list of files with many versions.
  5. Admin note (if any): «Квота назначена администратором рабочего пространства».
- **Help popover ⓘ «Как считается место»:**
  - **Definition:** the space taken by files you own in Rox Drive.
  - **Units:** binary units are shown as ГБ / ТБ (1 ТБ = 1024⁴ байт).
  - **Formula:** `used = Σ размеров всех версий ваших файлов + корзина`.
  - **Source:** the storage ledger, recalculated nightly.
  - **Not counted:** files others shared with you, local `~/rox` files that are not uploaded, and virtual folders. They count only when the file itself is in your drive.
  - **Example:** «Документ 10 МБ с 3 версиями = 30 МБ».
- **Motion:** the bar segments grow from left to right on load (stagger 40 ms, `--motion-slow`).

**Quota states:**
- 80% → an Inbox notification and a yellow meter;
- 90% → also a dismissible banner in Drive;
- 100% → uploads blocked; banner «Хранилище заполнено. Освободите место, чтобы загружать файлы.» [Управлять хранилищем]. Agents get the `QUOTA_EXCEEDED` error, which their report card shows.

**Local-only mode:** the meter shows «Локально: 12,4 ГБ в ~/rox/drive · свободно на диске 210 ГБ» with no quota.

### 20.8 Virtual folders
- **Артефакты агентов:** grouped by session (session title, date, agent avatar) → files.
  - Each file row has a source chip «Сессия ⟨…⟩» and the button [Сохранить в Мой диск] (moves it into a real folder; charged once).
  - Local-only: read from session dirs under `~/rox/workspaces/…`.
- **Файлы из чатов:** grouped by chat; filters by sender and type. This is the Lark "Shared files" equivalent.
- **Вложения заметок**, **Записи встреч:** the same pattern.
- **Composition:** each virtual folder has a header info line «Это автоматическая папка — файлы не копируются» with ⓘ.

## 21. Onboarding and the welcome DM

### 21.1 Onboarding wizard: new step «Ваш агент @rox»
This extends the existing `OnboardingWizard.tsx`. Steps become: Язык → Папка проектов → Шаблон → **Ваш агент @rox** → Готово.
- **Папка проектов** default: `~/rox/projects` (shown in Rox Mono, with a [Изменить…] picker). `~/Documents` and `~/Desktop` are never proposed (TECH-SPEC §10.1).
- **«Ваш агент @rox» step:**
  - **State:** the personal agent is provisioned (R3 step 1 has run, or runs when this step opens).
  - **Composition:** card 560 wide:
    - agent avatar 48 (Rox glyph on `--accent`) + «Познакомьтесь с @rox — вашим агентом»;
    - three bullet lines with icons: «Пишите @rox в любом чате, документе или комментарии», «@rox создаёт задачи, события, документы, группы и звонки», «Важные действия — только с вашего подтверждения»;
    - **policy selector**, radio cards:
      - «Спрашивать перед действиями, заметными другим» (default = routine auto / consequential ask);
      - «Спрашивать всегда»;
      - «Больше самостоятельности» (allows standing approvals to be suggested sooner; privileged still asks).
    - The selector maps the existing `PermissionMode` labels (safe / ask / allow-all) onto the approval policy (TECH-SPEC §13.2). ⓘ opens §22.5 help.
  - **Motion:** the step slides horizontally (translateX 24 px + fade, `--motion-slow`). The bullets stagger in by 60 ms.
  - **Transitions:**
    - «Далее» → «Готово» step, with the button «Открыть чат с @rox» → the DM (§21.2);
    - «Пропустить» keeps the defaults.

### 21.2 Welcome DM (rule R3; Macro-style, adapted)
- **State:** the DM between the user and their agent was just created. The welcome message has id `uuidv5(principal,'welcome')`, `attribution: unprompted`, `notification: mentions_only` (only the new user is notified). The DM is pinned at the top of the chat list for 7 days.
- **Composition:**
  - The DM header: avatar «Rox», name «Rox (ваш агент)», the «Агент» tag (purple tint per §2), subtitle «Отвечает в любом чате по @rox».
  - Message bubble (agent styling: a left 2 px `--accent` bar), in the user's locale.

**RU (default):**
> Привет, @Марк! Я **@rox** — ваш личный агент в Rox.
>
> Меня можно позвать **из любого чата, документа или комментария**: просто напишите **@rox** и задачу. Например:
> - «@rox поставь звонок с @Анна завтра после обеда»
> - «@rox сделай задачу по этому сообщению на пятницу»
> - «@rox собери итоги треда в документ»
>
> Я создаю задачи, события, документы, групповые чаты и звонки. Всё, что увидят другие люди, я сначала покажу вам на подтверждение.
>
> Кто ещё здесь: @rox (я), @Анна, @Олег, @Ирина. Чужого агента можно позвать как @rox-anna.
>
> Я положил для вас **«Как работать в Rox»** и три стартовые задачи в «Входящие». Ваш диск: 0 Б из 1 ТБ.

**EN:**
> Hi @Mark! I'm **@rox**, your personal agent in Rox. Call me **from any chat, doc or comment** by typing **@rox** and what you need: "@rox set up a call with @Anna tomorrow afternoon", "@rox make a task from this message for Friday", "@rox summarise this thread into a doc". I can create tasks, events, docs, group chats and calls. Anything other people will see, I'll show you first for approval. Who's here: @rox (me), @Anna, @Oleg, @Irina. You can call someone else's agent as @rox-anna. I've added **"How to work in Rox"** and three starter tasks to your Inbox. Your drive: 0 B of 1 TB.

- **Handles rule:** every `@handle` is a real mention chip resolved at send time:
  - `@rox` → the user's agent;
  - teammates → up to 5 most recently active members of the user's workspaces;
  - built-in agents → only if enabled.
  - If there are no teammates (solo / local), that line becomes «Пока вы здесь один — пригласите коллег: [Пригласить]».
  - Teammates are mentioned visually but **not notified** (they aren't in the message's `mentions` list). This is the Macro pattern; see TECH-SPEC §17.
- **Under the bubble:** three suggestion chips (quick replies): «Что ты умеешь?» · «Создай задачу» · «Настроить разрешения». Plus the cards: «Как работать в Rox» (doc card) and «Мой диск» (drive card).
- **Motion:** the DM opens with the welcome message typing in. A typing indicator shows for 600 ms, then the message fades and rises 6 px over `--motion-base`. The chips stagger in by 40 ms. Reduced motion: appear instantly.
- **Transitions:**
  - a chip sends that text as the user's message, and the agent answers;
  - «Настроить разрешения» → Settings → Agent (§22.4);
  - Help menu → «Показать приветствие снова» re-posts the welcome (new id).

**Empty, failure and slow cases:**
- If the welcome isn't delivered within 5 s of first sign-in, the DM shows a skeleton bubble «Rox готовит приветствие…».
- If R3 fails after retries, a static local welcome (same text, without teammates) renders client-side and is marked «офлайн-версия».

## 22. Agent UI (`@rox` autonomy)

### 22.1 Invoking @rox
- **In a composer:** typing `@r` shows the MentionMenu with «@rox — ваш агент» first (agent tag). Selecting it inserts a purple-tinted chip. The send button tooltip changes to «Отправить и поручить @rox».
- **After send:**
  - the agent's reply appears in the **thread** of the message (not the main stream), starting with a status line «@rox думает…» (spinner);
  - in docs and comments, the agent replies inside the comment thread.
- **`@rox-<user>`** (someone else's agent): the chip shows «Rox · Анна». It may answer questions or ask its owner, but never acts on the requester's behalf.

### 22.2 Action cards (proposal, approval, report)
**Proposal / approval card** (consequential or privileged)
- **State:** an `approval_request` is pending (expires in 24 h).
- **Composition:** a card 420 wide, in the thread and in the owner's agent DM:
  - Header: the risk badge «Требует подтверждения» (`--status-warning` tint) or «Привилегированное действие» (`--destructive` tint) · expiry «истекает через 23 ч».
  - Summary sentence: «Создать событие «Синк по Rox» пт 15:00–15:30 и пригласить Анну, Олега».
  - Preview block (kind-specific): event time / attendees / call toggle; task title / assignee / list; group name / members; message text in a quote; share target and role.
  - «Кто увидит: Анна, Олег (получат приглашение)».
  - Buttons: [Подтвердить] (primary) · [Изменить] (opens the prefilled editor) · [Отклонить] · ⋯ → «Всегда разрешать в этом чате…» (standing approval; hidden for privileged).
- **Motion:** the card enters with a slide-up of 6 px plus fade over `--motion-fast`. On decision, the button row collapses into a status line («Подтверждено вами · 14:02») over `--motion-base`.
- **Transitions:**
  - Подтвердить → execute → the report card;
  - Изменить → the normal editor (event dialog etc.), saved as the approved command;
  - Отклонить → the agent acknowledges in the thread;
  - expiry → the card greys out, «Истекло».

**Report card** (after readback)
- **Composition:** ✓ «Готово» + created entity cards (chips with live status) + «Отменить» (for reversible actions, within 10 min) + «Журнал» (opens the audit viewer filtered to this action).
- Failure: ✕ «Не получилось: ⟨reason⟩» + [Повторить] + details.
- **Rule:** the agent never says «готово» before readback (status triad `readback_verified`).

**Routine actions** (auto): only the report card (compact, one line + chips).

### 22.3 Inbox → Review «Нужно ваше подтверждение»
- A new group at the top of Review: rows with the agent avatar, summary, origin chip (chat / doc), age, and buttons [Подтвердить] [Отклонить] inline.
- The batch toolbar: «Подтвердить выбранные» (consequential only).

### 22.4 Settings → Agent («Агент»)
The sections are:
1. **Профиль:** name, avatar, handle `@rox` (fixed) / `@rox-⟨username⟩`, status (Активен / Приостановлен) with the [Приостановить агента] toggle.
2. **Разрешения (scopes):** a table of scopes grouped by module (Задачи, Документы, Календарь, Звонки, Мессенджер, Люди, Цели). Each row has a toggle and a mode select (Автоматически / Спрашивать / Запрещено) with the risk class shown as a badge. Admin-floored rows are locked with «Задано администратором».
3. **Постоянные разрешения:** a list of standing approvals (scope, where, expires, created from) with [Отозвать].
4. **Лимиты:** a read-only table of rate limits (or editable for admins) with current usage bars («12 из 120 в час»).
5. **Журнал действий:** the audit viewer (§22.6).
6. **Опасная зона:** «Сбросить разрешения», «Удалить агента» (admin).
- **Motion:** section anchors scroll smoothly (`--motion-slow`). Toggles animate the knob over `--motion-instant`.

### 22.5 Help: approval classes and rate limits
- ⓘ next to the «Разрешения» header shows:
  - **Definition:** three risk classes. «Обычные» are private and reversible. «Заметные другим» notify or are visible to others. «Привилегированные» change membership, access or delete shared content.
  - **Source:** the class is computed by the command from its contents; the agent cannot choose it.
  - **Example:** «Задача себе — обычное; задача Анне — заметное; приглашение в пространство — привилегированное».
- ⓘ next to «Лимиты» shows:
  - **Definition:** the maximum number of agent actions per minute / hour / day.
  - **Formula:** token bucket (Rox Mono): «ёмкость = лимит в час, пополнение = лимит/60 в минуту».
  - **Example:** «10 сообщений в минуту в общие чаты».
  - **When exceeded:** the action is paused and the notice «Лимит: повторю через 40 с» appears.

### 22.6 Audit viewer («Журнал действий»)
- **State:** `audit_log` rows visible to me: my agent and rules acting for me; admins see the workspace.
- **Composition:**
  - Filters: actor (my agent / rules / all), decision chips (выполнено · предложено · подтверждено · отклонено · отказано · лимит · ошибка · отменено), kind, date range; search.
  - Table: time · actor · action (human sentence) · target chip · decision badge · origin chip (message / session / rule) · ⋯ (details JSON, «Отменить» if possible).
  - The footer status «Цепочка проверена ✓ (последняя запись #48 211)» with [Проверить] runs the hash-chain verification. [Экспорт CSV].
- **Motion:** new rows insert at the top with a highlight (as in §18.9).
- **Transitions:** a row → a detail drawer (inspector) with the provenance timeline: proposed → approved → executed → readback.

### 22.7 Rate-limit and paused notices
- **Rate limit:** an inline system line in the thread «@rox: достигнут лимит «сообщения в чаты» — продолжу через 40 с» (one per hour per scope). ⓘ → §22.5.
- **Paused agent:** an `@rox` mention gets an inline note «Агент приостановлен · Возобновить». The chip shows a ⏸ glyph.

## 23. Invitations and placeholder members

### 23.1 Create team with invites
1. Global create (§3.2) «Новая команда…» or Settings → Workspaces → «Создать команду».
2. The dialog (560) has two steps:
   1. Name, icon, URL slug.
   2. «Пригласить по email»: a multi-line chip input (paste a comma or newline list; each chip is validated, and invalid ones are red), role select, optional message.
3. «Создать» → `workspaces.create` + `people.invite` (R4). Success screen: «Команда создана», with General chat open and invitees listed as «Приглашён».
- **Motion:** the step transition slides horizontally (`--motion-slow`). The chips pop in with `--ease-spring`.

### 23.2 Placeholder members in chats and lists
- **Composition:**
  - member lists show the placeholder avatar: initials from the email, dashed border, grey;
  - name = the email local part;
  - the «Приглашён» chip, and a tooltip «Ещё не зарегистрировался · приглашение отправлено 3 дня назад»;
  - an admin ⋯ menu: «Отправить ещё раз», «Отозвать приглашение», «Изменить роль».
- Mentioning a placeholder works (chip with a dashed outline). Notifications are held (DATA-MODEL §5.11).
- The General chat gets a system message per invite batch: «Марк пригласил anna@x.com, oleg@x.com».
- **Activation transition:** when they sign up, the system message «Анна присоединилась» appears. Every chip and avatar for that principal morphs from dashed to solid (cross-fade over `--motion-base`). Their name replaces the email.

### 23.3 Invitee sign-up landing
- An email link opens the web / desktop sign-up with «Марк приглашает вас в «⟨команда⟩»», the inviter's avatar, and «Вы уже в чате «Общий» — там N сообщений». After sign-up, the General chat opens with an «Новое для вас» divider, and the welcome DM (§21.2) arrives.

### 23.4 Team chat list and creating group chats / channels (D-v2-2, approved 2026-10-08)
**Team chat list** (Messenger filter column → section «Команда ⟨название⟩»)
- **State:** the team's chats that I can see: the General chat (always first, pinned), public chats I joined, private chats I belong to, and placeholders' pending membership counts.
- **Composition:**
  - Section header «⟨Команда⟩» with [+] (Создать чат ▾: «Групповой чат» · «Канал») and a ⋯ menu (Обзор чатов, Настройки команды).
  - Rows (60 px, Lark): avatar, name, last message, time, unread badge.
  - Glyphs by type: General: `house` glyph + «Общий» label. Channels: `#` prefix. Group chats: a stacked-avatar icon. Private chats: a 12 px `lock` glyph after the name. Public: no glyph.
  - Filter chips at the top of the list: Все · Группы · Каналы · Приватные.
- **Motion:** a new chat row slides in at its sort position (height expand, `--motion-base`). The unread badge bumps (`--motion-fast`).
- **Transitions:** «Обзор чатов» → the browse dialog. [+] → the create dialog.

**Create chat dialog** («Новый групповой чат» / «Новый канал»)
- **State:** creating either a group or a channel. The mode is switchable at the top.
- **Composition:** a dialog 560 wide.
  1. Segmented control «Групповой чат | Канал».
  2. Name: required for channels (placeholder «например, #дизайн»), optional for groups (auto-named from members). Channel only: a description field.
  3. **«Приватный»** toggle with a 16 px lock icon. The subtitle explains the state: «Только приглашённые участники видят этот чат и его историю» when on; «Любой участник команды может найти и присоединиться» when off. Defaults: channel = public, group = private. ⓘ opens the help popover (§2.6): who can see the chat, who can join, what happens with history.
  4. Members: people picker (people, emails → invitation flow §23.1). Optional for public channels («Можно добавить позже»).
  5. Channel only: «Писать могут: Все участники / Только администраторы».
  6. Footer: [Отмена] [Создать]. Create is disabled until the name is valid (channel) or ≥ 1 other member (group).
- **Motion:** switching group ↔ channel cross-fades the channel-only fields (height animates, `--motion-base`). The lock icon flips between open and closed (`--motion-fast`).
- **Transitions:** Create → `im.create_chat {kind, visibility, …}`. The new chat opens with a system message «⟨Имя⟩ создал(а) ⟨приватный⟩ канал #⟨имя⟩». When an agent proposes it, an approval card appears instead (§22.2).

**Browse public chats** («Обзор чатов»)
- A dialog 640 wide: search, a list of public group chats and channels (name, description, member count, «Вы участник» chip or [Присоединиться]).
- Private chats never appear here.
- Joining slides the row's button into «Открыть» (`--motion-fast`).

**Chat settings → Доступ**
- **Composition:** visibility switch Публичный / Приватный (owner / admin only; disabled for General with the tooltip «Общий чат команды всегда открыт для участников»), «Приглашать могут: Все участники / Только администраторы», members list with roles.
- **Transitions:** switching private → public shows a confirm dialog («История станет видна всем, кто присоединится»).

## 24. Settings → Automations («Автоматизации»)
- **State:** R1–R5 with enabled / params (`automation_rule`) and recent executions (`rule_execution`).
- **Composition:**
  - A list of rule cards (one per rule): icon, title (e.g. «Заметки и задача подготовки для встреч»), a one-line description, an enabled toggle (R1 per user; R2–R5 admin), «Параметры» (R1: «Для кого: только организатор / все участники из Rox», «Пропускать весь день», «Список задач: Бэклог»), and the last run «2 мин назад · успешно».
  - Tab «История»: a table of time · rule · trigger (chip) · status badge (успешно / частично / ошибка / пропущено) · steps «5/5» · [Повторить] for failed.
  - ⓘ «Идемпотентность»: «Каждое правило срабатывает для события один раз. Повторы и перезапуски не создают дубликатов. Ключ: R1:⟨событие⟩:⟨дата⟩:⟨владелец⟩».
- **Motion:** toggles as standard. A history row expands to its step list over `--motion-base`.
- **Transitions:** a step's receipt chip opens the created entity.


# Part A, v2.1 additions (§25–§28): agent panel everywhere, surface chrome, per-surface UX, cross-functional capabilities

These sections were added in the v2.1 pass (Mark, 2026-10-08). They are Part A and take precedence over Part B / Part C. They introduce no second rail, no second orchestrator and no editor fork. Every element is gated by a default-OFF flag:
- `agent.panel.v1` (§25);
- `workbench.chrome.surfaces.v1` (§26–§27);
- `xfn.capabilities.v1` (§28).

With these flags off, each surface keeps the v2 layout from §3.3 and §5–§24.

## 25. Agent panel «@rox» on every surface (PRD ADR-U19, M24; TECH-SPEC §18)

### 25.1 What it is
- One **persistent, context-aware chat with my agent `@rox`**. It is reachable from **every** surface: Home, Chat, Messenger, Docs / Wiki / Drive / Base / Forms, Tasks, Calendar, Meetings (including in-call), Goals & Projects, Contacts, Feed, Inbox, Agent center, Settings and Advanced search.
- It is the same agent as the agent DM and `@rox` mentions (ADR-U14). The panel conversation is an ordinary omp **session** with `origin='agent-panel'`, so there is no second orchestrator.
- It acts only through the command bus. Risk classes and approvals are the same as in §22.
- **Persistent:** the panel stays open, keeps its scroll position, draft and running work across navigation, mode switches, tab switches and app restarts. Restore covers the last topic, the draft and the dock state.
- **Context-aware:** it always knows the current surface, route, focused entity, selected entities and text selection (TECH-SPEC §18.1). It shows that context as chips and can act on it.

### 25.2 Entry points
| Entry | Behaviour |
|---|---|
| **⌘J** (Ctrl+J) | Toggle the panel: hidden → docked (or overlay, §25.5) → hidden. Focus goes to the composer. |
| **⌘⇧J** | "Ask about selection": opens the panel with the current selection attached as a context chip and the composer prefilled «Про выделенное: ». |
| Top-bar button **@rox** (always the last item in the top-right zone, §26.1) | Same as ⌘J. It carries a status dot: idle (none), thinking (pulsing accent), awaiting approval (amber, with count), error (red). |
| Right action rail (`InspectorActionRail`) | New first item **@rox** (sparkle-in-circle icon) with the same status dot. In the minimised state the panel lives here as a pill. |
| Entity context menu → «Спросить @rox» | Opens the panel with that entity as the focus chip (works on rows in any list, chips, cards and files). |
| Omnibox ⌘K → typing `@rox …` or `> ` | Sends the text to the panel and opens it. |
| Text selection bubble (docs, messages, mail, comments) → ✦ | Same as ⌘⇧J. |
| Notification / approval toast → «Открыть» | Opens the panel scrolled to the card. |

**Shortcut audit (v2.1).** At `aedff592`, ⌘J is not bound (`renderer/actions/definitions.ts`). The Docs-only "Find in doc" moves from ⌘J to the mode-aware ⌘F (§15). ⌘⇧J is unbound.

### 25.3 Anatomy (docked, default width 380, resizable 320–560)
```
┌───────────────────────────── @rox panel (380) ─────────────────────────────┐
│ ✦ @rox ▾  «Тема: План релиза»            ⟲ История   ⊕ Новая тема   ⇱  ─  × │  header 44
├────────────────────────────────────────────────────────────────────────────┤
│ Контекст: [📄 Документ «Q4 план» ×] [✂ Выделено: 3 абзаца ×] [+ Добавить]   │  context bar 36
├────────────────────────────────────────────────────────────────────────────┤
│  ── Перешли в «Документы» · Q4 план ──                (context divider)    │
│  Вы: Сделай задачи из выделенного                                          │
│  @rox: Предлагаю 4 задачи:                                                 │
│   ┌ Требует подтверждения · истекает через 23 ч ──────────────────────┐   │
│   │ ☐ Подготовить смету — Анна, пт       ☐ Согласовать бюджет — Олег │   │  approval card (§22.2)
│   │ [Подтвердить] [Изменить] [Отклонить] ⋯                            │   │
│   └───────────────────────────────────────────────────────────────────┘   │
│  ✓ Готово · 4 задачи [Задача ▸] [Задача ▸] … [Отменить] [Журнал]          │  report card
├────────────────────────────────────────────────────────────────────────────┤
│ Быстрые действия: [Кратко] [Задачи из выделенного] [Предложить правки] ⋯  │  quick actions 36
│ ┌──────────────────────────────────────────────────────────────────────┐   │
│ │ Спросите @rox или дайте поручение…                    📎  @  /  ➤   │   │  composer (min 48)
│ └──────────────────────────────────────────────────────────────────────┘   │
│ Режим: Спрашивать ▾ · модель по умолчанию · 🔒 видит только то, что вы      │  footer 24
└────────────────────────────────────────────────────────────────────────────┘
```
- **Header:**
  - topic title (click to rename);
  - ⟲ History, a popover of panel topics grouped by day, with search;
  - ⊕ New topic;
  - ⇱ «Открыть в Чате», which opens the same session full-size in Chat mode;
  - ─ minimise to a pill;
  - × hide.
  - ▾ next to `@rox` opens: pause agent, permissions (→ Settings → Agent), audit log (→ §22.6), panel settings.
- **Context bar:**
  - shows what the agent will receive with the next message;
  - each chip can be removed (× excludes it for this message) or locked (📌 keeps it across navigation);
  - «+ Добавить» opens the EntityPicker;
  - private local notes and DMs are **never attached automatically**: they appear as a dashed chip «Личная заметка — добавить?» that needs a click (TECH-SPEC §18.3).
- **Thread:**
  - message rendering of Chat mode (`ChatPage` renderer), with entity chips, cards and the §22 action cards;
  - a **context divider** is inserted when the surface or focus changes between two messages, e.g. «── Перешли в Задачи · Сегодня ──».
- **Quick actions:**
  - up to 4 chips plus ⋯, provided by the current surface's context provider (§25.7);
  - they change with the surface;
  - clicking one sends a templated instruction with the current context.
- **Composer:**
  - the TipTap minimal composer;
  - `@` people and entities, `/` panel commands (`/summarize`, `/tasks`, `/schedule`, `/draft`, `/find`, `/explain`, `/new-topic`), 📎 attach (Drive / upload), paste images;
  - ↵ sends, ⇧↵ adds a newline, ↑ in an empty composer edits the last message, Esc returns focus to MAIN.
- **Footer:**
  - permission mode (the existing `chat.cyclePermissionMode`, Shift+Tab when the composer is focused);
  - model;
  - the privacy hint ⓘ: «Агент видит только то, к чему у вас есть доступ, и только то, что в строке контекста».

### 25.4 States
| State | Look | Transitions |
|---|---|---|
| Hidden | nothing rendered; top-bar **@rox** button and rail icon show the status dot only | ⌘J, button, context menu → Docked / Overlay |
| Docked · idle | full panel; composer focused on open; empty topic shows the greeting «Чем помочь? Я вижу: ⟨контекст⟩» and the 4 quick actions as large cards | send → Thinking |
| Thinking / streaming | «@rox думает…» shimmer line, then streamed text; ■ Stop button replaces ➤ (existing `chat.stopProcessing`, Esc twice) | done → Idle; tool step → Running |
| Running (multi-step) | a step list card: ◌ running / ✓ done / ✕ failed per command, each with the command's human label | approval needed → Awaiting approval |
| Awaiting approval | the approval card (§22.2) pinned at the bottom of the thread above the composer; top-bar dot amber with count; Inbox → Review gets the row | approve / reject / expire |
| Minimised | a pill in the right action rail: `✦ 2` (unread replies) with status dot; hover shows the last line | click → Docked; new reply → pill bumps (scale 1 → 1.15 → 1, `--motion-fast`) |
| Overlay | same content, floating over MAIN, shadow-popover, does not reflow (§25.5) | 📌 pin → Docked when width allows |
| Paused agent | banner «Агент приостановлен» + [Возобновить]; composer disabled | resume → Idle |
| Rate limited | inline system line «Лимит: продолжу через 40 с» (§22.7) | timer → Running |
| Offline / no model | banner «Нет соединения с моделью. Сообщения отправятся, когда связь появится» (queued in the client outbox) | reconnect → Thinking |
| Restricted context | the chip shows 🔒 «Нет доступа»; the agent is told the item exists but is restricted (no content) | remove chip |
| Error | ✕ «Не получилось: ⟨reason⟩» + [Повторить] + details | retry → Thinking |

### 25.5 Docking and coexistence with quick panels (328), task detail (560) and collaboration panels
The right side of the window is one **right dock** made of the inspector column and the agent column, followed by the existing right action rail. Rules, in order:

1. **Side-by-side** when `window width ≥ rail 48 + sidebar + MAIN min 640 + inspector + agent + action rail`. Typical cases:
   - ≥ 1720 with a 328 quick panel;
   - ≥ 1952 with the 560 task detail.

   Order from left to right: MAIN │ inspector (quick panel / collaboration / task detail) │ agent panel │ action rail.
2. **Shared dock** when the window is narrower than rule 1 but ≥ 1280:
   - the inspector and the agent share **one column** with a 32 px tab strip on top: `[✦ @rox] [💬 Комментарии 3] [☑ Задачи]`;
   - the agent tab is always first;
   - opening a quick panel (⌃1…4, header buttons) or a collaboration panel switches the column to that tab, and the agent keeps running with its status dot on its tab;
   - ⌘J switches back to the agent tab;
   - the column width is the larger of the two panels' preferred widths (agent 380, quick 328, comments 360). The task detail (560) keeps its 560.
3. **Overlay** when the window is < 1280 or MAIN would drop below 640:
   - the agent panel floats over MAIN at the right edge (380, full height under the top bar, shadow-popover);
   - it closes on Esc or on click-outside unless pinned;
   - pinning in this width collapses the left sidebar to 56 first; if that is still not enough, the panel stays an overlay and 📌 is disabled with the tooltip «Недостаточно ширины окна».
4. **Before the agent shrinks MAIN,** the left sidebar auto-collapses to 56 (and re-expands when the panel closes, unless the user collapsed it manually).
5. **Edge reveal (§18.6).** The collaboration panels' 8 px hot zone moves from the window edge to the left edge of the right dock while the agent is docked. Edge reveal never opens over the agent panel.
6. **In-call (Meetings).**
   - The call's right panels (Participants · Chat · Minutes · Notes, 328) are inspector tabs.
   - The agent joins the shared-dock tab strip, with context = the meeting.
   - The agent never speaks in the call and only writes in the panel.
7. **Full-screen surfaces** (Base grid in full-screen, doc presentation mode, screen share): the panel is available as an overlay only.
8. **Multiple windows:**
   - each window has its own panel visibility and width;
   - the topic is shared per workspace, so the same topic is open in each window and updates live;
   - a "pop-out" ⇱ goes to Chat mode, not to a floating OS window.

Widths and the dock state are stored per window and per surface class (list surfaces vs page surfaces) in `{configDir}/ui/agent-panel.json` (`~/rox/…`, ADR-U13).

### 25.6 Motion
| Moment | Motion |
|---|---|
| Open (docked) | the column width animates 0 → 380 (layout animation), content fades + translateX(16 → 0) over `--motion-base` `--ease-out`; MAIN reflows in the same frame budget |
| Open (overlay) | translateX(100% → 0) over `--motion-base`, shadow fades in; scrim none |
| Close | reverse with `--ease-in` over `--motion-fast` |
| Minimise | FLIP from panel to the action-rail pill over `--motion-base`; the pill gets a 1-cycle glow |
| Context change | the old chips fade out (`--motion-instant`), the new ones slide in from 4 px below (`--motion-fast`); the divider line draws left → right (`--motion-base`) |
| Streaming | token fade-in per chunk (opacity 0.4 → 1, 80 ms); no layout jumps: the thread autoscrolls only when already at the bottom; otherwise a «↓ Новые» chip appears |
| Shared-dock tab switch | crossfade 120 ms; the tab underline slides (200 ms, as Operately tabs §2) |
| Approval card | §22.2 slide-up; the top-bar dot turns amber with a single pulse |

Under `prefers-reduced-motion`, every transform becomes an opacity change of ≤ 80 ms, and streaming shows whole lines.

### 25.7 Context per surface (what the agent sees; quick actions)
| Surface | Focus entity | Selection | Visible set (≤ 50 refs) | Quick actions (first 4) |
|---|---|---|---|---|
| Home | — | — | today's agenda items (§28 X-21) | «План на день» · «Что я пропустил» · «Разобрать входящие» · «Черновик статуса» |
| Chat (sessions) | the open session | selected messages | session list rows | «Кратко о сессии» · «Задачи из сессии» · «Продолжить в новой теме» · «Найти похожее» |
| Messenger | the open chat (and thread) | selected messages | unread messages in the chat (≤ 50) | «Сводка непрочитанного» · «Черновик ответа» · «Задачи из обсуждения» · «Назначить встречу» |
| Docs / Wiki | the doc | text selection (≤ 2,000 chars) or blocks | headings + linked entities | «Кратко» · «Задачи из выделенного» · «Предложить правки» · «Найти связанное» |
| Drive | the folder or file | selected files | folder rows | «Что занимает место» · «Разложить по папкам» · «Кратко о файле» · «Поделиться с…» |
| Base / Forms | the base / form | selected rows / cells | visible rows (≤ 50) | «Сводка по таблице» · «Формула…» · «Найти дубли» · «Сделать задачи» |
| Tasks | the open task or list | selected tasks | visible tasks | «Распланировать день» · «Разбить задачу» · «Расставить приоритеты» · «Перенести просроченные» |
| Calendar | the selected event or day / week | selected events | events in the visible range | «Найти время» · «Подготовить к встрече» · «Освободить вечер» · «Итоги недели» |
| Meetings | the meeting / call | transcript selection | participants, agenda | «Итоги встречи» · «Задачи из встречи» · «Что решили» · «Письмо участникам» |
| Goals / Projects | the goal / project | selected rows on the Work Map | children + latest check-ins | «Черновик чек-ина» · «Риски» · «Что блокирует» · «Сводка для ревью» |
| Contacts | the person | selected people | directory rows | «Кто этот человек» · «Общие дела» · «Назначить встречу» · «Написать» |
| Inbox / Mail | the item / email thread | selected items | visible items | «Разобрать» · «Черновик ответа» · «Задача из письма» · «Отложить неважное» |
| Feed | the item | selected items | visible items | «Главное за день» · «В задачи» · «В заметку» · «Отписаться от шума» |
| Agent center | the run | — | runs | «Почему застряло» · «Остановить лишнее» · «Отчёт по бюджету» · — |
| Settings | the settings page | — | — | «Объясни настройку» · «Как сделать…» · — · — |

- Each wave-2 surface package registers its provider in the slot `agent.context.<surface>` (TECH-SPEC §18.2).
- A surface without a provider still gets route + title context and the generic quick actions «Кратко», «Найти», «Создать задачу», «Объясни».

### 25.8 Acting on the current context
- **Commands only.** Each proposal becomes the same command envelope as any UI action (`origin: {kind:'agent-panel', sessionId, surface}`), and the risk class decides auto vs approval (§22).
- **Docs:** the agent never edits a shared doc directly. «Предложить правки» creates **suggestions** (§18.4) authored by `@rox` on my behalf. In a private local note it shows a diff card [Применить] [Отклонить] and applies through `docs.apply_patch`.
- **Selections:** the agent may highlight the entities it refers to. Hovering a chip in the panel outlines the matching row or block in MAIN (a 2 px accent outline, `--motion-fast`). Clicking scrolls to it.
- **Undo:** the report card's «Отменить» (10 min) reverses reversible commands (§22.2).
- **Navigation:** the agent can propose «Открыть ⟨сущность⟩» as a button but never navigates on its own.

### 25.9 Strings (EN / RU)
| Key | EN | RU |
|---|---|---|
| `agentPanel.title` | @rox | @rox |
| `agentPanel.placeholder` | Ask @rox or give it a task… | Спросите @rox или дайте поручение… |
| `agentPanel.newTopic` | New topic | Новая тема |
| `agentPanel.history` | History | История |
| `agentPanel.openInChat` | Open in Chat | Открыть в Чате |
| `agentPanel.context` | Context | Контекст |
| `agentPanel.addContext` | Add | Добавить |
| `agentPanel.privateChip` | Private note — attach? | Личная заметка — добавить? |
| `agentPanel.movedTo` | Moved to %{surface} · %{title} | Перешли в %{surface} · %{title} |
| `agentPanel.noWidth` | Not enough window width | Недостаточно ширины окна |
| `agentPanel.askAbout` | Ask @rox | Спросить @rox |
| `agentPanel.privacyHint` | The agent sees only what you can access and what is in the context bar | Агент видит только то, к чему у вас есть доступ, и только то, что в строке контекста |

## 26. Surface chrome: left sidebar and top bar per surface (PRD ADR-U20, M25; TECH-SPEC §19)

### 26.1 Global rules
**One rail.** The existing Rox mode rail (§3.1) is the only rail. Sub-areas of a mode (for example Wiki, Drive, Base and Forms inside «Документы») live in that mode's **left sidebar**, never in a second rail or a second icon column.

**Window anatomy (classic layout, all surfaces):**
```
┌──────────────────────────── titlebar (existing: mode pill / tabs / Omnibox ⌘K / window controls) ───────────────────────────┐
├────┬────────────────────┬───────────────────────────── TOP BAR 44 (per surface) ─────────────────────────┬───────────┬──┬────┤
│RAIL│ LEFT SIDEBAR       │ ◧ ‹ › Breadcrumb › Title  ●status │  [ View switch / date nav ]  │ ⚲ ⛃ 🔍 (AB+2) Share ⋯ │ INSPECTOR │AG│ AR │
│ 48 │ 220–280 (→56)      ├──────────────────────────────────────────────────────────────────────────────────┤ 328/360/  │  │ 44 │
│    │ Header: Title 🔍 [+▾]│ MAIN (≥ 640; content max-width 1152 on page surfaces)                          │ 560       │380│    │
│    │ Закреплённое        │                                                                                │ (§18.6)   │  │    │
│    │ Sections…           │                                                                                │           │  │    │
│    │ Footer · «« ⌘B      │                                                                                │           │  │    │
└────┴────────────────────┴────────────────────────────────────────────────────────────────────────────────┴───────────┴──┴────┘
 RAIL = mode rail · AG = agent panel (§25) · AR = right action rail (InspectorActionRail)
```
In the unified five-slot shell (flag), the left sidebar is the NAVIGATOR slot and the list column is COLLECTION. The top bar renders above MAIN in both layouts.

**Left sidebar anatomy (every surface):**
1. **Header row (40):**
   - surface title (15/600);
   - 🔍 filter-in-sidebar (it filters the sidebar lists and is not the global search);
   - the primary **[+ ▾] create split button**: + runs the surface default (New chat, New doc, New task…), ▾ lists the surface's other create items (subset of §3.2).
2. **«Закреплённое» (Pinned)**, X-26. It shows the pinned items of this surface's kinds. It is hidden when empty. Items can be reordered by drag.
3. **Primary views** (fixed, product-defined order). Each row is 32 high: icon 16 + label + right-aligned counter.
4. **User sections** (lists, folders, spaces, labels…). The section header is 11/600 uppercase `--text-muted` with a chevron; on hover it shows `+` and `⋯` (rename, sort, hide section).
5. **Footer** (optional, surface specific): quota meter, org row, sync status. Then the collapse control «« (⌘B, the existing `view.toggleSidebar`).

**Counters.**
- A **red filled** pill means something needs my action: mentions, overdue, approvals, invitations.
- A **grey text** count is just volume (unread in muted chats, items in a list).
- Counters above 99 show «99+».
- In the collapsed state a counter becomes an 6 px dot (red or grey).

**Collapsed state (56).**
- Icons only, with tooltips (label + counter).
- The header becomes the create «+» icon.
- Pinned items show as their kind icon (max 5, then «⋯»).
- Hover on the collapsed sidebar for 300 ms shows a full-width **peek overlay** (does not reflow). ⌘B expands it.

**Width.**
- Each surface sets a default width (matrix below), resizable 220–360. Dragging below 200 snaps to 56.
- The width and collapsed state are remembered per surface in `{configDir}/ui/chrome.json`.

**Common row context menu**, plus surface-specific items from the matrix:
- Открыть · Открыть в новой вкладке · Открыть справа (split, where supported);
- Закрепить / Открепить;
- Копировать ссылку;
- Поделиться в чат…;
- **Спросить @rox**;
- Напомнить… (X-16);
- divider;
- surface-specific items;
- divider;
- Переименовать · Архивировать / Удалить (by permission).

**Drag and drop (X-13).**
- Rows are draggable as entity refs.
- Dropping an entity on a sidebar row (a task list, folder, chat, space or goal) runs the matching command with a 2 px accent drop outline and a toast «Добавлено в ⟨…⟩ · Отменить».

**Top bar anatomy (44, above MAIN, per surface).** Three fixed zones, in the same order on every surface.

| Zone | What always goes here | Rules |
|---|---|---|
| **Left: "where am I"** | ◧ sidebar toggle (only while the sidebar is collapsed) · ‹ › back / forward (existing `nav.goBack/Forward`) · breadcrumb (container › item, max 3 crumbs, middle-truncated) · inline-editable title on page surfaces · status chip / privacy chip | the breadcrumb root is the surface name and is clickable; a long title truncates before the crumbs do |
| **Center: "how am I looking at it"** | the view switcher (segmented control, 28 high, max 5 visible + «Ещё ▾»), **or** a date navigator (‹ Сегодня › + range label), **or** page tabs (Operately tabs with count chips) | exactly one center control per surface; under 1100 px window width it collapses into a dropdown labelled with the current view |
| **Right: "who is here and what can I do"** | fixed order: filter ⚲ · sort / group ⛃ · 🔍 search-in-surface · presence facepile (shared objects; max 3 + «+N») · **Share** (shared objects) · one surface primary action (e.g. «Начать встречу», «Чек-ин») · ⋯ more · divider · **@rox** (always last, §25.2) | the "create" primary for the surface lives in the sidebar header, not here; the top bar holds object-level actions; icons get tooltips with shortcuts |

The titlebar (mode pill, tabs, Omnibox trigger, window controls) is unchanged. The top bar never hosts window controls or the global search field. The global search stays the Omnibox (⌘K) and Advanced search (⌘⇧F).

**Responsive.**
- **< 1280:** facepile shows the count only; Share becomes an icon.
- **< 1100:** the center control becomes a dropdown.
- **< 960:** the breadcrumb shows only the last crumb; filter, sort and search fold into ⋯.

### 26.2 Matrix A: left sidebar per surface
| Surface (rail) | Default width | Header: title · [+] default · [▾] items | Sections, in order | Counters | Collapsed (56) | Surface-specific context-menu items |
|---|---|---|---|---|---|---|
| Home (10) | 240 | «Главная» · + New task · ▾ doc / event / message / meeting / goal | Закреплённое · Сегодня (agenda X-21) · Недавние (10, all kinds) · Приложения (Workplace favourites) · Пространства (my spaces) | Сегодня: red = overdue + approvals | icons for Today / Recent / Apps / Spaces | Убрать из недавних |
| Chat, AI sessions (20) | 260 (existing) | «Чат» · + New session · ▾ in panel / from template | **existing session navigator kept**: Закреплённое · Все сессии · Отмеченные · Архив · Статусы ▸ · Метки ▸ · Виды ▸ · Проекты ▸; v2.1 adds «Панель @rox» (panel topics) | unread agent replies (grey), waiting for permission (red) | existing | Открыть в панели @rox · Связать с задачей |
| Messenger (25) | 280 | «Мессенджер» · + New message · ▾ New chat / New group / New channel / Browse public chats | Search row · Фильтр ▸ (Chats, Unread, Flagged, Mentions, Labels, DMs, Groups, Channels, Docs, Threads & Topics, Done; collapsible) · Закреплённое · chat list (pinned chats, then by last activity) · section «Команды» (per team: General first, then public, then private 🔒) | per chat: red = mentions / DM unread, grey = group unread; muted chats grey only | filter icons; chat avatars of pinned chats | Пометить прочитанным · Закрепить чат · Выключить уведомления · Метка… · Покинуть · Скрыть |
| Docs (50): Docs home, doc page | 280 | «Документы» · + New doc · ▾ Doc / Note (private) / Base / Form / Mind map / Folder / Upload | Search · Главная · Закреплённое · Недавние · Общие со мной · **Wiki ▸** (spaces) · **Диск ▸** (§20) · **Базы ▸** · **Формы ▸** · Папки ▸ (shared tree) · Личные заметки ▸ (vault tree, existing) · Корзина | comment mentions on docs (red), shared-with-me new (grey) | icons for Home / Wiki / Drive / Bases / Forms / Vault | Переместить… · Сделать общим (#1112) · Дублировать · Экспорт в Markdown · Показать в Finder (local) |
| Wiki (inside Docs) | 280 | «Wiki» · + New page · ▾ New wiki space | ‹ Документы (back row) · space switcher ▾ · page tree (drag to nest, max depth 10) · Участники пространства · Настройки Wiki | page comment mentions (red) | tree icons | Добавить подстраницу · Переместить · Копировать ссылку на раздел |
| Drive (inside Docs) | 280 | «Диск» · + Upload · ▾ Folder / Upload folder / New doc here | ‹ Документы · Главная диска · Мой диск ▸ (folder tree) · Доступные мне · Недавние · Помеченные · Корзина · — · virtual folders (Артефакты агентов, Файлы из чатов, Вложения заметок, Записи встреч) · footer: quota meter | Доступные мне: grey new; quota ≥ 90%: red dot | icons + quota ring | Загрузить новую версию · Переместить · Звёздочка · Скачать · Прикрепить к задаче (X-13) |
| Base (inside Docs) | 260 | «Базы» · + New base · ▾ from template / import CSV / from Rox data | ‹ Документы · Закреплённое · Мои базы · Общие · per open base: tables ▸ and views ▸ | — | base icons | Дублировать таблицу · Экспорт CSV · Автоматизации базы |
| Forms (inside Docs) | 260 | «Формы» · + New form · ▾ from template / from base | ‹ Документы · Мои формы · Общие · Черновики · Закрытые | new responses (grey) | form icons | Открыть ответы · Закрыть приём · Копировать ссылку на форму |
| Tasks (40) | 224 | «Задачи» · + New task (⌘N, QuickEntry) · ▾ task list / section / from template | Search · Входящие · Сегодня · Предстоящие · В любое время · Когда-нибудь · Журнал · — · **Lark:** Мои задачи · Назначенные мной · Подписан · Недавние · Все · — · Закреплённое · Списки задач ▸ (groups = Areas) · Доски проектов ▸ (Operately boards linked from projects) | Сегодня (red if overdue), Входящие (grey), Назначенные мне new (red) | Things icons | Переименовать список · Поделиться списком · Архивировать список · Перенести задачи… |
| Calendar (35) | 240 | «Календарь» · + New event · ▾ meeting / time block (X-14) / out-of-office | mini month · Мои календари (colour checkboxes) · Подписки · Слои (Tasks with due dates, Milestones, Check-ins due, Time blocks) · Переговорные · Часовые пояса · footer: connected accounts status | invitations awaiting reply (red) | mini month → today's date chip; calendar colour dots | Показать только этот · Цвет · Настройки календаря · Поделиться календарём |
| Meetings (30) | 260 | «Встречи» · + Start meeting · ▾ schedule / join by link / record locally | Сейчас (live calls, with a pulsing dot) · Предстоящие (next 7 days) · История (existing list, by day) · Записи · Итоги (published outcomes X-15) | live (red dot), outcomes awaiting review (grey) | live dot + history icon | Открыть итоги · Открыть чат встречи · Открыть заметки |
| Goals & Projects (45) | 240 | «Цели и проекты» · + New goal · ▾ project / KPI / space / from template | Карта работ · Моя работа · Закреплённое · Цели ▸ (my / team / company) · Проекты ▸ (active / paused / closed) · Мои OKR · Согласование (alignment) · Ревью (check-ins to acknowledge) · KPI · Пространства ▸ · Шаблоны | Ревью (red = awaiting my acknowledgement), check-ins due (red) | icons | Чек-ин · Изменить статус… · Связать с целью (X-18) · Закрыть / Приостановить |
| Contacts (55) | 280 | «Контакты» · + Invite people · ▾ external contact / group | org row (workspace + Manage) · Сотрудники · Оргструктура · Внешние контакты · Новые контакты · Избранные · Мои группы · Досье | new contact requests (red) | icons | Написать · Позвонить · Назначить встречу · Открыть досье · В избранное |
| Feed (60) | 240 | «Лента» · + Add source · ▾ RSS / page / X list | existing tabs as rows: Действия агентов · Команда · Новости · Подписки · — · Источники ▸ · Метки ▸ | unread per source (grey) | icons | Отметить прочитанным · В задачи · В заметку · Отписаться |
| Inbox (70) | 260 (existing) | «Входящие» · + Compose (mail) · ▾ new reminder | Все · **Ревью** · Упоминания · Решения · Сообщения · Уведомления · Почта ▸ (folders) · Отложенные · Готово | Ревью / approvals (red), Упоминания (red), others grey | icons + red dot | Отложить… · Готово · Открыть источник · Создать задачу |
| Agent center («Ещё» group) | 240 | «Агенты» · + New background run · ▾ schedule request | Ждут меня (approvals) · Выполняются · Застряли · Облачные · Автоматизации · Бюджет · — · Мой агент @rox (→ Settings → Agent) · Журнал действий | approvals (red), stuck (red), running (grey) | icons | Остановить · Приостановить · Открыть сессию · Журнал |
| Settings (rail bottom) | 240 | «Настройки» (no create) | existing groups kept; v2/v2.1 rows: Агент · Автоматизации · Уведомления · Мессенджер · Календари · Каталог · Хранилище · Внешний вид (profiles §2.6) · **Панели и боковые панели** (§26.4) | — | icons | — |
| Advanced search (⌘⇧F, no rail entry) | 240 | «Поиск» (no create) | Типы (kind checkboxes with counts) · Где (spaces / chats / folders) · Кто (authors) · Когда (date presets) · Сохранённые поиски | result counts per kind (grey) | icons | Сохранить поиск · Удалить сохранённый |

### 26.3 Matrix B: top bar per surface
| Surface | Top-left | Top-center | Top-right (in the fixed order of §26.1; only the items that apply) |
|---|---|---|---|
| Home | «Главная» · date «Чт, 8 октября» | segmented **Обзор · Приложения · Активность** | ⋯ (customise widgets) · @rox |
| Chat (sessions) | existing session title + status (kept) | existing **Список · Доска · Таблица · Тепловая карта** (`collection.view*`) | existing session actions · ⋯ · @rox |
| Messenger: conversation | ‹ › · avatar + chat name · 🔒 / # glyph · member count · external tag | chat tabs (Lark tabs: Чат · Закреплённое · Файлы · Документы · ⟨entity tabs⟩ · +) | 🔍 in chat · (presence: typing / online in DMs) · quick panels ⌃1–4 (Docs, Tasks, Calendar, Contacts) · 📞 call · ⋯ (chat settings) · @rox |
| Docs home | «Документы» | **Главная · Недавние · Общие со мной · Избранное** | ⚲ type / owner · ⛃ sort · 🔍 · ⋯ · @rox |
| Doc page | ‹ › · breadcrumb (Wiki / folder › doc) · title · AuthorityBadge («Личное» / space) · saved status «Сохранено» | — (none; TOC lives in MAIN) | presence facepile · 💬 comments badge · ✎ Suggest toggle (Редактирование / Предложения / Просмотр) · **Share** · ⋯ (history, export, move, make shared) · @rox |
| Wiki page | ‹ › · Wiki space › parent › page | — | presence · 💬 · Share · ⋯ · @rox |
| Drive | ‹ › · «Диск» › folder path | **Список · Сетка** | ⚲ type / owner / modified · ⛃ sort · 🔍 in folder · Share (folder) · ⋯ · @rox |
| Base | ‹ › · base › table | view tabs (Grid · Kanban · Gallery · Gantt · Calendar · + Add view) | ⚲ Filter · ⛃ Sort / Group · 🔍 · presence · Share · Automations · ⋯ · @rox |
| Form | ‹ › · «Формы» › form | **Вопросы · Ответы · Настройки** | presence · Preview · **Опубликовать / Поделиться** · ⋯ · @rox |
| Tasks | ‹ › · list name (or view name) · share chip if shared | **Список · Доска · Гантт · Календарь** (per list; Things views keep List only) | ⚲ · ⛃ group by (section / assignee / status / due) · 🔍 · presence (shared lists) · Share (list) · ⋯ · @rox |
| Calendar | «Календарь» · range label «6–12 окт. 2026» | date navigator **‹ Сегодня ›** + **День · Неделя · Месяц** | 🔍 people / events · ⋯ (settings, time zones) · @rox |
| Meetings: landing / history | «Встречи» | **Предстоящие · История · Записи** | 🔍 · **Начать встречу** · ⋯ · @rox |
| Meetings: in-call | meeting title · ● REC · timer | layout switch **Галерея · Докладчик · Документ** | participants count · Share screen · ⋯ · Leave · @rox |
| Goals: Work Map | «Карта работ» | **Дерево · Таблица · Гантт** + scope chips (Все · Мои · Команда) | ⚲ status / owner / space · ⛃ · 🔍 · ⋯ · @rox |
| Goal page | ‹ › · space › parent goal › goal · StatusBadge · timeframe | tabs **Обзор · Чек-ины · Обсуждения · Связанное · Документы и файлы · Задачи** (count chips) | presence · **Чек-ин** · Share · ⋯ (edit, close, move, privacy) · @rox |
| Project page | ‹ › · space › project · StatusBadge | tabs **Обзор · Задачи · Вехи · Чек-ины · Обсуждения · Ресурсы · Рабочая область** | presence · **Чек-ин** · Share · ⋯ · @rox |
| Space | ‹ › · «Пространства» › space | tabs **Обзор · Цели · Проекты · Обсуждения · Документы · Участники** | presence · Join / Leave · Share · ⋯ · @rox |
| Contacts | ‹ › · section (Сотрудники / person name) | Directory: **Таблица · Карточки**; profile: tabs **Задачи · Назначено · На ревью · Активность · О себе** | ⚲ department / type · 🔍 · profile: **Написать · Позвонить · Встреча** · ⋯ · @rox |
| Feed | «Лента» › tab | **Все · Непрочитанные · Помеченные** | ⚲ · 🔍 · ⋯ · @rox |
| Inbox | «Входящие» › view | Review: **Мне · Назначенное мной**; Notifications: kind chips; Mail: — | ⚲ · 🔍 · batch actions (on selection) · ⋯ · @rox |
| Mail (reading) | ‹ › · folder › subject | — | Reply · Reply all · Forward · **Поделиться в чат** · **Создать задачу** · ⋯ · @rox |
| Agent center | «Агенты» › view | **Активные · История** | ⚲ actor / status · **Приостановить всех** (admin) · ⋯ · @rox |
| Settings | «Настройки» › page | — | 🔍 settings search · @rox |
| Advanced search | «Поиск» | query field (the only surface whose center is a text field) | ⛃ sort (relevance / date) · Сохранить поиск · @rox |

### 26.4 Settings → «Панели и боковые панели»
- **Per surface:** default sidebar width, «Сворачивать автоматически при открытии @rox» (on), show counters (red only / all / none), show «Закреплённое» (on).
- **Agent panel:** default dock (docked / overlay / minimised), default width, «Открывать при запуске» (off), «Прикреплять контекст автоматически» (on), «Показывать быстрые действия» (on).
- **Reset layout**: restores all chrome defaults.

## 27. Per-surface UX: wireframes, features, layouts and states
Each subsection gives an ASCII wireframe at 1440 × 900 with the agent panel hidden (§25.5 describes the docked case), the features, the states, and the key behaviours. The left sidebar and top bar follow §26.2 / §26.3. Glyphs: `[+▾]` create split button, `(AB+2)` presence facepile, `✦` @rox button, `⚲` filter, `⛃` sort / group.

### 27.1 Home («Главная»)
```
┌────┬──────────────────────┬──────────────────────────────────────────────────────────────────────────────┐
│ ⌂  │ Главная     🔍 [+▾]  │ Главная · Чт, 8 октября      [ Обзор | Приложения | Активность ]       ⋯  ✦ │
│ 💬 │ ★ ЗАКРЕПЛЁННОЕ       ├──────────────────────────────────────────────────────────────────────────────┤
│ ✉  │   Q4 план            │ ┌ Быстрая задача: «Добавить задачу…» ──────────────────────────────── ↵ ┐   │
│ ▶  │ СЕГОДНЯ          3 ● │ ┌ Сегодня (X-21) ───────────────┐ ┌ Нужно моё внимание ────────────────┐   │
│ 📅 │   10:00 Синк Rox     │ │ 10:00 Синк по Rox   [Войти]   │ │ ● 2 подтверждения @rox  [Открыть]  │   │
│ ☑  │   Отчёт (просрочено) │ │ ☐ Отчёт · просрочено          │ │ ● 3 упоминания                     │   │
│ ◎  │ НЕДАВНИЕ             │ │ ☐ Чек-ин «Рост» до пт         │ │ ● Чек-ин «Рост» ждёт ревью         │   │
│ 📄 │   📄 Q4 план         │ └───────────────────────────────┘ └────────────────────────────────────┘   │
│ 👥 │   ☑ Смета            │ ┌ Мои цели и проекты ───────────┐ ┌ Недавние документы ────────────────┐   │
│ 📰 │ ПРИЛОЖЕНИЯ           │ │ ● Рост выручки   По плану 62% │ │ 📄 Q4 план · Анна правила 5 мин    │   │
│ 📥 │   Base · Формы · …   │ │ ● Rox 2.0        Внимание 40% │ │ 📄 Ретро · вчера                   │   │
│    │ ПРОСТРАНСТВА         │ └───────────────────────────────┘ └────────────────────────────────────┘   │
│ ⚙  │   Продукт · Продажи  │                                                                              │
└────┴──────────────────────┴──────────────────────────────────────────────────────────────────────────────┘
```
- **Features:**
  - quick task input (#1091 kept);
  - the cross-surface **Сегодня** agenda (X-21);
  - «Нужно моё внимание» (approvals, mentions, reviews, invitations);
  - goal / project cards with status and progress;
  - recent docs with the last editor;
  - Workplace apps (tab «Приложения»);
  - team activity (tab «Активность», day-grouped).
- **Layout:** a 2-column widget grid (min column 420) inside max-width 1152. Widgets reorder by drag; ⋯ → «Настроить виджеты».
- **States:**
  - first run: welcome card + «Подключить календарь» + «Пригласить команду»;
  - no workspace: personal widgets only;
  - loading: skeleton cards;
  - widget error: inline «Не удалось загрузить · Повторить».
- **Behaviour:** every widget row is an EntityChip-capable row (hover card, drag to other surfaces, «Спросить @rox»).

### 27.2 Chat, AI sessions (existing)
```
┌────┬──────────────────────┬──────────────────────────────────────────────────────────────────────────────┐
│    │ Чат         🔍 [+▾]  │ ‹ › Рефакторинг shell ● идёт   [ Список | Доска | Таблица | Тепл. ]   ⋯  ✦ │
│    │ ★ ЗАКРЕПЛЁННОЕ       ├──────────────────────────────────────────────────────────────────────────────┤
│    │ Все сессии       12  │  (existing ChatPage: messages, tool calls, permission prompts, composer)     │
│    │ Отмеченные           │                                                                              │
│    │ Архив                │                                                                              │
│    │ СТАТУСЫ ▸ МЕТКИ ▸    │                                                                              │
│    │ ПАНЕЛЬ @ROX ▸        │  ← v2.1: panel topics (origin='agent-panel')                                 │
└────┴──────────────────────┴──────────────────────────────────────────────────────────────────────────────┘
```
- **Unchanged:** the session navigator, views, permission modes, branching, side threads.
- **v2.1:** a section «Панель @rox» lists the agent-panel topics. Opening one shows it full-size; ⇲ «Вернуть в панель» docks it back. Session rows get «Связать с задачей» (`entity_link derived-from`).
- **Agent panel on this surface:** it is available but defaults to hidden, because MAIN is already an agent chat. ⌘J still toggles it so that the agent can act on the selected session.

### 27.3 Messenger
```
┌────┬──────────────────────────┬─────────────────────────────────────────────────────────────────────────┐
│    │ Мессенджер     🔍 [+▾]   │ ‹ › 🟢 Анна Петрова · в сети    [ Чат | Закреп. | Файлы | Документы | + ]│
│    │ [Поиск чатов…        ]   │                                🔍 · 📄 ☑ 📅 👤 (⌃1–4) · 📞 · ⋯ · ✦     │
│    │ ФИЛЬТР ▾                 ├─────────────────────────────────────────────────────────────────────────┤
│    │  Чаты · Непрочит. 4 ·    │  ── Сегодня ──                                                          │
│    │  Упоминания 2 ● · …      │  Анна 10:02  Посмотри [📄 Q4 план]  ┌ 📄 Q4 план · ред. 5 мин ┐         │
│    │ ★ ЗАКРЕПЛЁННОЕ           │                                     │ [Открыть] [Комментарии] │         │
│    │  # продукт           3   │                                     └─────────────────────────┘         │
│    │ ЧАТЫ                     │  Вы 10:05  Ок, сделаю задачу ✓✓ (прочитано, §18.8)                     │
│    │  🟢 Анна Петрова     ●2  │      ↳ 2 ответа в треде                                                 │
│    │  👥 Синк по Rox          │                                                                         │
│    │ КОМАНДЫ ▾                │ ┌──────────────────────────────────────────────────────────────────┐   │
│    │  🏠 Общий            12  │ │ Сообщение для Анна…                     Aa ☺ @ 📎 ⊕ ➤             │   │
│    │  # анонсы                │ └──────────────────────────────────────────────────────────────────┘   │
│    │  🔒 руководство          │                                                                         │
└────┴──────────────────────────┴─────────────────────────────────────────────────────────────────────────┘
```
- **Features:**
  - DMs, group chats and channels, public and private, with General by default (D-v2-2, §23.4);
  - threads; reactions; pins; labels; flags; Done;
  - entity cards (§7.6) and chat tabs per entity;
  - quick panels (Docs, Tasks, Calendar, Contacts) on ⌃1–4;
  - receipts (§18.8); `/` commands (PRD §7.3);
  - message → task / event / doc (X-07…X-09);
  - remind me (X-16); drag a message onto Tasks (X-13); multi-select bulk actions (X-19).
- **Layout:**
  - sidebar 280: search, collapsible filter, then the chat list; row 60;
  - conversation max-width none, message column max 880;
  - composer min 48, max 40% of the height;
  - threads open in the inspector (328).
- **States:**
  - no chats: «Начните общение» + [Новое сообщение] [Пригласить людей];
  - offline: a banner, with sends queued (clock icon on the bubble);
  - placeholder member (§23.2): greyed avatar «приглашён»;
  - private chat that I am not in: not listed at all (§23.4);
  - muted: grey counters.
- **Behaviour:**
  - ⌥↑ / ⌥↓ moves between chats;
  - Esc closes the thread, then the panel;
  - unread divider «Новые сообщения»;
  - jump-to-bottom chip with the count.

### 27.4 Docs home and doc page
```
┌────┬──────────────────────────┬─────────────────────────────────────────────────────────────────────────┐
│    │ Документы      🔍 [+▾]   │ ‹ › Wiki Продукт › Q4 план  [Продукт] Сохранено  (АП ОИ +2) 💬3 ✎ Share ⋯ ✦│
│    │ Главная                  ├─────────────────────────────────────────────────────────────────────────┤
│    │ ★ ЗАКРЕПЛЁННОЕ           │  Оглавление │  # Q4 план                                    │           │
│    │  Q4 план                 │  • Цели     │  Владелец: Анна · обновлено 5 мин            │           │
│    │ Недавние                 │  • Сроки    │  ## Цели                                      │  (comments│
│    │ Общие со мной        ●   │  • Риски    │  - [ ] Подготовить смету @Анна пт  ☑ (X-01)   │   panel   │
│    │ WIKI ▸                   │             │  [📅 Ревью бюджета · пт 15:00] (X-04)         │   §18.6   │
│    │ ДИСК ▸                   │             │  ┌ ☑ Задачи списка «Q4» (X-06) ────────┐      │   hidden) │
│    │ БАЗЫ ▸  ФОРМЫ ▸          │             │  │ ☐ Смета · Анна · пт                 │      │           │
│    │ ПАПКИ ▸                  │             │  └─────────────────────────────────────┘      │           │
│    │ ЛИЧНЫЕ ЗАМЕТКИ ▸         │             │  Упоминается в: 💬 2 · ☑ 3 · ◎ 1              │           │
│    │ Корзина                  │             │                                                │           │
└────┴──────────────────────────┴─────────────────────────────────────────────────────────────────────────┘
```
- **Features:**
  - Docs home (recent, shared with me, favourites, templates row);
  - the doc page: TipTap editor (one editor), TOC rail inside MAIN (200), comments / suggestions / activity / «Viewed by» panels (§18.6);
  - co-editing with presence and follow mode (§18.1–§18.2);
  - inline task, event and meeting blocks and task-list embeds (§19);
  - Referenced in; version history; export to Markdown; make shared (#1112).
- **Layout:**
  - the doc body is 768 wide, centred; «Широкий режим» uses 1152;
  - the TOC hides under 1280;
  - the selection bubble offers: B I U S · link · 💬 comment · ☑ task (X-02) · ✦ ask @rox.
- **States:**
  - empty doc: template picker «Начните с шаблона»;
  - read-only: a banner «Только просмотр · Запросить доступ»;
  - suggestion mode: a green top border and the label «Режим предложений»;
  - offline: «Изменения сохранятся при подключении» (Yjs);
  - conflict (local note): the diff dialog (§18.7);
  - restricted: lock page.
- **Behaviour:**
  - ⌘F finds in the doc (moved from ⌘J, §25.2);
  - ⌘⌥M comments;
  - ⌘⇧T makes a task from the selection;
  - ⌘⇧J asks @rox about the selection.

### 27.5 Wiki
```
┌────┬──────────────────────────┬─────────────────────────────────────────────────────────────────────────┐
│    │ ‹ Документы              │ ‹ › Продукт › Процессы › Онбординг             (АП +1) 💬 Share ⋯ ✦    │
│    │ Wiki           🔍 [+▾]   ├─────────────────────────────────────────────────────────────────────────┤
│    │ [Продукт ▾]              │   # Онбординг                                                           │
│    │ ▾ Процессы               │   (same doc page as §27.4)                                              │
│    │    • Онбординг           │                                                                         │
│    │    • Релизы              │                                                                         │
│    │ ▸ Архитектура            │                                                                         │
│    │ Участники · Настройки    │                                                                         │
└────┴──────────────────────────┴─────────────────────────────────────────────────────────────────────────┘
```
- **Features:** wiki spaces with a page tree (drag to nest or reorder), page permissions inherited from the space, a space home page, and «Подписаться на раздел».
- **States:**
  - no wiki spaces: «Создайте первое пространство Wiki» [Создать];
  - a tree with more than 500 pages: lazy loading with a «Показать ещё» row.
- **Behaviour:**
  - the sidebar keeps the tree expansion per space;
  - the ‹ Документы row returns to the Docs sidebar with a 120 ms horizontal slide (the same pattern applies to Drive, Base and Forms).

### 27.6 Drive (summary; full spec §20)
```
┌────┬──────────────────────────┬─────────────────────────────────────────────────────────────────────────┐
│    │ ‹ Документы              │ ‹ › Диск › Мой диск › Проекты       [ Список | Сетка ]  ⚲ ⛃ 🔍 Share ⋯ ✦│
│    │ Диск           🔍 [+▾]   ├─────────────────────────────────────────────────────────────────────────┤
│    │ Главная диска            │  Имя                     Владелец   Изменён      Размер                 │
│    │ ▾ Мой диск               │  📁 Дизайн               Вы         вчера        —                      │
│    │    📁 Проекты            │  📄 Смета.pdf            Анна       10:02        2,4 МБ                 │
│    │ Доступные мне        ●   │  🎞 Демо.mp4             Вы         пн           1,2 ГБ                 │
│    │ Недавние · Помеченные    │                                                                         │
│    │ Корзина                  │  (drop zone: «Перетащите файлы сюда» on drag-over)                      │
│    │ ── Артефакты агентов     │                                                                         │
│    │    Файлы из чатов …      │                                                                         │
│    │ ▓▓▓▓░░░ 312 ГБ из 1 ТБ   │                                                                         │
└────┴──────────────────────────┴─────────────────────────────────────────────────────────────────────────┘
```
- **v2.1 additions:**
  - file rows are draggable into chats, docs and tasks (X-13);
  - «Прикрепить к задаче…» in the context menu;
  - Space opens Quick Look;
  - «Спросить @rox» on a file sends it as a context chip (the agent reads the text preview only).

### 27.7 Base
```
┌────┬──────────────────────────┬─────────────────────────────────────────────────────────────────────────┐
│    │ ‹ Документы              │ ‹ › CRM › Сделки  [ Таблица | Канбан | Галерея | Гантт | + ]            │
│    │ Базы           🔍 [+▾]   │                         ⚲ Фильтр ⛃ Сорт/Группа 🔍 (ОИ) Share Автом. ⋯ ✦ │
│    │ ★ ЗАКРЕПЛЁННОЕ           ├─────────────────────────────────────────────────────────────────────────┤
│    │ Мои базы                 │  ☐ │ Название      │ Стадия ▾   │ Сумма   │ Ответственный │ + │          │
│    │ ▾ CRM                    │  ☐ │ ООО Альфа     │ Переговоры │ 1,2 млн │ Анна          │   │          │
│    │    Таблицы: Сделки …     │  ☐ │ ИП Бета       │ Новая      │ 300 тыс │ Олег          │   │          │
│    │    Виды: Воронка …       │  + Добавить запись                                                     │
│    │ Общие                    │  Σ 3 записи · Сумма 1,5 млн                                             │
└────┴──────────────────────────┴─────────────────────────────────────────────────────────────────────────┘
```
- **Features:**
  - Part B §6 grid and views;
  - Rox data sources (Tasks / Goals / Projects / Docs / Meetings adapters) with a source banner;
  - a row opens in the inspector (560) as a record card with comments and Referenced in;
  - the selection bar on multi-select: «Сделать задачи» (X-19), «Поделиться в чат», «Удалить».
- **States:**
  - empty table: «Добавьте первую запись» + import CSV;
  - an adapter table is read-only for computed fields (lock icon on the column header);
  - more than 10k rows: virtualised, with the footer «Показано 200 из 12 431».
- **Behaviour:**
  - keyboard grid navigation (arrows, ↵ edit, Esc cancel, ⌘C / ⌘V ranges);
  - column drag to reorder;
  - frozen first column.

### 27.8 Forms
```
┌────┬──────────────────────────┬─────────────────────────────────────────────────────────────────────────┐
│    │ ‹ Документы              │ ‹ › Формы › Заявка на отпуск   [ Вопросы | Ответы 12 | Настройки ]      │
│    │ Формы          🔍 [+▾]   │                                    (ОИ) Предпросмотр [Опубликовать] ⋯ ✦ │
│    │ Мои формы                ├─────────────────────────────────────────────────────────────────────────┤
│    │ Общие · Черновики        │   ┌ Заявка на отпуск ─────────────────────────────┐   ┌ Тип вопроса ┐   │
│    │ Закрытые                 │   │ 1. ФИО *            [ Короткий ответ ]        │   │ ○ Текст     │   │
│    │                          │   │ 2. Даты *           [ Диапазон дат ]          │   │ ○ Выбор     │   │
│    │                          │   │ + Добавить вопрос                              │   │ ○ Дата      │   │
│    │                          │   └───────────────────────────────────────────────┘   └─────────────┘   │
└────┴──────────────────────────┴─────────────────────────────────────────────────────────────────────────┘
```
- **Features:**
  - Part B §7 builder;
  - responses as a Base table;
  - **v2.1 «При отправке» settings (X-23):** create a task in a list (assignee, due offset), add a Base row, post to a chat. Each option dispatches a normal command as the form owner, with the `derived-from` link to the response.
- **States:**
  - draft (grey «Черновик» chip);
  - published (green «Принимает ответы»);
  - closed («Приём закрыт»);
  - a response with failed side effects is listed in Ответы with ⚠ and [Повторить].

### 27.9 Tasks
```
┌────┬──────────────────────┬────────────────────────────────────────────────────────────┬─────────────────┐
│    │ Задачи     🔍 [+▾]   │ ‹ › Q4 релиз (общий) [Список|Доска|Гантт|Календарь] ⚲ ⛃ 🔍 (АП) Share ⋯ ✦ │
│    │ Входящие          4  ├────────────────────────────────────────────────────────────┤ TaskDetail 560  │
│    │ Сегодня          3 ● │  ▾ Подготовка                                         + │ ☐ Подготовить   │
│    │ Предстоящие          │   ☐ Подготовить смету     Анна   пт   ● Высокий   💬2  │   смету         │
│    │ В любое время        │   ☐ Согласовать бюджет    Олег   пн                    │ Исполнитель Анна│
│    │ Когда-нибудь · Журнал│  ▾ Запуск                                             + │ Срок пт · 📅 блок│
│    │ ── Мои задачи        │   ☐ Анонс                 —      —                     │ Цель: Рост ◎    │
│    │ Назначенные мной     │  + Добавить задачу                                       │ Подзадачи · …   │
│    │ ★ ЗАКРЕПЛЁННОЕ       │                                                          │ Комментарии     │
│    │ СПИСКИ ЗАДАЧ ▸       │                                                          │ Упоминается в   │
│    │ ДОСКИ ПРОЕКТОВ ▸     │                                                          │                 │
└────┴──────────────────────┴────────────────────────────────────────────────────────────┴─────────────────┘
```
- **Features:**
  - the Things views (kept) and Lark lists with sections, custom fields, dependencies, followers;
  - Operately boards, statuses and milestones;
  - the Gantt view (ADR-U10);
  - **time-blocking** (X-14): drag a task onto the Calendar layer, or use «Запланировать время» in TaskDetail;
  - «Связать с целью» (X-18); remind me (X-16); bulk actions (X-19);
  - share a list (§18.9) with presence.
- **Layout:** sidebar 224; MAIN list; the TaskDetail inspector at 560. On a narrow window the detail opens as a full-height overlay.
- **States:**
  - empty Today: «На сегодня всё» illustration;
  - a shared list while offline: rows edited offline show ◷ until synced;
  - a task assigned to a placeholder: a greyed avatar «приглашён».
- **Behaviour:**
  - ⌘N quick entry;
  - Space opens or closes the detail;
  - ⌥↑ / ⌥↓ moves a task;
  - ⌘⇧T is not used here (it is for Docs / Messenger).

### 27.10 Calendar
```
┌────┬──────────────────────┬─────────────────────────────────────────────────────────────────────────────┐
│    │ Календарь  🔍 [+▾]   │ Календарь · 6–12 окт. 2026   [ ‹ Сегодня › ] [ День | Неделя | Месяц ] 🔍 ⋯ ✦│
│    │   Октябрь 2026       ├─────────────────────────────────────────────────────────────────────────────┤
│    │ Пн Вт Ср Чт Пт Сб Вс │       Пн 6     Вт 7     Ср 8      Чт 9     Пт 10                            │
│    │  …  7  [8]  9 …      │ 09:00          ┌──────┐                                                     │
│    │ МОИ КАЛЕНДАРИ        │ 10:00 ┌Синк┐   │Фокус │ ← time block (X-14, striped, task chip)             │
│    │  ■ Работа  ■ Личное  │ 11:00 └────┘   │☑Смета│                                                     │
│    │ ПОДПИСКИ             │ 12:00          └──────┘    ◆ Веха «Бета» (layer)                            │
│    │ СЛОИ                 │ ── задачи со сроком: ☑ Отчёт · ☑ Анонс (all-day strip, read-only) ──        │
│    │  ☑ Задачи ☑ Вехи     │                                                                             │
│    │  ☑ Чек-ины ☑ Блоки   │                                                                             │
│    │ ПЕРЕГОВОРНЫЕ         │                                                                             │
└────┴──────────────────────┴─────────────────────────────────────────────────────────────────────────────┘
```
- **Features:**
  - Part B §8 grid and dialogs;
  - layers (tasks, milestones, check-ins, **time blocks**);
  - the event detail in the inspector with Join / Open chat / Agenda doc / Referenced in;
  - find-a-time (also as the @rox quick action «Найти время»);
  - shared calendars (§18.10); R1 meeting notes (§19.11).
- **States:**
  - no calendars connected: «Календари не подключены» [Подключить];
  - sync error per account: a red dot in the sidebar footer;
  - an invitation awaiting reply: hatched event with [Принять] [Отклонить] [Под вопросом].
- **Behaviour:**
  - drag to create (popover quick-create);
  - drag to move or resize;
  - dropping a task (from Tasks or the agent panel) creates a time block;
  - T goes to today; D / W / M switch views.

### 27.11 Meetings (landing, in-call)
```
Landing                                                        In-call (shared dock with @rox tab)
┌────┬──────────────────────┬──────────────────────────────┐  ┌──────────────────────────────────────┬──────────────┐
│    │ Встречи    🔍 [+▾]   │ Встречи [Предст.|История|Зап.]│  │ Синк по Rox ● REC 12:31 [Галерея|Докл.]│[✦][👥][💬][📝]│
│    │ СЕЙЧАС           ●   │      🔍 [Начать встречу] ⋯ ✦ │  │ ┌──────┐ ┌──────┐ ┌──────┐           │ Участники 4  │
│    │  Синк по Rox (идёт)  ├──────────────────────────────┤  │ │ Анна │ │ Олег │ │ Вы   │           │ Анна 🎙       │
│    │ ПРЕДСТОЯЩИЕ          │ [▶ Начать] [🔗 Войти] [● Зап.]│  │ └──────┘ └──────┘ └──────┘           │ Олег 🔇       │
│    │  15:00 Ревью бюджета │ Предстоящие: 15:00 Ревью …   │  │ 🎙 📷 🖥 ✋ ☺  ··· [Выйти]             │              │
│    │ ИСТОРИЯ · ЗАПИСИ     │ История: вчера · Ретро …     │  └──────────────────────────────────────┴──────────────┘
│    │ ИТОГИ                │                              │
└────┴──────────────────────┴──────────────────────────────┘
```
- **Features:**
  - start, join or schedule a meeting, or record locally (existing);
  - LiveKit in-call with Participants · Chat · Minutes · Notes as inspector tabs;
  - **meeting outcomes** (X-15): after the call the «Итоги» card lists decisions, action items (→ tasks with assignees), a summary (→ the meeting chat and the notes doc), with [Опубликовать] [Изменить].
- **States:**
  - waiting room;
  - reconnecting (a yellow bar);
  - recording consent prompt (required before Minutes);
  - ended: the outcomes review;
  - no LiveKit configured: the landing hides «Начать» and shows «Видеовстречи не настроены».

### 27.12 Goals & OKR (Work Map, goal page)
```
┌────┬──────────────────────┬─────────────────────────────────────────────────────────────────────────────┐
│    │ Цели и проекты 🔍[+▾]│ Карта работ  [ Дерево | Таблица | Гантт ] (Все|Мои|Команда)  ⚲ ⛃ 🔍 ⋯ ✦    │
│    │ Карта работ          ├─────────────────────────────────────────────────────────────────────────────┤
│    │ Моя работа           │  Название                       Статус        Прогресс  Срок     Ответств.  │
│    │ ★ ЗАКРЕПЛЁННОЕ       │  ▾ ◎ Рост выручки               ● По плану    ◔ 62%     Q4 2026  Анна       │
│    │ ЦЕЛИ ▸  ПРОЕКТЫ ▸    │     ▾ ▣ Запуск Rox 2.0          ● Внимание    ◔ 40%     дек.     Олег       │
│    │ Мои OKR              │        ◆ Бета                   ✓ Завершено             окт.               │
│    │ Согласование         │     ▸ ◎ Удержание               ● Отстаёт     ◔ 20%     Q4 2026  Вы         │
│    │ Ревью            2 ● │                                                                             │
│    │ KPI · Пространства ▸ │                                                                             │
└────┴──────────────────────┴─────────────────────────────────────────────────────────────────────────────┘
```
- **Goal page:**
  - Operately layout: header (title, StatusBadge, champion / reviewer PersonFields, timeframe);
  - tabs (§26.3) with count chips;
  - targets with PieProgress; the latest check-in card; the sub-goal / project tree; discussions; Referenced in.
- **v2.1:**
  - «Связать работу» (X-18) adds tasks, docs or messages as `aligned-to` / `member-of` links;
  - the progress roll-up shows linked task completion as a secondary bar;
  - «Черновик чек-ина» (X-17) prefills from activity.
- **States:**
  - no goals: «Создайте первую цель» + templates;
  - outdated check-in: the «Устарело» badge and a banner «Чек-ин просрочен на 5 дней» [Чек-ин];
  - a secret goal: not shown to non-members (no placeholder row);
  - closed: read-only with a retrospective card.

### 27.13 Projects (project page, boards)
```
┌────┬──────────────────────┬─────────────────────────────────────────────────────────────────────────────┐
│    │ Цели и проекты 🔍[+▾]│ ‹ › Продукт › Запуск Rox 2.0 ● Внимание [Обзор|Задачи 24|Вехи|Чек-ины|…]   │
│    │ …                    │                                                  (АП ОИ) [Чек-ин] Share ⋯ ✦ │
│    │ ПРОЕКТЫ ▾            ├─────────────────────────────────────────────────────────────────────────────┤
│    │  ▣ Запуск Rox 2.0    │  ┌ Последний чек-ин · Олег · пн ─────┐  ┌ Вехи ──────────────────────────┐ │
│    │  ▣ Сайт              │  │ ● Внимание · «Задержка API…»      │  │ ✓ Альфа  ◆ Бета 10 окт  ◇ GA   │ │
│    │                      │  │ [Подтвердить] 💬 3                │  └────────────────────────────────┘ │
│    │                      │  └───────────────────────────────────┘  Участники: Олег (чемпион) · Анна  │
│    │                      │  Ресурсы: 📄 Спека · 📁 Дизайн · 💬 #rox-2                               │
└────┴──────────────────────┴─────────────────────────────────────────────────────────────────────────────┘
```
- **Features:**
  - the Operately project page;
  - the «Задачи» tab is the project board (TSK-2) with statuses;
  - milestones on the Gantt;
  - the «Рабочая область» tab keeps the existing roadmap, timeline, requirements and AI panel;
  - the project chat as a tab.
- **States:**
  - paused (a grey banner [Возобновить]);
  - closed (a retrospective);
  - a local-only project shows «Только на этом устройстве» with [Сделать общим].

### 27.14 Spaces
```
┌────┬──────────────────────┬─────────────────────────────────────────────────────────────────────────────┐
│    │ Цели и проекты 🔍[+▾]│ ‹ › Пространства › Продукт  [Обзор|Цели|Проекты|Обсуждения|Документы|Участ.]│
│    │ ПРОСТРАНСТВА ▾       │                                            (АП +5) [Вступить] Share ⋯ ✦      │
│    │  ● Продукт           ├─────────────────────────────────────────────────────────────────────────────┤
│    │  ● Продажи           │  Описание · Чат пространства [Открыть] · Папка [Открыть] · KPI (3)          │
└────┴──────────────────────┴─────────────────────────────────────────────────────────────────────────────┘
```
- **Features:**
  - the overview with description, chat, Docs folder and KPI widgets;
  - members with roles;
  - join or leave (public spaces);
  - auto-provisioned chat and folder (ADR-U07).
- **States:**
  - not a member of a public space: a read-only view with [Вступить];
  - private: hidden.

### 27.15 Contacts
```
┌────┬──────────────────────┬─────────────────────────────────────────────────────────────────────────────┐
│    │ Контакты   🔍 [+▾]   │ ‹ › Анна Петрова  [Задачи|Назначено|На ревью|Активность|О себе]             │
│    │ ООО Рокс · Управлять │                                    [Написать] [Позвонить] [Встреча] ⋯ ✦     │
│    │ Сотрудники           ├─────────────────────────────────────────────────────────────────────────────┤
│    │ Оргструктура         │  (Avatar 64) Анна Петрова · Продакт · Продукт · 14:05 местное · 🟢          │
│    │ Внешние контакты     │  ┌ Общее с вами (X-20) ─────────────────────────────────────────┐          │
│    │ Новые контакты   1 ● │  │ 💬 3 общих чата · 📄 12 документов · ☑ 5 задач · ◎ 2 цели     │          │
│    │ Избранные            │  │ 📅 Следующая встреча: пт 15:00 «Ревью бюджета» · Свободна сейчас │       │
│    │ Мои группы · Досье   │  └──────────────────────────────────────────────────────────────┘          │
└────┴──────────────────────┴─────────────────────────────────────────────────────────────────────────────┘
```
- **Features:**
  - directory table; org chart; external contacts; Dossier;
  - **Person 360** (X-20): shared chats, docs, tasks, goals, next meeting and free / busy;
  - actions Написать / Позвонить / Встреча / Назначить задачу.
- **States:**
  - placeholder (invited): «Ещё не активирован · приглашён 2 дн. назад» [Напомнить];
  - guest: a guest tag with limited fields;
  - a bot: a BOT tag and no Call button.

### 27.16 Inbox: Review, Notifications, Mail
```
┌────┬──────────────────────┬─────────────────────────────────────────────────────────────────────────────┐
│    │ Входящие   🔍 [+▾]   │ Входящие › Ревью   [ Мне | Назначенное мной ]               ⚲ 🔍 ⋯ ✦        │
│    │ Все                  ├─────────────────────────────────────────────────────────────────────────────┤
│    │ Ревью            5 ● │  НУЖНО ВАШЕ ПОДТВЕРЖДЕНИЕ (2)                                               │
│    │ Упоминания       2 ● │   ✦ @rox: создать событие «Синк» пт 15:00 · из 💬 #продукт [Подтвердить][✕]│
│    │ Решения · Сообщения  │  СКОРО СРОК / ПРОСРОЧЕНО (2)                                                │
│    │ Уведомления          │   ◎ Чек-ин «Рост» · до пт                                   [Чек-ин]        │
│    │ ПОЧТА ▸              │  ЖДЁТ ВАШЕГО РЕВЬЮ (1)                                                      │
│    │ Отложенные · Готово  │   ▣ Чек-ин «Rox 2.0» от Олега                               [Подтвердить]   │
└────┴──────────────────────┴─────────────────────────────────────────────────────────────────────────────┘
```
- **Features:**
  - Review groups (§12, §22.3); notifications day-grouped; mentions;
  - Mail in the Lark layout with **email → task / event / doc / chat** (X-22);
  - snooze and remind (X-16); batch actions on selection (X-19).
- **States:**
  - «Всё просмотрено» (all caught up);
  - mail not connected: [Подключить почту];
  - outbound disabled (local pilot): the Send button is disabled with ⓘ.

### 27.17 Feed
- The **layout** is unchanged (existing tabs move into the sidebar as rows; §26.2).
- **v2.1:**
  - an item's context menu gains «Спросить @rox», «Напомнить…» and «В задачи / В заметку» (existing);
  - drag an item onto Tasks or Docs (X-13).
- **States:** no sources: «Добавьте источник» [+ RSS] [+ Страница].

### 27.18 Agent center and Settings → Agent
```
┌────┬──────────────────────┬─────────────────────────────────────────────────────────────────────────────┐
│    │ Агенты     🔍 [+▾]   │ Агенты › Ждут меня   [ Активные | История ]   ⚲  [Приостановить всех] ⋯ ✦  │
│    │ Ждут меня        2 ● ├─────────────────────────────────────────────────────────────────────────────┤
│    │ Выполняются      3   │  ✦ @rox · «Создать 4 задачи из Q4 план» · ждёт 5 мин   [Подтвердить] [✕]   │
│    │ Застряли         1 ● │  ◌ Сессия «Рефакторинг» · шаг 4/9 · 12 мин             [Открыть] [■]       │
│    │ Облачные · Автомат.  │  ⚠ Автоматизация R1 · ошибка шага 2                     [Повторить]         │
│    │ Бюджет               │                                                                             │
│    │ Мой агент @rox       │                                                                             │
│    │ Журнал действий      │                                                                             │
└────┴──────────────────────┴─────────────────────────────────────────────────────────────────────────────┘
```
- **Features:**
  - the existing Agent center (waiting, running, stuck, cloud, automations, budget) plus the @rox approvals and audit (§22.4–§22.6);
  - every row links to its session or the agent-panel topic.
- **States:** none running: «Агенты ничего не выполняют»; agent paused: an amber banner [Возобновить].

### 27.19 Settings
- **Layout:** the existing settings shell (sidebar groups + page).
- **v2.1 adds** «Панели и боковые панели» (§26.4) and links from the agent panel ▾ menu.
- Every policy or metric row has the ⓘ help popover (§2.6).
- Settings search (top-right 🔍) filters rows across pages and highlights the match.

### 27.20 Advanced search (⌘⇧F)
```
┌────┬──────────────────────┬─────────────────────────────────────────────────────────────────────────────┐
│    │ Поиск                │ Поиск   [ бюджет q4                                        ✕ ]  ⛃ Сохранить ✦ │
│    │ ТИПЫ                 ├─────────────────────────────────────────────────────────────────────────────┤
│    │  ☑ Документы     12  │  ДОКУМЕНТЫ (12)                                                             │
│    │  ☑ Сообщения     40  │   📄 Q4 план · …«**бюджет** на Q4 согласовать…» · Продукт · 5 мин           │
│    │  ☑ Задачи         5  │  СООБЩЕНИЯ (40)                                                             │
│    │ ГДЕ · КТО · КОГДА    │   💬 #продукт · Анна: «по **бюджету** …» · вчера                            │
│    │ СОХРАНЁННЫЕ          │                                                                             │
└────┴──────────────────────┴─────────────────────────────────────────────────────────────────────────────┘
```
- **Features:**
  - all kinds; facets in the sidebar; saved searches;
  - results stream in per provider (local first, then server);
  - multi-select results → bulk actions (X-19);
  - «Спросить @rox» on the query («Сводка по результатам»).
- **States:**
  - no results: suggestions and «Искать везде» (removes facets);
  - server unavailable: local results only, with the banner «Только локальные результаты».

## 28. Cross-functional capabilities X-13…X-26 (PRD §7.17, M26; TECH-SPEC §20)
v2 already has X-01…X-12 (PRD §7.11, §19). v2.1 adds 14 capabilities that cut across surfaces. All of them are gated by `xfn.capabilities.v1`; each one also needs the owner module's flag. They reuse the existing kinds, relations and commands, so there are no new tables (DATA-MODEL §5.18).

| ID | Capability | Where it appears | UX (state · composition · motion · transitions) |
|---|---|---|---|
| X-13 | **Drag and drop between surfaces** | any EntityChip, list row, file, message, event, or agent-panel chip → sidebar rows, task lists, calendar grid, doc body, chat composer, goal page | Drag ghost = chip + kind icon; valid targets get a 2 px accent outline and a hint label («Прикрепить к задаче», «Запланировать», «Встроить», «Отправить в чат»); invalid targets show ⊘. Drop runs one command and shows the toast «Готово · Отменить» (10 s). Esc cancels. Settle animation uses `--ease-spring`. |
| X-14 | **Time-blocking tasks on the calendar** | Tasks (TaskDetail «Запланировать время», drag to Calendar), Calendar (drop a task), agent «Распланировать день» | Creates a «Фокус» event (striped, with a task chip) linked `task → calendar-event (in-calendar)`. Completing the task marks the block «✓ сделано»; moving the block updates the task's planned date (not its due date). Free / busy shows as busy. |
| X-15 | **Meeting outcomes → tasks, decisions, doc, chat** | Meetings after the call; meeting chat; notes doc | The «Итоги встречи» review card: Решения (→ `decision` records), Задачи (assignee and due, editable), Кратко. [Опубликовать] creates the tasks, appends to the notes doc and posts a summary card to the meeting chat. Each item links `derived-from` the call. |
| X-16 | **Remind me / snooze on any entity** | context menu «Напомнить…» everywhere; ⌘⇧H on a focused row | Popover presets (Через 1 час · Сегодня вечером · Завтра утром · Пн · Выбрать дату). At the time, the item reappears at the top of Inbox (Snoozed → All) and as an OS notification. The row shows a ⏰ chip until then. |
| X-17 | **Check-in draft from activity** | goal / project page «Чек-ин» → «Заполнить из активности»; @rox quick action | The draft shows sections Что сделано (closed tasks, merged docs), Что мешает (blocked or overdue tasks, off-track children), Дальше (upcoming milestones). Each line has a source chip. The status suggestion carries an ⓘ explaining the rule. The user edits and submits. |
| X-18 | **Link work to a goal / project from anywhere** | context menu «Связать с целью…» on tasks, docs, messages, files, events; TaskDetail field «Цель» | The EntityPicker is filtered to goals and projects. The link is `aligned-to` (task / doc → goal) or `member-of` (task → project). The goal page shows linked work in «Связанное» and as a secondary progress bar (linked tasks done / total). |
| X-19 | **Multi-select bulk actions + "Actions on selection" in ⌘K** | every list surface (messages, tasks, files, Base rows, Inbox, search results, Work Map) | Shift / ⌘-click selection shows a floating selection bar at the bottom of MAIN: count · Назначить · Срок · Переместить · Связать · Поделиться в чат · Спросить @rox · ⋯. ⌘K with a selection shows «Действия с выбранным (5)» first. Bulk commands run as one batch with one undo. |
| X-20 | **Person 360** | Contacts profile, person hover card («Общее с вами»), DM header ⓘ | A card with shared chats, docs, tasks (assigned both ways), goals, the next meeting and free / busy now. Rows are EntityChips. Data comes from links plus the ACL; nothing private leaks. |
| X-21 | **Today agenda across surfaces** | Home «Сегодня», Home sidebar section, Focus screen, agent «План на день», optional inspector panel `agenda.today` | One ordered list: events (time), time blocks, tasks due today or overdue, check-ins due, approvals waiting, meetings to prepare (R1 notes). Each row has its primary action (Войти · ☐ · Чек-ин · Подтвердить). Live updates via realtime. |
| X-22 | **Email → task / event / doc / chat** | the Mail reading pane and the list context menu | «Создать задачу» (the subject becomes the title, the body excerpt the notes, link `derived-from`), «Создать событие» (parses date and time and suggests attendees from the To / Cc that are known people), «Сохранить в документ», «Поделиться в чат» (an email card with sender, subject and excerpt; attachments go to Drive). |
| X-23 | **Form submission → task / Base row / chat post** | Forms → Настройки → «При отправке» | Toggle rows with targets: task list + assignee + due offset; Base table + field mapping; chat + message template. They run as the form owner via commands; failures are listed per response (⚠ [Повторить]). |
| X-24 | **Presence huddle** | the presence facepile on any shared doc, task list, Base or goal page | Facepile ⋯ → «Созвониться с теми, кто здесь» starts a meeting with the present collaborators (each gets a join toast), linked `derived-from` the entity, and the call's Notes tab opens on that entity. |
| X-25 | **Ask @rox about this** | every row, chip, card, file and selection; agent panel | Opens the agent panel (§25) with the entity as the focus chip and the surface's quick actions. The same capability backs `/explain`, `/summarize` and `/tasks` in the panel. |
| X-26 | **Pins across surfaces** | the «Закреплённое» sidebar section on every surface (§26.1), Home, the Omnibox «Закреплённое» group | «Закрепить» on any entity pins it for me. The surface sidebar shows the pins of its kinds; Home shows all. Drag reorders. A pinned item that is deleted or restricted shows a struck-through or lock chip with [Открепить]. |

---

# Part B: Lark UI detail (Phase-2 UI-SPEC §1–§13, verbatim)

> **Precedence:** Part A overrides this part. In particular:
> - Part A §2 (tokens) replaces the Lark palette and the 148px rail.
> - Part A §3.4 (Omnibox) replaces the Lark global search modal (B.3.3).
> - Part A §5–§13 deltas apply to every screen below.
> - Screenshot refs `[S: msg/10]` map to `screenshots/lark/msg/10-*.jpg` in the zip.
> - The original document header (version line, repo hash `60c91d6`) is omitted; this content was surveyed at Phase 2.
> - References in this part to `TECH-SPEC`, `PLAN`, `PRD` or `APPENDIX` (and their § numbers) mean the **Phase-2** documents, included in the zip under `reference/lark-final/`. They are not the unified TECH-SPEC / PLAN / PRD.

### B.1. Measurement method

| Screenshot set | Capture size | Notes |
|---|---|---|
| `msg/`, `docs/`, `cmt/` | 1024×594 PNG | 0.8× downscale of a 1280×742 viewport. The page was also rendered at about 70% browser zoom (cap-height of 14px labels = 5–6px). |
| `wiki/` | 1280×800 WebP | Full-size, but also at about 70% zoom. The Wiki sidebar measures 200px here and 160px in `docs/01`: same element, ratio 0.8. |
| `user/` | desktop app, native | Used for layout and labels only. |

**Conversion:** design px ≈ screenshot px ÷ **0.57** for the 1024-wide sets, and ≈ screenshot px ÷ **0.70** for `wiki/`. Expect about ±8% error.

Three anchors confirm the factor:
- message avatar 18–19px → 32;
- side-panel width 186px → 326 (inside the shell spec's INSPECTOR range of 320–420);
- Docs sidebar 160px (`docs/01`) and 200px (`wiki/`) → about 285 in both sets.

The **"Adopted"** column in §2 is the value Rox should build at 100% zoom. It is the measured value rounded to a 4px grid. Where the walkthrough team's eyeball estimates (rail ~72, list ~320, row ~64, avatar 32) differ, the measured value wins, except for the chat-list default. The chat list is user-resizable, and 320 sits inside the measured range.

---

### B.2. Design-system tokens

#### B.2.1 Layout

| Token | Raw (screenshot px) | Design px | **Adopted (Rox)** | Evidence |
|---|---|---|---|---|
| `shell.frame.gap` (dark gap between cards) | 3–4 | 6 | **6** | `msg/10` |
| `rail.width.expanded` (icons + labels) | 83 | 146 | **148** | `msg/01`, `msg/10` |
| `rail.width.collapsed` (icons only, Rox option) | — | — | **64** | [ROX EXT]. The Rox unified-shell RAIL is 48; keep 48 for the non-Lark layout. |
| `rail.item.height` | 19 | 33 | **32** (pill, radius 6) | `msg/10` |
| `messenger.filter.width` | 85 | 149 | **148** (collapsible) | `msg/10` |
| `messenger.list.width` | 154–236 (resizable) | 270–414 | **320** default, min 264, max 420 | `msg/10`, `msg/14` |
| `messenger.list.row.height` | 33 | 58 | **60** | `msg/10` |
| `avatar.feed` | 19–20 | 33–35 | **36** | `msg/10` |
| `avatar.message` / `avatar.header` | 18 / 19 | 32 / 33 | **32** | `msg/10`, `msg/34` |
| `avatar.pinnedStrip` (top of chat list) | 20 | 35 | **36** (+ 10px label) | `msg/03b` |
| `chat.header.height` | 35 | 61 | **56** (tabs row adds 28 → 84 total) | `msg/14`, `msg/35` |
| `sidepanel.width` (Tasks / Search in chat / Settings / quick panels) | 185–186 | 325–326 | **328** | `msg/12`, `msg/14`, `msg/15` |
| `sidepanel.header.height` | 36 | 63 | **56** (same as chat header) | `msg/14` |
| `task.detail.width` | 320 | 561 | **560** | `cmt/28` |
| `tasks.sidebar.width` | 127 | 223 | **224** | `cmt/28` |
| `calendar.sidebar.width` | 136 | 239 | **240** | `cmt/01` |
| `docs.sidebar.width` | 160 (`docs/01`) / 200 (`wiki/`) | 281 / 286 | **280** | `docs/01`, `wiki/03` |
| `doc.body.maxWidth` (standard width) | 438 | 768 | **768** (Wide / Full via Page Width) | `docs/76` |
| `doc.toc.width` | ~95 | ~167 | **168** (collapsible `<<`) | `docs/76` |
| `menu.item.height` | 18 | 32 | **32** | `docs/76`, `msg/08` |
| `menu.width` (doc ··· menu) | 118 | 207 | **208** (min 160, max 280) | `docs/76` |
| `dialog.width` (Add tab) | 320 | 561 | **560** | `msg/13` |
| `dialog.width` (Permission settings) | 267 | 468 | **480** | `docs/72` |
| `search.modal.width` | 555 | 974 | **960** (max 80vw), top offset 48 | `msg/05` |
| `composer.minHeight` | 26 | 46 | **48** (grows to 40% of pane) | `msg/24` |

#### B.2.2 Colour (sampled hex; names follow the Lark UD palette where the sample matches)

| Token | Hex | Where sampled |
|---|---|---|
| `rail.bg` / `shell.frame` | **#465069** | `msg/10` (dark slate frame and rail) |
| `rail.item.active.bg` | **#6B7387** (≈ white 18% over the rail) | `msg/10` |
| `rail.item.text` | #FFFFFF at 90%; icons white | `msg/10` |
| `rail.badge` | **#F54A45** bg, white text, pill | `msg/10` ("164") |
| `filter.bg` | **#F8F9FA** | `msg/10` |
| `filter.item.active.bg` | **#DFEAFA**; text/icon **#2F6AF1** | `msg/10` |
| `list.bg` | **#FCFCFC** | `msg/10` |
| `list.row.selected.bg` | **#E3EDFC** | `msg/10` |
| `list.row.hover.bg` | ≈ #F2F3F5 (`N900 @ 5%`) | `msg/38` (very subtle) |
| `pane.bg` | #FFFFFF | all |
| `sidepanel.bg` | **#F8F9FA** (Tasks panel is a separate card); **#F8F9FA** for Search in chat inside the chat card | `msg/14`, `msg/15` |
| `primary` (buttons, links, active tab) | **#1456F0** (Share button); **#336DF4** (FAB); Lark UD B500 = #3370FF | `docs/76`, `cmt/01` |
| `primary.subtle.bg` (selected nav in Docs) | **#D3DEF6** | `docs/01` |
| `primary.subtle.bg` (selected nav in Tasks) | **#E6F0FF** | `cmt/28` |
| `danger` | **#F54A45** (Disband Group fill; badges) | `msg/21` |
| `danger.outline` (Leave Group) | border/text **#F77B77**, white bg | `msg/21` |
| `text.primary` | **#1F2329** (also the tooltip bg) | `msg/14` |
| `text.secondary` | #646A73 | previews, subtitles |
| `text.tertiary` | #8F959E | timestamps, placeholders |
| `border` / `divider` | #DEE0E3 (1px) | menus, rows |
| `tag.bot` | bg **#FBF3DA**, text **#C7A24A** ("BOT") | `msg/10` |
| `tag.agent` | bg **#E5DAF8**, text **#9E6DF3** ("Agent") | `msg/10` |
| `tag.public` | bg **#CDDAF9**, text **#5D8AF3** ("Public") | `msg/10` |
| `tag.official` | bg **#CDDAF9**, text **#4A7CF3** ("Official") | `msg/37` |
| `tag.external` | bg #CDDAF9-ish, text blue ("External") | `docs/40` |
| `tag.template` | bg lilac, text purple ("Template") | `docs/94` |
| `card.header.info` | **#F0F4FF** → white gradient; title **#2F6AF1** | `msg/10` |
| `card.header.alert` | **#FFF1F1**; title **#D83931** | `msg/10` |
| `bubble.received` | ≈ #F2F3F5 | `msg/34` |
| `divider.new` (unread line + "New") | **#537DDF** | `msg/10` |
| `calendar.nowLine` | ≈ #E5534B (red, label "00:34") | `cmt/01` |
| `calendar.today.column` | **#F5F5F7** | `cmt/01` |
| `tooltip.bg` | **#1F2329**, text white | `msg/14`, `msg/15` |
| `overlay.scrim` | #000 @ ~45% | `msg/05`, `msg/13` |
| `select.option.bg` (Base single option "github") | pink #FBE4E6, text #C53D50 | `docs/40` |

#### B.2.3 Typography
- **Stack:** `-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Segoe UI", Inter, Arial, sans-serif`. In Rox, use the app's existing Inter.

| Role | Size / line height | Weight |
|---|---|---|
| Base UI | 14 / 22 | 400 |
| List row title | 14 / 22 | 500 |
| Preview, time, meta | 12 / 18 | 400 |
| Section titles ("Chats", "Filter", "Tasks", "Settings") | 16 / 24 | 600 |
| Page H1 ("Home", "Weekly Meeting") | 20 and 32 | 600 |
| Doc body | 16 / 26 | 400 |
| Tags | 10–11 / 16 | 500, uppercase only for "BOT" |
| Badges | 10–11 | 500 |

#### B.2.4 Shape, elevation, iconography
- **Radius:**
  - 4: tags, inputs
  - 6: rail pills, buttons, menu items
  - 8: menus, popovers, cards, message cards
  - 12: dialogs, the search modal
  - full: avatars, badges
- **Shadows:**
  - menu/popover: `0 4px 12px rgba(31,35,41,.12), 0 0 0 1px rgba(31,35,41,.06)`
  - dialog: `0 8px 24px rgba(31,35,41,.16)`
  - Side panels have no shadow. They sit in a separate card or behind a 1px divider.
- **Icons:** 16px line icons, stroke 1.5, inside a 28px button with radius 6. Hover fill is `N900 @ 8%`. Header icons are 20px inside a 32px target. Icons use `text.secondary`, and `text.primary` on hover.
- **Badges:**
  - unread count: red pill, white text, min 16×16, overlapping the avatar top-right (`msg/10`);
  - filter counts: plain right-aligned number;
  - muted chats: grey count [UNVERIFIED].

#### B.2.5 Motion
Timings come from frame-diffing the walkthrough. Video was not recorded, so exact durations are **[UNVERIFIED]** and the values below are the recommended Rox defaults.

| Element | Behaviour | Rox default |
|---|---|---|
| Right side panels (Tasks, Settings, Search in chat, quick panels) | Slide in from the right and push the chat pane narrower (they do not overlay) | 200ms `cubic-bezier(.2,0,0,1)`; content fades in 120ms |
| Menus, context menus | Appear almost instantly | 80ms opacity + 4px translate |
| Tooltips | Dark pill, below the icon, after a short delay | 300ms delay, 80ms fade |
| Search modal | Centred, grey scrim | 120ms scale .98→1 + fade |
| Row hover | Instant fill. A ✓ **Done** button appears at the row's right end (`msg/34`, `msg/37`) | 0ms |
| Dialogs | Centred, scrim | 150ms fade/scale |
| Toasts | Top-centre | **[UNVERIFIED]**; 3s auto-dismiss |

#### B.2.6 Z-order
base 0 → sticky headers 10 → side panels 20 → popovers/menus 1000 → tooltips 1100 → dialogs 1200 (scrim 1199) → toasts 1300.

---

### B.3. Global shell

#### B.3.1 Wireframe (Messenger active) `[S: msg/01, msg/10, msg/14]`
```
┌───────────────┬─────────────┬──────────────────────┬──────────────────────────────────────┬──────────────────┐
│ (av)      (+) │ ≡ Filter  ⚙ │ Chats                │ (av) Billing Assistant  Notification…│ Tasks Open Tasks×│
│ 🔍Search(Ctrl+K)│ ◉ Chats 164│ (o)(o)(o) pinned     │  BOT     [🔍][⊞+][✔][⚙]  ← header 56 │ ┌──────────────┐ │
│ ▣ Messenger 164│ ○ Unread 164│ ┌──────────────────┐ │──────────────────────────────────────│ │ + Create task│ │
│ ▣ Meetings    │ ⚑ Flagged   │ │(av) Name BOT 11:31│ │              Jul 9                   │ └──────────────┘ │
│ ▣ Calendar    │ @ Mentions 1│ │     preview…      │ │  (av) ┌ Service now available ┐      │                  │
│ ▣ Docs        │ ▾ Labels    │ └──────────────────┘ │       │ card body …            │      │  [illustration]  │
│ ▣ Contacts    │ 👤 DMs      │  … rows 60px …       │       └────────────────────────┘      │ Tasks sent to    │
│ ▣ Email       │ 👥 Groups   │                      │ ──────────── Aug 9  New ──────────── │ this chat will   │
│ ▣ Tasks       │ 📄 Docs     │                      │                                      │ appear here.     │
│               │ ≡ Threads&To│                      │ ┌ Message Billing Assistant  Aa ☺ @ ⊕ ⤢ │ ➤ ┐│               │
│ [?] ⤓Download │ ✓ Done      │                      │ └──────────────────────────────────────┘ │                  │
└───────────────┴─────────────┴──────────────────────┴──────────────────────────────────────┴──────────────────┘
  RAIL 148        NAVIGATOR 148  COLLECTION 320         MAIN ≥ 640                             INSPECTOR 328
```
Mapping onto the Rox unified shell (`docs/specs/2026-08-07-unified-shell`):
- The rail maps to **RAIL**.
- The filter column maps to **NAVIGATOR**. Lark makes it narrower than the shell's 220–260, so allow 148 for the Messenger surface.
- The chat list maps to **COLLECTION**.
- The conversation maps to **MAIN**.
- Side panels map to **INSPECTOR**.

#### B.3.2 Rail `[S: msg/01, msg/02, msg/03, msg/03b]`
Top to bottom:
1. **Avatar** (opens the avatar menu) and a **⊕** button on the same row, right-aligned.
2. **Search (Ctrl+K)** field-button with a dark fill (rail colour −6%).
3. Nav items, each an icon plus label: **Messenger** (red count badge), **Meetings**, **Calendar**, **Docs**, **Contacts**, **Email**, **Tasks**.
4. Bottom: a help icon tile, then **⤓ Download Lark** (in Rox: **Help** and **What's new**).
- Active item: pill fill #6B7387 with white text.
- Hover: white 10%.
- Opened Workplace apps appear as temporary items (`user/01`–`05`, desktop) [DOCS].

**⊕ menu** `[S: msg/03, msg/03b]`, in order:
- New Chat
- New Group
- New Channel
- New Doc
- New Task
- New Label ›

**Avatar menu** `[S: msg/02]`, in order:
1. name + organisation
2. **+ Status**
3. "Say something about yourself..." (inline signature field)
4. — divider —
5. Profile
6. My QR Code and Profile Link
7. Log into More Accounts
8. — divider —
9. Contact Us
10. Settings
11. Log Out
12. — divider —
13. Admin Console

#### B.3.3 Global search modal (Ctrl+K) `[S: msg/05, msg/06]`
```
┌──────────────────────────────────────────────────────────────── × ┐
│ 🔍 One search, find everything.                                   │
│ [Messages][Docs][Apps][Email][Contacts][Groups][Calendar][Help Desk]│
│ [Minutes][Tasks][Subscriptions][More ▾]                            │
├────────────────────────────────────────────────────────────────────┤
│ Frequently used                                                    │
│ (av) T                       ← hovered row, fill #EBECEF, radius 8 │
│ (av) ROX  (av) Apps  (av) Hermes  …                                │
├────────────────────────────────────────────────────────────────────┤
│ Help and Feedback ▾                ↑↓ to navigate  ↵ to select  esc to quit │
└────────────────────────────────────────────────────────────────────┘
```
- **Chip row:** Messages, Docs, Apps, Email, Contacts, Groups, Calendar, Help Desk, Minutes, Tasks, Subscriptions, More ▾.
  - **More ▾** opens a menu with **Settings**, used to reorder or hide chips (`msg/06`).
  - Chips are pill buttons (#F2F3F5) and turn blue when active.
- **States:**
  - Empty query: the "Frequently used" list.
  - Typing: grouped results per category [UNVERIFIED for the result layout].
  - No results: **[UNVERIFIED]**.
- **Keys:** ↑/↓ moves through results, ↵ opens one, Esc closes the modal, Tab cycles chips [UNVERIFIED].
- **Rox:** wire this modal to the existing `SearchPage` index and the new IM/docs indices (TECH-SPEC §9).

#### B.3.4 Empty main pane `[S: msg/01, msg/09]`
A centred heart-hug emoji illustration (≈96px) with the caption "Set off on a delightful journey with Lark" in 12px `text.secondary`. Rox caption: "Pick a chat to start" (ru: «Выберите чат, чтобы начать»).

---

### B.4. Messenger

#### B.4.1 Filter column (NAVIGATOR) `[S: msg/03b, msg/04, msg/10]`
- **Header:** ≡ **Filter** (16/600) and a ⚙ (filter settings) at the right.
- **Items** (icon 16 + label 14; count right-aligned), in order:
  1. **Chats** (count; cannot be removed)
  2. **Unread** (count)
  3. **Flagged**
  4. **Mentions** (count, bold when >0)
  5. **▾ Labels** (collapsible; **+** on hover)
  6. **DMs**
  7. **Groups**
  8. **Docs**
  9. **Threads & To…** (Threads & Topics)
  10. **Done**
- **Active item:** #DFEAFA fill, radius 6, blue icon and text.
- **Labels, empty** `[S: msg/04]`: "Use labels to sort and manage all your chats" with a **+** affordance.
- The ⚙ opens the filter manager (show/hide, reorder) [DOCS]. Its dialog was not captured: **[UNVERIFIED]**.

#### B.4.2 Chat list (COLLECTION) `[S: msg/03b, msg/07, msg/08, msg/09, msg/10, msg/38]`
- **Header:** "Chats" (16/600).
- **Pinned strip:** horizontal 36px avatars with 10px truncated names, red count badges, and a light-blue tile behind the current one.
- **Row (60px):**
```
(av36)  Name ··· [TAG]                       11:31 PM
 •badge  preview text (12px secondary, 1 line, ellipsis)   [✓]
```
- **Avatar badge:** red count top-right of the avatar (e.g. "164", "2"). The number is the chat's unread count.
- **Tags:** BOT, Agent, Public, Official, External. Colours in §2.2.
- **Preview prefixes:**
  - "⚠️" for system alerts;
  - a green ✓-circle for "sent/read by me" (`msg/10`: rows "a", "hi", "q");
  - "T (agisota): …" in groups.
- **Time format:** today "11:31 PM", earlier "Oct 2", "Sep 14".
- **States:**

| State | Look |
|---|---|
| default | #FCFCFC background |
| hover | ≈#F2F3F5, plus a ✓ (**Done**) icon button at the right end (`msg/34`, `msg/37`) |
| selected | #E3EDFC |
| muted | grey count, bell-slash glyph [UNVERIFIED] |
| draft | "[Draft]" red prefix [UNVERIFIED] |

- **Row context menu (1:1 / bot)** `[S: msg/08]`, in order:
  1. Pin to top
  2. Dismiss Unreads
  3. Flag
  4. New Label
  5. Mute Notifications
  6. Done
  7. — divider —
  8. Open in Navigation Bar
- **Row context menu (pinned group)** `[S: msg/09]`, in order:
  1. Unpin From Top
  2. Mark as Unread
  3. Flag
  4. New Label
  5. Mute Notifications
  6. Done
  7. — divider —
  8. Open in Navigation Bar
- The labels toggle with state: Pin to top ↔ Unpin From Top; Dismiss Unreads (when unread) ↔ Mark as Unread (when read).
- **Done** removes the chat from "Chats" until a new message arrives [DOCS].

#### B.4.3 Chat header variants

| Variant | Left | Right icons (in order) | Evidence |
|---|---|---|---|
| **1:1 bot / app** | avatar 32, **name** 16/600, subtitle 12 secondary, **BOT** tag | 🔍 **Search in chat** · ⊞+ (add-tab glyph; tooltip not captured [UNVERIFIED]) · ✔ **View Tasks** · ⚙ **Settings** | `msg/10`, `msg/11`, `msg/14`, `msg/15` |
| **Agent chat** | avatar, **Rox**, **Agent** tag; **tabs row** below: ◉ Chat · 📁 File · 📄 Docs · + | 🔍 · ⊞+ · ✔ · ⚙ | `msg/34`, `msg/35`, `msg/36` |
| **Group** | avatar, **name**, 👥 member count, **Public** tag; tabs row: Chat · 📢 Announcement · + | 🔍 Search in chat · 🎥 video call (disabled when calls are off) · 👤+ add members · 💼+ (tooltip not captured [UNVERIFIED]) · **···** | `msg/19`, `msg/20`, `msg/27` |
| **Official group** | avatar, **name**, 👥 1 · 🤖 1 (bots), **Official**; tabs row: Chat · Link Web Center↗ · Customer Support↗ · Link WIKI↗ · Link On Air↗ · 📢 Announcement · + | 🔍 · 🎥 · 👤+ · 💼+ · ··· | `msg/37` |

- **Group ··· menu** `[S: msg/20]`: Add Tab, View Tasks, Settings.
- When the header narrows, overflowed icons move into ···.
- The group/invite menu reported in the walkthrough notes (Add Members, Invite to Group, Share Group, Group Info, Settings) belongs to a different trigger and was not kept as a screenshot: **[UNVERIFIED]** placement.
- **Active state:** an icon whose panel is open gets a #EBECEF square fill (`msg/14`: ✔ highlighted).
- **Tooltips:** dark pill below the icon, e.g. "View Tasks", "Search in chat", "Settings" (`msg/11`, `msg/14`, `msg/15`).

#### B.4.4 **[ROX EXT] Header quick-view panels: Notes/Docs, Tasks, Calendar, Contacts**
Mark asked for one-click quick views inside the chat header. Lark web only has Search in chat, View Tasks, video and Settings. Rox adds four buttons **between Search and Settings**, all built on the **Tasks panel pattern** (`msg/14`, `msg/25`).

**Header order (Rox):**
🔍 Search in chat · 📝 **Docs** · ✔ **Tasks** · 📅 **Calendar** · 👥 **Contacts** · 🎥 Call (groups/DMs) · ⚙ Settings (1:1) or ··· (groups)

**Shared panel anatomy** (identical to Lark's Tasks panel):
```
┌──────────────────────────────── 328 ┐
│ Tasks                Open Tasks   × │  ← 56px header; title 16/600 left; link (primary, 14) right; × 16
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │  ← "create" card: 44px, white, radius 8, 1px #DEE0E3,
│ │ +  Create task                  │ │     icon + label (text.tertiary); hover border #1456F0
│ └─────────────────────────────────┘ │
│  list items (48–56px rows) …        │
│                                     │
│          [illustration 96]          │  ← empty state centred vertically
│   Tasks sent to this chat will      │     12px text.secondary, max 240 wide, centred
│   appear here.                      │
└─────────────────────────────────────┘
```
- **Container:** a separate rounded card to the right of the chat card, with the same 6px frame gap. Background #F8F9FA, width 328 (resizable 300–420; the width persists per user).
- **Behaviour:**
  - Only one panel is open at a time. Clicking another header button swaps the content in place with a 120ms cross-fade and no re-slide.
  - Clicking the active button, pressing ×, or pressing Esc closes the panel (200ms slide out).
  - The open panel is remembered per chat.
- **Panels**

| Button | Title | Header link | Create card | List content | Empty state copy (en / ru) |
|---|---|---|---|---|---|
| ✔ Tasks | **Tasks** | **Open Tasks** (opens the Tasks surface filtered to this chat) | **+ Create task** (inline quick entry; the task's source is this chat; assignee picker limited to members) | Task rows: checkbox, title, due chip, assignee avatar. Groups: **Ongoing** / **Completed** (collapsed). | "Tasks sent to this chat will appear here." / «Задачи, отправленные в этот чат, появятся здесь.» |
| 📝 Docs (Notes) | **Docs** | **Open in Docs** | **+ New doc** (menu: Doc · Note · Sheet/Base · Mind map; created in the chat's space and auto-shared with members) | Docs and notes shared in the chat or linked as tabs: icon, title, owner, last-opened time; row ··· = Open, Copy link, Add as tab, Remove from chat. Search field at top when >8 items. | "Docs and notes shared in this chat will appear here." / «Документы и заметки из этого чата появятся здесь.» |
| 📅 Calendar | **Calendar** | **Open Calendar** | **+ New event** (prefills attendees = chat members, title = chat name; for groups, books the group's meeting) | Agenda for the next 14 days of events that include this chat's members, or that were created from or linked to the chat: day headers, time, title, Join (if a call), RSVP chip. Toggle **This chat / Members' availability** (free/busy strip for up to 20 members). | "No upcoming events with this chat." / «Нет предстоящих событий с участниками этого чата.» |
| 👥 Contacts | **Members** (groups) / **Contact** (DM, bot) | **Add members** (groups) or **View profile** (DM) | Search field "Search members" | Group: member rows (avatar 32, name, role chip Owner/Admin/Bot, status emoji, local time), sections **Admins**, **Members**, **Bots**. DM: profile card (photo, name, department, title, local time, Message / Call / Video). | "Only you are here. Invite people to collaborate." / «Здесь пока только вы. Пригласите участников.» |

- **States (every panel):**
  - loading: 3 skeleton rows of 48px with a #EFF0F1 shimmer;
  - error: an inline banner "Couldn't load. Retry" with a button;
  - no permission: "You don't have access to this chat's …".
- **Keyboard:**

| Shortcut | Action |
|---|---|
| Ctrl/⌘+Shift+1 | Docs |
| Ctrl/⌘+Shift+2 | Tasks |
| Ctrl/⌘+Shift+3 | Calendar |
| Ctrl/⌘+Shift+4 | Contacts |
| Esc | Close panel |

  Register these in `renderer/actions/definitions.ts`. Check for conflicts with existing shortcuts first.
- **Settings:** an "Edit header buttons" item in chat Settings lets users hide any of the four. Admins can set org defaults.

#### B.4.5 Native side panels `[S: msg/12, msg/14, msg/15, msg/21–25]`

**Tasks panel** `[S: msg/14, msg/25]`:
- Header: title **Tasks**, **Open Tasks** link, ×.
- Card: **+ Create task**.
- Empty state: illustration (hand + checked card) and "Tasks sent to this chat will appear here."
- It is a separate card column.

**Search in chat panel** `[S: msg/15]`:
- Lives inside the chat card at 328 wide. Opening it splits the message list.
- Title "Search in chat" with ×.
- Tabs: **Messages** · Docs · Files · Images & Videos · Links. The active tab is blue with an underline.
- Search input (focus border #CBD8F8 → primary).
- Filter chips: **From ▾**, **Date ▾**, **Advanced Search ›**.
- Empty state: illustration and "Use keywords or filters to search messages."
- It can coexist with the Tasks panel (both open in `msg/15`).

**Settings, 1:1 bot** `[S: msg/12]`, top to bottom:
1. Header **Settings** ×
2. Identity card: avatar 48, name + BOT, subtitle
3. **Labels** — Add Label ›
4. ☐ Mute notifications
5. ☐ Pin to top
6. ☐ Flag
7. **Translation Assistant** ›
8. 🗑 **Clear All Chat History**

**Settings, group** `[S: msg/21]`, top to bottom:
1. Header **Settings** ×
2. Group card: avatar, name, "Edit group info", QR icon, share icon (tooltip "Share to invite others to join this group"), ›
3. **Members** 1 › with Search, avatars, ⊕ add, ⊖ remove
4. Rows with ›: **Bots**, **Chat Menu**, **Group Settings**
5. **My Alias**: "Enter my alias"
6. **Labels**: Add Label ›
7. Checkboxes: ☐ Mute notifications, ☐ Mute @All mentions, ☑ Pin to top, ☐ Flag
8. **Translation Assistant** ›
9. 🗑 **Clear All Chat History**
10. Footer: **Leave Group** (danger outline) and **Disband Group** (danger fill), side by side

**Group Settings sub-panel** `[S: msg/22, msg/23, msg/24]`:
- Header: ‹ **Group Settings** ×.
- **Message type:** two cards with preview art, **Chat** (radio ✓) and **Topic**.
- **Member permission management:**
  - **Group administrators** (Add Group Administrators link).
  - Each of these is a select defaulting to "Everyone in this group" (options: Everyone in this group / Only group owner and admins [DOCS]):
    - Who can edit group info
    - Who can add members or share group
    - Who can start video calls
    - Who can @mention all
    - Who can buzz others
    - Who can pin
    - Who can clip messages and announcements to top
    - Who can manage tabs, widgets and menus
    - Posting permission settings
- **Invitation settings:**
  - ☑ Membership approval: "New members must ask group owner or group admin for approval to join"
  - ☑ Find group via search: "Once enabled, a "Public" label will accompany this group, and members of the organization can find and join this group by searching for it."
  - ☑ New members can see chat history
- **Who'll be notified for new members:** Everyone in this group ▾
- **Who'll be notified when members leave:** Only group owner and admin ▾
- **View join and leave history** ›
- Changing a setting posts a system line in the chat, e.g. "T (agisota) changed settings to: Everyone in this group can manage group members or invite new members." and ""Find group via search" is turned on. Anyone within the organization can find and join this group by searching for it." (`msg/19`).

#### B.4.6 Chat tabs `[S: msg/13, msg/27, msg/28, msg/34–37]`
- **Tab row:** sits under the header title, 28px high, pill tabs (12px).
  - Active: #E9EAEB fill with blue text and icon.
  - Each tab has a leading icon; link tabs end with ↗.
  - **+** at the end opens **Add tab**.
- **Defaults:**

| Chat type | Default tabs |
|---|---|
| Group | **Chat** · **📢 Announcement** |
| Agent / bot chat | **Chat** · **File** · **Docs** |
| Official groups | admin-defined link tabs + Announcement |

- File/Docs tabs appear once content exists [DOCS].
- **Announcement tab** `[S: msg/28]`: a doc-like editor with the placeholder "Write an announcement here". Publishing posts it to the chat; it can be clipped to top as a **pinned announcement bar** under the tabs (`msg/37`: 📢 icon, text, "Clipped by Lark AI Advisor", ⊡ open, × close).
- **File tab** `[S: msg/35]`:
  - Top: "🔍 Search files in chat" input.
  - Table columns: **Title** (type icon, name, size under it), **Sent by**, **Time sent**, then row actions ⇥ (open in chat) and ···.
  - Rows are 30px raw (≈52 design).
- **Docs tab** `[S: msg/36]`: same table for docs; a doc row has an external-link icon.
- **Add tab dialog** `[S: msg/13]` (560 wide):
  - Title "Add tab" ×; subtitle "Add Docs or links, visible to members in this chat".
  - Field **Link**: "Enter or paste a link".
  - Field **Tab name**: "Enter a tab name".
  - Buttons **Cancel** and **Add**. Add stays disabled (grey #C9CDD4) until the link is valid.
  - Pasting a Rox doc link autofills the name with the doc title [UNVERIFIED in Lark; Rox behaviour].
- **Tab context menu** (rename, reorder by drag, remove): **[UNVERIFIED]**. Rox: right-click shows Rename · Move left · Move right · Copy link · Remove tab.
- **Rox mapping:** tabs are `chat_tab` rows (TECH-SPEC §4.2). Kinds: `chat` (fixed), `announcement`, `files`, `docs`, `pins`, `link`, `doc`, plus [ROX EXT] `tasks` and `calendar`. The latter two render the quick-panel content full-width.

#### B.4.7 Message area `[S: msg/10, msg/16–19, msg/34, msg/37]`
- **Date divider:** centred 12px tertiary text ("Jul 9").
- **Unread divider:** a blue line with "Aug 9 New" centred, #537DDF.
- **System lines:** centred 12px; names are blue links (`msg/19`).
- **Bot interactive card** (max 420 design wide; radius 8; 1px #DEE0E3):
  - coloured header: info #F0F4FF, title in blue; alert #FFF1F1, title in red;
  - body of key:value lines;
  - buttons (outline primary, e.g. "View renewal info").
  - Rendered from the Lark card JSON 2.0 schema (Rox already has `messaging-gateway/adapters/lark/card.ts`).
- **Text bubble:** received bubbles are #F2F3F5, radius 8, padding 8/12. Own messages: **[UNVERIFIED]** (Lark uses a light-blue fill, right-aligned on mobile and left-aligned on desktop per settings).
- **Reply quote:** "| Reply to T (agisota): alo?" in 12px tertiary above the bubble.
- **Voice message:** a ▶ play button, scrubber, duration "0:06", and a red dot when unplayed (`msg/34`).
- **Agent extras** (`msg/34`):
  - a "💭 Reasoning:" block with a code-style box and copy icon;
  - "✓ Context compaction complete — continuing turn…" system bubble;
  - a jump chip "⌄ 151 new messages", bottom-right, white pill with shadow.
- **Grouping:** consecutive messages from one sender within 5 minutes collapse the avatar [UNVERIFIED in Lark web; Rox default].
- **Message hover toolbar** `[S: msg/16, msg/17]`: floats at the top-right of the message: 👍 **Reaction** (hover → quick reactions), ↩ **Reply**, ··· **More**.
- **More menu** `[S: msg/18]`, in order:
  1. Multiselect
  2. — divider —
  3. Flag
  4. — divider —
  5. Pin
  6. Clip to Top
  7. Copy Message Link
  8. Translate
  9. Delete
  10. — divider —
  11. Add Task
  12. Export to Docs
- Docs-only items (shown when permitted): Reply in Thread, Forward, Edit, Recall, Buzz, Remind me later, Save to favourites [DOCS]. Their position in this menu is **[UNVERIFIED]**.
- **Read receipts:** a ring progress icon next to own messages; click to see who read it [DOCS, UNVERIFIED visual].

#### B.4.8 Composer `[S: msg/24, msg/29–33]`
```
┌──────────────────────────────────────────────────────────────┐
│ Message Общий чат                        Aa  ☺  @  ⊕  ⤢ │ ➤ │
└──────────────────────────────────────────────────────────────┘
```
- **Placeholder:** "Message <chat name>".
- **Buttons, right to left:** ➤ **Send** (tooltip "Send (Enter)"; grey until there is text, then blue), divider, ⤢ **Expand**, ⊕ **More**, @ **Mention**, ☺ **Emoji**, **Aa** **Show formatting**.
- **Formatting bar** (Aa) `[S: msg/33]`: B · I · S · bulleted list · numbered list · quote · code. It appears above the input.
- **Expand** `[S: msg/30]`: a large rich "post" editor with title "Untitled post", toolbar, and close.
- **Emoji picker** `[S: msg/31]`:
  - Header tabs: Frequently used, Default emojis, **+** (custom), ♥.
  - **Find** search and a ⚙ settings icon.
  - An 8-column grid.
- **More menu** `[S: msg/32]`, in order:
  1. Image & Video
  2. Local File
  3. Docs
  4. Contact Card
  5. Poll
  6. Task
  7. Translate
  8. Message Type
- **Keys:**

| Key | Action |
|---|---|
| Enter | Send (configurable to Ctrl+Enter) |
| Shift+Enter | Newline |
| @ | Mention picker |
| : | Emoji suggestions [DOCS] |
| ↑ in an empty composer | Edit last message [DOCS] |
| Ctrl/⌘+B / I / Shift+X | Bold / italic / strikethrough [DOCS] |
| Ctrl+V of an image | Attach preview |

- **States:**
  - disabled when the user lacks posting permission: "Only group owner and admins can send messages" [DOCS];
  - draft persists per chat;
  - sending: spinner then tick;
  - failed: red ! with "Resend" [UNVERIFIED visuals].

#### B.4.9 Group creation and onboarding `[S: msg/19, msg/26]`
- **Welcome block** in a new group:
  - "Welcome to the group" (16/600)
  - "Try the following steps to jump-start collaboration"
  - buttons **Pin Link** · **Add Group Info** · **Add Group Announcement**
- **Add members dialog** `[S: msg/26]`:
  - Search field.
  - Left sources: **Organization Contacts**, **External Contacts**, **Groups** | **Manage**.
  - Right: "Selected: 0 members".
  - Footer: **Batch Import** (left), **Cancel**, **Confirm** (Ctrl+Enter).

#### B.4.10 Channels and topic groups
- **Channel** (⊕ › New Channel): a public, searchable group optimised for broadcast. Posting is limited by "Posting permission settings", and it carries the Public tag. The creation dialog was not captured: **[UNVERIFIED]**. Rox reuses group screens with `chat.kind='channel'`.
- **Topic group** (Group Settings › Message type › **Topic**): the main view becomes a topic feed (cards of root posts with reply counts; replies open in the right panel). Docs-based, **[UNVERIFIED]** visuals. Layout in `APPENDIX-docs-reference.md` §1.
- **Threads & Topics** filter (§4.1) lists threads the user follows.

#### B.4.11 Contacts surface `[S: msg/39]`
- **Left column** (280):
  - title **Contacts**;
  - organisation row "ROX PUBLIC BENEFIT COMPANY" with a **Manage** link;
  - items with coloured icons: **External Contacts**, **New Contacts**, **Starred Contacts**, **My Groups**, **Help Desk**.
- The main pane is blank until an item is chosen.
- Org tree, member list, profile card: docs-based (APPENDIX §11) **[UNVERIFIED]**.

#### B.4.12 Messenger states

| Surface | Default | Hover | Active / selected | Empty | Loading | Error |
|---|---|---|---|---|---|---|
| Filter item | transparent | #EEF0F2 | #DFEAFA + blue | Labels: "Use labels to sort and manage all your chats" | — | — |
| Chat row | #FCFCFC | #F2F3F5 + ✓ | #E3EDFC | Main pane: "Set off on a delightful journey…" | skeleton rows [UNVERIFIED] | offline banner [UNVERIFIED] |
| Header icon | secondary | #EBECEF fill + tooltip | #EBECEF fill | — | — | — |
| Tasks panel | — | create card border blue | — | "Tasks sent to this chat will appear here." | [UNVERIFIED] | [UNVERIFIED] |
| Search in chat | — | — | blue tab underline | "Use keywords or filters to search messages." | [UNVERIFIED] | [UNVERIFIED] |
| Add tab | Add disabled | — | Add enabled when valid | — | — | invalid link inline error [UNVERIFIED] |
| History | — | — | — | — | top spinner on scroll-back [UNVERIFIED] | — |

#### B.4.13 Messenger keyboard shortcuts

| Shortcut | Action | Evidence |
|---|---|---|
| Ctrl/⌘+K | Global search | `msg/01` |
| Ctrl+Enter | Confirm in Add members | `msg/26` |
| Enter / Shift+Enter | Send / newline | `msg/29` |
| Esc | Close modal or panel | `msg/05` |
| ↑↓ ↵ | Navigate search results | `msg/05` |
| Alt+↑/↓ | Previous/next chat | [DOCS] |
| Ctrl/⌘+Shift+1…4 | Quick panels | [ROX EXT] |

---

### B.5. Docs, Wiki, Drive, MindNotes, Graph

#### B.5.1 Docs home `[S: docs/01–09]`
```
┌ ≡ 🌐 Lark Docs ───────┬ Home                                                   🔍  ⛬  ⋮⋮⋮  (av) ┐
│ 🔍 Search             │ ┌ ⊕ New ▾ ──────┐ ┌ ☁ Upload ▾ ──┐ ┌ 🎨 Templates ─┐                 │
│ ⌂ Home   (selected)   │ │Create a new document│ │Upload local files│ │Go to template gallery│     │
│ ◎ Drive               │ └────────────────┘ └───────────────┘ └────────────────┘                │
│ ▤ Wiki                │ Recent  Owned by Me  Shared With Me  Favorites  +    ⚲Filter ≡Display Settings [≣][▦] │
│ Pinned Wiki           │ Name                    Location        Owner      Created      Recent ↓   │
│  V Voice Task Atlas   │ 📄 TG Sources Graph 50k  ◎ Drive        (av) T     6:46 AM Sep 2 3:01 PM Sep 14 ··· │
│ My Document Library + ⋮≡ │ …                                                                   │
│  📄 Управленческая…   │                                                                         │
│ [⎙] [⌂] [🗑]          │                                                                         │
└───────────────────────┴─────────────────────────────────────────────────────────────────────────┘
```
- **Sidebar** (280; #F5F6F7):
  - collapse ≡, logo + **Lark Docs**;
  - **Search**;
  - nav **Home** (selected #D3DEF6), **Drive**, **Wiki**;
  - section **Pinned Wiki** (space chips);
  - section **My Document Library** with **+** and **⋮≡** (sort/multi-select [UNVERIFIED]) and a doc tree;
  - footer: 3 icons, the last being 🗑 Trash. The first two are unlabelled: **[UNVERIFIED]** tooltips; likely templates and an app/briefcase.
- **Header:** "Home" (20/600). Right: search, org-chart/graph icon, app grid, avatar.
- **Action cards** (3 across; radius 8; 1px border; icon 24):
  - **New ▾**, "Create a new document";
  - **Upload ▾**, "Upload local files";
  - **Templates**, "Go to template gallery".
- **New menu** `[S: docs/02]`: Docs, Sheets, Slides, Base, Form, MindNotes | Folder | *Applications*: Board, Flowchart.
- **Upload menu** `[S: docs/03]` [labels in screenshot: Upload file / Upload folder / Import; exact order UNVERIFIED].
- **Tabs:** **Recent** (active: blue text + 2px underline), Owned by Me, Shared With Me, Favorites, **+** (custom view).
- **Right controls:** **Filter** `[S: docs/04, 05]` (type filter), **Display Settings** `[S: docs/06]`, list/grid toggle `[S: docs/07]`.
- **Table:** columns Name, Location, Owner, Created, **Recent ↓**; 30 raw ≈ 52 design rows. Hovered rows show ··· `[S: docs/08]`; the right-click menu is `[S: docs/09]`.
- Tags inline after the name: **External** (blue), **Template** (purple).

#### B.5.2 Document page `[S: docs/70, 76, 87, 89, 92–105]`
```
┌ ≡ ⌂ │ ROX PUBLIC BENEFIT COMPANY › T › Weekly Meeting 📌      [Share] [✎ Editing ▾] 🔔 ··· │ 🔍 ＋ (av) ┐
│      ▪ Drive · Last modified: 3:28 AM Jul 10 · ◉ Rox                                            │
├──────────────────────────────── cover image (full width, 300 design) ───────────────────────────┤
│ «                │            Weekly Meeting  (H1 32/600)                                         │
│ Weekly Meeting   │  ┃ Doc Meeting guide (callout/quote)                                         │
│ I. Meeting overv.│    1. Prepare relevant …                                                     │
│ II. Week overview│  I. Meeting overview (H2)                                                    │
│ III. Project prog│                                                                               │
│   6. Project I   │                                                       [⎘ word count] [?]     │
└──────────────────┴───────────────────────────────────────────────────────────────────────────────┘
```
- **Header (56):**
  - sidebar toggle and home;
  - breadcrumb (org › folder › title) with 📌 pin (toggle "Added to Pins" / "Remove From Pins");
  - sub-line: location chip, "Last modified: <time>", owner;
  - right: **Share** (primary filled), **✎ Editing ▾**, 🔔, ···, divider, 🔍, ＋, avatar.
- **Mode menu** `[S: docs/82, wiki/11]`, each with a description:
  - **Editing**: "Edit document directly" ✓
  - **Suggesting**: "Edits become suggestions"
  - **Viewing**: "View or comment"
- **＋ create menu** `[S: docs/97]`: Docs, Sheets, Slides, Base, Form, MindNotes | *Applications*: Board, Flowchart | **Upload or Import ›**.
- **··· menu (Docs)** `[S: docs/76]`, in order:
  1. Page Width ›
  2. Presentation Mode
  3. — divider —
  4. Follow Updates (toggle)
  5. Find and Replace
  6. — divider —
  7. Add Shortcut To (ⓘ)
  8. Move To
  9. Add to Pins
  10. Add to Favorites
  11. — divider —
  12. Convert to Template (toggle)
  13. Make a Copy
  14. Download As ›
  15. Translate Into Russian ›
  16. — divider —
  17. Print
  18. — divider —
  19. Save as Version
  20. — divider —
  21. Permissions ›
  22. — divider —
  23. Add-ons ›
  24. — divider —
  25. Document Details
  26. People Mentioned
  27. Edit History
  28. Comment History
  29. — divider —
  30. More ›
  31. Delete
- **Submenus:**
  - **Page Width** `[S: docs/81, 98]`: Default / Wide / Full.
  - **Download As** `[S: docs/77, 99]`: Word, PDF, Markdown.
  - **Permissions** `[S: docs/78, 100]`: Manage Collaborators, Permission Settings, Transfer Ownership.
  - **Add-ons** `[S: docs/80]`: labels in the screenshot.
  - **More** `[S: docs/79, 101]`: Add Applications, Show Paragraph Authors (toggle), Report.
- **Wiki page ··· menu** `[S: wiki/06, wiki/12]`: identical to the Docs menu above. The Add Shortcut To item shows a ⓘ in Wiki.
- **Notifications bell** `[S: docs/102]`: panel **Notifications** with **Mute** and **All marked as read**, plus an empty state.
- **Share dialog** `[S: docs/71, 95, 96]` (anchored popover under Share, ≈450 design):
  - title "Share the document ⓘ", **⚙ Permission settings** link;
  - **Invite collaborators**: owner avatar ›; input "Search users, groups, departments, user groups, emails, a…" with a **+**;
  - **Link sharing**: org icon, "ROX PUBLIC BENEFIT COMPANY ▾", "People in the organization with the link can view", role dropdown **Can view ▾**;
  - role dropdown menu `[S: docs/96]`:
    - *Permissions*: **Can view** ✓, **Can edit**
    - *Searchable*: "Anyone in the organization can search" (toggle), "Now only people with the link"
  - footer: **🔗 Copy Link** and share-to icons (Lark, QR, etc.).
- **Permission settings dialog** `[S: docs/72, 73]` (480):
  - **External sharing:**
    - ☑ Allow the content to be shared externally
    - ☐ Only collaborators with manage permission can share the content externally
    - ☐ Enable secure link
  - **Who can view, invite, and remove collaborators:** "Users with view permission ▾"; ☐ Only people in the organization can view, invite, and remove collaborators
  - **Who can copy content:** ▾
  - **Who can duplicate, print or download:** ▾
  - **Who can comment:** ▾
  - **▾ Advanced settings:**
    - *Organization information transparency settings*: ☐ Auto-approve access for managers of the owner; ☐ Allow managers of the owner to search and access (disabled)
    - *Automatic sharing settings*: ☐ Once the number of collaborators exceeds 10, allow managers of the owner to search and access
- **Block handle menu** `[S: docs/83, 93]`. The handle is the block-type glyph plus ⠿, shown to the left of a hovered block.
  - Top quick-type grid: T, H1, H2, H3, numbered list, bulleted list / ☑ todo, { } code, ❝ quote (current type highlighted).
  - Then, in order:
    1. Align and Indent ›
    2. Color Options ›
    3. — divider —
    4. Comment
    5. Cut
    6. Copy
    7. Translate
    8. Delete
    9. — divider —
    10. Share
    11. Save to My Templates
    12. Copy Link
    13. — divider —
    14. Insert Below ›
- **Insert Below submenu** `[S: docs/85, 105]` (scrollable):
  - *Basics*: T H1 H2 H3, numbered, bulleted / { } code, synced, divider, link (icon grid)
  - *Common*: Todo, Image, Video or File, Column ›, Synced Block, Button ›, Equation
  - *Draw*: Board, Mind Map, Flowchart, UML Diagram, More 1.0 ›
  - *Collaboration*: Person, Group Card, …
- **Align and Indent** `[S: docs/84, 103]` and **Color Options** `[S: docs/86, 104]` (text colour + background swatches): see the screenshots.
- **Numbered list** `[S: docs/91]`: clicking a number shows the tooltip "Set the number" and a numbering menu.
- **Selection toolbar** `[S: docs/87]` (floating above the selection, 28 raw ≈ 48 design):
  - [block-type ▾] | [align ▾] | **B S I U** 🔗 `</>` **A▾** (text colour/highlight) | three more icons.
  - The last three are probably apps/insert, translate, and 💬 comment; their tooltips are **[UNVERIFIED]**.
- **Block style menu** `[S: docs/88]`: Body Text, Heading 1, Heading 2, Heading 3, Other Headings ›, Numbered List ✓, Bulleted List, Todo, Code Block | Quote ✓, Synced Block.
- **Search palette (Ctrl+J)** `[S: docs/94]` (centred, 520 design):
  - input "Search" with a filter icon;
  - **Advanced Search** row;
  - *Search history* ("form");
  - *Recently viewed* rows: icon, title, tags, "👁 You opened: 10 minutes ago", Wiki space;
  - footer "Find more recently opened pages in advanced search (Ctrl + Shift + F)".
- **Doc footer** `[S: docs/89]`: 👍 circle "Be the first to like this", then an "Add a comment" box with 🖼 and ···. Floating bottom-right: ↑ back-to-top and ?. A word count ("3 words" / "11 words") appears bottom-right while text is selected `[S: docs/87, 88]`.
- **TOC column** `[S: docs/76, 92]`: « collapses it. Current heading in blue; indented levels.
- **Comments panel, doc details panel, slash ("/") palette, presence cursors:** not captured. **[UNVERIFIED]**. Use APPENDIX §2.
- **Rox:** the slash palette reuses the Insert Below taxonomy.

#### B.5.3 Wiki `[S: wiki/01–13]`
- **Home** `[S: wiki/01, 08]`: space cards. Hovering a card shows a **Settings** button.
- **Space layout** `[S: wiki/02, 03]`:
  - sidebar 280: "⌂ Lark Docs", space card "W Wiki samples" + **Org access** chip, Search, "Table of contents ▾" with **+** and a list icon;
  - tree rows (hover shows + and ···; selected is light blue);
  - footer icons: ⚙ settings, ⇪ share, graph, 🗑. Tooltips for share/graph are **[UNVERIFIED]**.
- **Page header:** breadcrumb "ROX PUBLIC BENEFIT COMPANY › Wiki samples › Welcome to Wiki" 📌; "Last modified: 10:35 AM Jul 8 · Rox"; Share, Editing ▾, 🔔, ···, 🔍, ＋, avatar.
- **Tree node ··· menu** `[S: wiki/05, wiki/10]`, in order:
  1. Open in New Tab
  2. — divider —
  3. Share
  4. Copy Link
  5. — divider —
  6. Make a Copy
  7. Move To
  8. Add Shortcut To
  9. Add to Pins
  10. Add to Favorites
  11. Transfer Ownership
  12. — divider —
  13. Rename
  14. — divider —
  15. Remove From Wiki Space
  16. Delete
- **Tree node +** `[S: wiki/04, 09]`: creates a child page (type menu as ＋ create).
- **Space info / admins card** `[S: wiki/07, 13]`: space name, description, admins list.

#### B.5.4 MindNotes, mind-map view, graph view `[S: user/01, user/02, user/03, user/06]`
- **Mind-map view of a doc** `[S: user/02]`:
  - centred root node; branches with rounded labels;
  - floating bottom-left palette: ↶ ↷, structure icon [UNVERIFIED tooltip], zoom "53%".
  - The node toolbar is docs-based (APPENDIX §2.4).
- **Doc ··· in mind-map mode** `[S: user/01]`: desktop-only labels; transcribed in APPENDIX §2.
- **TOC tree** `[S: user/03]`.
- **Graph view** `[S: user/06]`:
  - header "‹ ⛬ Graph view" with a centred Search (≈260);
  - nodes are circles with labels below; the focused node is blue; edges are grey.
  - Pan/zoom/drag behaviour is **[UNVERIFIED]**. Rox default: wheel = zoom, drag background = pan, drag node = pin, click = select + highlight neighbours, double-click = open.

#### B.5.5 Docs states

| State | Spec |
|---|---|
| Empty new doc | Title placeholder "Untitled" (Lark: "Please enter a title" [UNVERIFIED]); body placeholder "Type / to insert" [UNVERIFIED] |
| Empty TOC | hidden |
| Loading | skeleton title + 6 lines [UNVERIFIED] |
| Offline | banner "You're offline. Changes will sync when you reconnect" (Rox; Yjs local persistence) |
| Error / no access | "You don't have permission to view this document" + **Request access** [DOCS] |

#### B.5.6 Docs keyboard shortcuts

| Shortcut | Action | Evidence |
|---|---|---|
| Ctrl+J | Search palette | `docs/94` |
| Ctrl+Shift+F | Advanced search | `docs/94` |
| `/` | Insert block | [DOCS] |
| Ctrl+Alt+1..3 | Headings | [DOCS] |
| Ctrl+Shift+7 / 8 | Lists | [DOCS] |
| Ctrl+K | Link | [DOCS] |
| Ctrl+Alt+M | Comment | [DOCS] |
| Ctrl+F / Ctrl+H | Find / replace | `docs/76` |
| Tab / Shift+Tab | Indent / outdent | [DOCS] |

---

### B.6. Base `[S: docs/40–56]`

#### B.6.1 Layout
```
┌ ≡ ⌂ │ ROX… › T › ▣ TG Sources Graph 50k [External] 📌      [🌐 Share] [🤖 Automations] ⎘ ⧉ 🔔 ··· │ 🔍 ＋ (av) ┐
├ 🔍Search  + « ─┬ ▤ グリッド ⋮  │ + Add View ─────────────────────────────────────────────────────────────┤
│ ▤ People ⋮    │ + Add Record ▾ │ ⚙ Customize Field │ ⊞ View Settings │ ⚲ Filter │ ⊟ Group By │ ⇅ Sort │ ↕ Row Height │ ◐ Conditional Coloring │ … ⊞ Generate Form ⇪ ↶ ↷ ⊟ 💬 │
│ ▤ Projects    │ ☐ │ 🔒A Key │ ◎ Platform │ A Login │ A Name │ A Bio │ 🔗 URL │ # Followers │ # Following_n │
│ ▤ Tweets      │ 1 │ github:0wulf │ (github) │ 0wulf │ … │                                          57 │
│ …             │ …                                                                                          │
│ [+ New]       │ Calculating ▾ (per-column stats) · 20,000 records ▾                    [Search Records]   │
└───────────────┴────────────────────────────────────────────────────────── [View User Guides] [Summarize This Base] (✦) ┘
```
- **Left table list** (≈210 design):
  - Search, **+**, «;
  - table rows with a ⋮ on hover; selected #E6F0FF;
  - footer **+ New**. Its menu is **[UNVERIFIED]**; docs say Table, Dashboard, Workflow, Document, Form, Folder.
- **View tabs:** view name with ⋮, then **+ Add View**. Renaming a view edits the tab inline (`docs/53`, `55`, `56`).
- **Add View menu** `[S: docs/41]`:
  - *Basic*: Grid View, Kanban View, Calendar View, Gantt View, Gallery View, Form View
  - *Page*: Query Page
- **Toolbar (grid)** `[S: docs/40]`:
  - **+ Add Record ▾** (menu: Add Record, AI Import *New*, `docs/44`), Customize Field, View Settings, Filter, Group By, Sort, Row Height, Conditional Coloring;
  - right side: ⏱ (history/automation runs [UNVERIFIED]), **Generate Form**, export ⇪, ↶ ↷, search ⊟, 💬 comments.
- **Grid:**
  - header row with field-type glyphs; frozen primary field 🔒 **Key**;
  - row number column with checkbox;
  - single-option chips (pink "github");
  - URL cells in blue; numbers right-aligned;
  - footer: per-column statistic ("Calculating ▾") and the record count "20,000 records ▾".
- **AI helper:** floating chips **Search Records**, **View User Guides**, **Summarize This Base**, and a ✦ FAB (bottom-right).
- **Filter popover** `[S: docs/42]`: "Filter records ⓘ", **+ Add Condition**, an AI box "Tell AI what you'd like to see." ➤. The operator vocabulary is **[UNVERIFIED]** (docs list in APPENDIX §3).
- **Row Height** `[S: docs/43]`: Short / Medium / Tall / Extra Tall.
- **Customize Field / Fields panel** `[S: docs/45, 46, 47]`:
  - field list with drag handle, 👁 visibility and ··· per field, plus **+ New field**;
  - the new-field popover has **Field title**, **Field type** (Text ›), **Explore Field Shortcuts**, **Default value**, *Recommended* chips (Created By, One-way Link, Formula, Record ID, Custom AI Autofill *AI*), **Cancel** / **Confirm**.
- **Field type picker** `[S: docs/47]`:
  - *Basic*: Text, Single Option, Multiple Options, Person, Group, Date, Attachment, Number, Checkbox, Link, Formula, Lookup
  - *Business*: Flow, Button, Numbering, Phone Number, Email, Location, Barcode, Signature, Progress, Currency, Rating
  - *Relations / system*: Two-way Link, One-way Link, Created By, Modified By, Date Created, Last Modified
- **Share** `[S: docs/48]`: link access "Anyone with the link can view" plus invite.
- **··· menu (Base)** `[S: docs/51]`, in order:
  1. About New Base ›
  2. Sandbox ⓘ
  3. — divider —
  4. Add to Workplace ⓘ
  5. Add Shortcut To ⓘ
  6. Move To
  7. Add to Base Workspace
  8. Add to Pins
  9. Add to Favorites
  10. — divider —
  11. Convert to Template (toggle)
  12. Work Mini Apps
  13. Make a Copy
  14. Import
  15. Export ›
  16. — divider —
  17. Permissions ›
  18. — divider —
  19. Document Details
  20. Edit History (toggle)
  21. Comment History
  22. — divider —
  23. More ›
  24. Delete
- **Export ›** `[S: docs/52]`: Excel, CSV, Base.
- **Automation center** `[S: docs/49, 50]` (modal, 860):
  - header 🤖 "Automation center", tabs **Recommended** | **Manage (0/0)**;
  - left nav: Recommended, Notifications, Record Updates, Scheduled Tasks | User Guides;
  - cards with a "trigger → action" title and description, e.g.:
    - Add automation (+)
    - Auto send multiple records
    - When a record updates → Send a Lark message
    - At scheduled time → Send a Lark message
    - When a button is clicked → Send a Lark message
    - When a new record is added → Send a Lark message
    - At record's trigger time → Send a Lark message
    - When a button is clicked → Update record
    - When a new record is added → Add record
    - At record's trigger time → Update record
    - At scheduled time → Add record

#### B.6.2 Views
- **Kanban** `[S: docs/53]`:
  - toolbar: Add Record, **Group by Platform**, **Customize Card**, Filter, Sort;
  - columns have a coloured option chip, a count (19451) and ···;
  - cards show a bold primary field plus the visible fields (chips, links);
  - column footer **+**; **+ New Group** column at the end.
- **Gallery** `[S: docs/54]`: card grid.
- **Gantt** `[S: docs/55]`:
  - toolbar: Add Record, Customize Field, **Gantt View Settings**, Filter, Group By, Sort;
  - left list of records with «, timeline header "Oct 2026", day numbers;
  - **Week | Month | Quarter | Year** (Month active), **Today**, ‹ ›;
  - today vertical blue line; weekends shaded.
  - Dependencies: **[UNVERIFIED]**.
- **Calendar** `[S: docs/56]`:
  - toolbar: Add Record, **Event Settings**, **Calendar View Settings**, Filter;
  - **Today**, ‹ ›, "Oct 2026 ▾"; **Day | Week | Month** (Month active);
  - grid Mon–Sun; today = blue filled circle.
- **Form view:** §7.

#### B.6.3 Base states

| State | Spec |
|---|---|
| Stats | "Calculating ▾" while aggregates compute (`docs/40`) |
| Empty table | **[UNVERIFIED]**. Rox: one grid view; fields Text (primary), Single Option, Date, Attachment |
| Empty filter result | **[UNVERIFIED]** "No records match the filter" |
| Loading | **[UNVERIFIED]** |

---

### B.7. Forms `[S: docs/57–61]`
```
┌ ≫ People ▾ │ ▤ グリッド │ Kanban │ Gallery │ Gantt │ Calendar │ [Form ⋮] │ +                        ┐
│                       [✎ Edit] [▣ Fill]                          [👥 Invite Respondents] ⎘ ⚙ │
├ Questions  Add all  Remove all ┬───────── cover (blue art)  [Edit Cover] ─────┬ Respondents ──────┤
│ ◎ Platform               +     │           ┌───────────────┐                 │ Submission limits ○│
│ A Login                  +     │           │     Form      │                 │ Require login     ○│
│ …                              │           │ Enter form description          │ Allow response editing ○│
│ New questions                  │           │ Key 🔒   ○ Required  ⊖          │ Notify recipients for new responses ○│
│  Basic questions               │           │ [Answer area            ]      │ Schedule reminder ○│
│  [A Text][◎ Single Option]…    │           └───────────────┘                 │ ✚ Turn on anonymous submission and form expiration │
│  General questions …           │                                              │                   │
└────────────────────────────────┴──────────────────────────────────────────────┴───────────────────┘
```
- **Modes:** **Edit** | **Fill** (segmented control, top centre).
- **Left panel** (≈260):
  - **Questions** with **Add all** / **Remove all**; existing fields each with **+**;
  - **New questions**:
    - *Basic questions*: Text, Single Option, Multiple Options, Date, Attachment, Number, Person
    - *General questions*: Rating, NPS, Progress, Checkbox, Link, Phone Number, Email, Location, Barcode, Currency, Group, Details Table, Two-way Link, One-way Link, Formula, Lookup (`docs/58`)
- **Canvas:**
  - cover with **Edit Cover**; card title "Form", "Enter form description";
  - each question has a label (primary field "Key" 🔒), a **Required** toggle, ⊖ remove, and an "Answer area" input;
  - onboarding popover "Set default values for your fields now!" with Got It / Try Now.
- **Right panel "Respondents"** (toggles):
  - Submission limits, Require login, Allow response editing, Notify recipients for new responses, Schedule reminder;
  - link "Turn on anonymous submission and form expiration".
- **Invite Respondents** `[S: docs/59]`: popover reading "Invite via link is off", with a toggle.
- **Standalone Forms** `[S: docs/60, 61]`: green Form-type docs, templates Work Handover Form, Question Collection Form, Job Application Form.
- **[UNVERIFIED]:**
  - per-day submission limits;
  - after-submit message;
  - option display styles;
  - Location input modes;
  - the Lark Forms app home (from Workplace).

---

### B.8. Calendar `[S: cmt/01–14]`

#### B.8.1 Layout (week view, default)
```
┌ Oct 2026      ‹ › ˄ ┬ [Today] ‹ › Oct 2026                               [Day|Week|Month] ⋮⋮⋮ (av) ┐
│ Su Mo Tu We Th Fr Sa│ GMT+3 │ Sun 4 │ Mon 5 │ Tue 6 │ Wed 7 │ Thu 8 (blue) │ Fri 9 │ Sat 10 │
│ 27 28 29 30  1  2  3│ 00:34 ●━━━━━━━━━━━━━━━━━━━━━━━━━━ red now-line ━━━━━━━━━━━━━━━━━━━━━━━━━ │
│  4  5  6  7 (8) 9 10│ 01:00 │       │       │       │       │ ░ today col  │       │        │
│ …                   │ 02:00 │  hour rows 26 raw ≈ 44 design                                     │
│ 🔍 Search contacts, rooms  + │                                                                   │
│ Managing          ˄ │                                                                    (＋ FAB) │
│  ☑ T                │                                                                           │
│ Following         ˄ │                                                                           │
│ xs…@gmail.com G   ˄ │                                                                           │
│  ○ xsschain@gmail…  │                                                                           │
│  ○ Family           │                                                                           │
└─────────────────────┴───────────────────────────────────────────────────────────────────────────┘
```
- **Sidebar** (240; #F5F6F7):
  - mini month: header "Oct 2026", ‹ › and collapse ˄; weekday row Su…Sa; today has a blue ring, the selected day a filled ring; other-month days grey;
  - "🔍 Search contacts, rooms" with **+**;
  - collapsible sections **Managing**, **Following**, and the connected account (Google "G" badge);
  - calendar rows: colour checkbox + name; hover shows ⚙ (`cmt/13`).
- **Top bar:** **Today**, ‹ ›, "Oct 2026" (18/600), segmented **Day | Week | Month** (active = light-blue fill, blue text), app grid ⋮⋮⋮, avatar.
- **Grid:**
  - time gutter labelled "GMT+3";
  - day headers "Sun / 4", where today shows weekday and date in blue (the date 20/600);
  - today's column is shaded #F5F5F7;
  - red now-line with a dot and a time label in red ("00:34");
  - blue FAB **＋** bottom-right (#336DF4, 40 design).
- **Views:** Day `[S: cmt/02]`, Week `[S: cmt/01]`, Month `[S: cmt/03]`. 3-day, List and Year are not offered on web.
- **Quick-create popover** `[S: cmt/09]`. Dragging or clicking a slot draws a draft block ("New event, 07:30 - 08:00": light blue, blue left border). The popover (≈460 design) contains:
  - title "Add title" (focused, blue border);
  - date/time row: date, start, —, end, date;
  - 👥 "Add contacts or groups";
  - 🚪 **Add rooms**;
  - 📝 "Add description";
  - 📅 calendar select (● T ▾);
  - footer: **More Options** (outline) and **Save** (primary).
- **Full event editor** `[S: cmt/08]` (full-page; the left form is ≈1000 design; the right is a day preview with « collapse):
  - × close, "Add title", **Save**;
  - date/time row + **Time zone** link; **No repeats ▾**; ☐ All-day;
  - *Event Details*:
    - **Add rooms**; "Add location";
    - 🔔 "5 min before ▾" ×, **Add alerts**;
    - calendar ▾ + colour ▾;
    - **Default visibility ▾** ⓘ; **Busy ▾**;
    - description editor (📎 B I U S, lists) "Add description";
  - *Guests*: "Add contacts or groups"; **Guests can:** ☐ Modify event, ☑ Invite others, ☑ See guest list.
- **Notification options** `[S: cmt/10]`; **Search people** `[S: cmt/11]`.
- **Add-calendar (+) menu** `[S: cmt/12]`: Subscribe to calendar, Subscribe to holiday calendar, Add calendar by iCal, Import, Create new calendar.
- **Calendar row ⚙ menu** `[S: cmt/13]`: Calendar Settings, Manage calendars, Notification, View as, Feedback, Help, About.
- **Edit calendar dialog** `[S: cmt/14]`:
  - name, alias;
  - **Permissions**: Private / Show only free/busy / Public;
  - colour, description;
  - sharing members with roles Owner / Editor / Follower / Guest;
  - **Save**.
- **Settings page** `[S: cmt/06, 07]` ("‹ Settings" › **Calendar Settings**):
  - Third-party calendar management **Settings**;
  - Default event notification "5 min before";
  - Default all-day event notification "On the same day at 08:00";
  - Default event duration "30 min";
  - **Event color**: Light mode / Dark mode (preview cards);
  - Start week on "Sunday";
  - ☐ Enable working hours ("People will get a note when they try to invite you to events outside of your working hours." **View note**);
  - ☑ Reduce the brightness of past events;
  - ☑ Show declined events;
  - ☑ Do not send notifications for declined events;
  - ☐ Notify me when someone declines my invitation;
  - ☑ Use device time zone "(GMT+03:00) Moscow Standard Time - Moscow";
  - ☐ Show additional time zone;
  - ☐ Alternate calendars;
  - **CalDAV sync**.
- **App switcher** `[S: cmt/04]`; **Account menu** `[S: cmt/05]`: Language, Theme (Light), Log out.
- **[UNVERIFIED]** (the account had no events):
  - saved event block anatomy;
  - the event detail popover (docs: Edit, Share, ···, RSVP, Join);
  - conflict display;
  - drag-resize visuals;
  - loading state.

---

### B.9. Meetings
- **Verified (web landing)** `[S: cmt/15, 16]`:
  - rail Meetings opens a landing: illustration, "Smooth, collaborative meetings", **Start a meeting** (primary), **Join a meeting** (outline), "Already have Lark installed? Open";
  - **Join Meeting** form: avatar preview, camera and mic toggles, "Meeting ID" input, **Join** (disabled until 9 digits).
- **In-call UI: NOT reachable live. Docs-based, every item [UNVERIFIED].** Full spec in APPENDIX §4. Summary for builders:
  - **Window:**
    - top bar: topic, ⓘ meeting info, duration, recording/AI indicators, network quality;
    - top-right **Layout** (Gallery / Thumbnail / Side by Side / Speaker; Hide My View; Hide non-video participants);
    - full screen.
  - **Bottom toolbar** (docs order): Mic ˄ · Camera ˄ · Share Screen · Participants · Chat · Record · Minutes/Transcribe · Reactions · Breakout Rooms (host) · Effects · More · **Leave** (red).
  - **Host controls:** Mute all, Lock, Lobby, Allow unmute, Allow rename, Allow share, Remove, Make co-host.
  - **Panels** (right, 328, same pattern as §4.5): Participants, Chat, Minutes/Transcript, Breakout rooms.
  - **States:** lobby "Waiting for the host to let you in"; reconnecting banner; muted by host toast.
- Rox builds the in-call UI on LiveKit components (TECH-SPEC §7), styled with §2 tokens.

---

### B.10. Tasks `[S: cmt/17–32, user/04]`

#### B.10.1 Layout
```
┌ ≡ Tasks         ··· ┬ Owned                                                     [New Task ▾] ┐
│ 👤 Owned        181 │ ≣ List   ⫶ Kanban                                                       │
│ 🔖 Subscribed       │ [+ New Task ▾] ⇄ Ongoing  ⚲ Filter 1  ⇅ Sort by: Custom  ⊟ Group by: Custom Group  ⚙ Customize │
│ 🕘 Activities       │ ▾ Default Group 181                                                     │
│ ⛓ Connect Agents    │   ○ 1   ▤4            📅      📅      -               (av) T   Jul 30, 2:19 PM │
│ ▾ Quick Access      │   ○ RuProfile + …     📅      📅      -               (av) T   Jul 21, 10:24 … │
│   All Tasks         │   ○ Kuykon            📅      📅   [Things 3 Mirror]  (av) T   Jul 21, 9:44 AM │
│   Created           │  Task Title        Start Time  Due Date  Task List    Creator   Created at │
│   Assigned          │                                                                          │
│   Completed         │                                                                          │
│ Task List         + │                                                                          │
│   ▱ Things 3 Mirror │                                                                          │
│ + New Group         │                                                                          │
└─────────────────────┴──────────────────────────────────────────────────────────────────────────┘
```
- **Sidebar** (224):
  - **Tasks** (20/600) with ···;
  - items: **Owned** (count, selected #E6F0FF), **Subscribed**, **Activities**;
  - divider, **Connect Agents**;
  - **▾ Quick Access**: All Tasks, Created, Assigned, Completed;
  - **Task List** with **+**; lists;
  - **+ New Group**.
- **Header:** title "Owned"; **New Task ▾** (primary, top-right; `cmt/18` menu: **New Task** Ctrl+N, **New Task List** Ctrl+L); tabs **List** | **Kanban**.
- **Toolbar:** + New Task ▾ (split button), **Ongoing** ⇄, **Filter 1** (active = blue chip), **Sort by: Custom**, **Group by: Custom Group**, **Customize**.

| Control | Contents | Evidence |
|---|---|---|
| Ongoing menu | Ongoing, Completed, All Tasks | `cmt/19` |
| Filter panel | "If Owner contains X" rows, **Clear All**, **Add Filter**. Fields: Owner, Start Time, Due Date, Completed at, Assigned by, Subscriber, Creator, Created from | `cmt/20`, `21` |
| Sort by | Custom, Start Time, Due Date, Created at, Last Modified at, Completed at | `cmt/22` |
| Group by | None, Custom Group, Start Time, Due Date, Creator, Created from | `cmt/23` |
| Customize (columns, 👁 toggles) | Owner, Estimates, Start Time, Due Date, Sub-task Progress, Task List, Created from, Creator, Assigned by, Subscriber, Created at, Completed at, Last Modified at, Task ID, Source Category | `cmt/24` |

- **Rows** (≈44 design):
  - ○ checkbox; title (click = inline edit); sub-task count "▤ 4";
  - date cells (📅 placeholder until set; click opens the date popover);
  - task list chip (grey "Things 3 Mirror"); creator chip (avatar + name); created time;
  - hover is light grey `[S: cmt/25]`.
- **Group header:** "▾ Default Group 181".
- **Date popover** `[S: cmt/26]`: month grid, **Start date** (optional), **Due date**, **Add time**, **Alert**, **Clear All**.
- **Kanban** `[S: cmt/27, 32]`:
  - columns per group ("Default Group 181"), **+ New Group**;
  - cards: ○ title, meta icons; hover shows a border and ···;
  - clicking a card opens the detail pane (`?task=<id>`).
- **Detail pane** `[S: cmt/28]` (560, right side, separated by a divider):
  - header: **✓ Mark Complete** (outline primary); icons 🔖 subscribe, ⇪ share, ⧉ copy, ···, ×;
  - title (20/600); chip "Created in Rox: Rox";
  - 👤 owner chip | group ▾ "Default Group";
  - 📅 chips **Today**, **Tomorrow**, **Other**;
  - task list "Things 3 Mirror" | group ▾; "+ Add to Task List";
  - ≡ description; ⊢ **Add Sub-task**; 📎 **Add Attachment**;
  - **Comment** section with activity ("T (agisota) created task Jul 21, 9:44 AM");
  - composer "Add a comment" (Aa ☺ @ 🖼 📎 ➤); footer **Add Subscribers**.
- **Subscribed (empty)** `[S: cmt/31]`; **Activities** timeline grouped by date `[S: cmt/30]`.
- **Connect Agents** `[S: cmt/29]`: "Connect your agents to Lark Tasks", **Integration Guide**, **Connect New Agent** / **Restart Agent**. Rox maps this directly to Rox agents (bots), which can own tasks.
- **Desktop shot** `[S: user/04]`: Owned list with sections (phase-1 parts corrected: rows "setup" 0/8, "outline" 0/9 doc, "oo").
- **[UNVERIFIED]:**
  - Tasks ··· menu;
  - Task List + menu;
  - task list overview / archive;
  - overdue colour (expect red due date);
  - completion animation;
  - archived banner.

---

### B.11. OKR `[S: wiki/15, 16, 17, user/05]`
- **Header:**
  - "◎ Lark OKR" logo; tabs **Goals** | **Alignment** | **Reviews**;
  - right: ?, ⚙, avatar.
- **Left** (≈230): "Search employee", **My OKRs**, user row (selected light blue); « collapse handle at mid-height.
- **Goals:**
  - person header (avatar, name);
  - cycle switcher: ‹ **Oct 2026** (selected, blue text) | Sep 2026 ›;
  - three icon buttons: 💡-like icon, 💬, ···. Their functions are **[UNVERIFIED]**: docs suggest Writing assistant / Comments / More.
- **Empty state** `[S: wiki/15]`: illustration, "No content", **+ Add an Objective** (primary), **Import from another cycle** (outline).
- **Alignment (empty)** `[S: wiki/16]`; **Reviews** `[S: wiki/17]`.
- **Filled layout** `[S: user/05]` (corrected in phase 1):
  - O1 and O2 are draft cards; KR texts E/W/R; a KR4 placeholder;
  - auto weights 25% / 100%;
  - footer **Publish** (disabled) / **Cancel** / 🔒 / **Saved** on a light-blue strip; collapse handle at the top of the panel.
- **[UNVERIFIED]:**
  - weight-sum validation message;
  - progress popover statuses (docs: On track / At risk / Off track, default No status);
  - review docs.

### B.12. Workplace and Email

#### B.12.1 Workplace `[S: wiki/18, 19]`
- **Header:** Search (Ctrl+K), **Find more apps**, **Create apps**, **Settings**.
- **Favorites** card with **+**.
- **All Apps** category tabs: Recently Used, OA, Productivity, Media & News, Finance, Office Management, Project Management, Business Travel, Customer Support, Comprehensive HRM.
- **App tiles** (icon 40 + name + one-line description): Approval, Announcement, Lingo, Automation Assistant, Subscriptions, Seal Request, Reimbursement, Purchase, Payment Request, Direct Deposit Request, Lark Forms, Suite Admin, Meegle, Business Trip Request, Out-of-office, Customer Support, Help Center, Tanca HR, Attendance, OKR, Recruitment, Leave, Overtime.
- **[UNVERIFIED]:** the favourites edit flow, and whether apps open as a temporary rail tab or a window (desktop shots show rail tabs).

#### B.12.2 Email
- **Verified** `[S: wiki/14, wiki/20]`:
  - the account had **no mailbox**; the empty state reads "No email address";
  - the app-grid menu: Messenger, Calendar, Docs, Wiki, Email, Meetings, Open Platform, App Directory, Admin.
- **Mail client UI: NOT reachable live. Docs-based, every item [UNVERIFIED].** APPENDIX §10 has the full spec:
  - sidebar: Compose, accounts, Inbox (Priority/Other), Flagged, Drafts, Sent, Scheduled, Archive, Spam, Trash, labels, folders;
  - message list: sender, subject, preview, time, attachment/flag icons; conversation mode;
  - reading pane: Reply / Reply all / Forward, Archive, Delete, Spam, Unread, Flag, Label, Move, **Share to chat**, ···;
  - composer window: To/Cc/Bcc, subject, rich text, attachments, signature, schedule send.
- Rox: the client UI follows these docs. The backend already has `packages/shared/src/mail` (JMAP client and Stalwart admin) and `apps/electron/src/main/mail`.

---

### B.13. Register of former LIVE markers

Phase 1 left **97** LIVE markers in `parts/*.md`. The phase-1 report counted 89, a figure that predates the steering update; the final grep finds 97.

- **29** are now **VERIFIED** against walkthrough screenshots.
- **66** remain **[UNVERIFIED]**.
- **2** were meta references (the header and plan text).

Literal LIVE markers left in the final docs: **0**.

**Why the unverified items remain:**
- Meetings in-call UI and the Email client could not be reached (no mailbox).
- The test account had no calendar events.
- Some items are desktop-only.
- Transient states (loading, offline, failed send) and animation timings never appeared on screen.

| # | Source (phase-1 part:line) | Status | Evidence / what is still unknown |
|---|---|---|---|
| 1 | 00-header.md:4 | meta | meta |
| 2 | 00-header.md:44 | UNVERIFIED | desktop title-bar compass icon |
| 3 | 01-messenger.md:18 | VERIFIED | msg/15: Messages, Docs, Files, Images & Videos, Links |
| 4 | 01-messenger.md:23 | VERIFIED | msg/39: External Contacts, New Contacts, Starred Contacts, My Groups, Help Desk |
| 5 | 01-messenger.md:42 | VERIFIED | msg/10, msg/19, msg/20, msg/37 header icon sets |
| 6 | 01-messenger.md:81 | UNVERIFIED | draft/flag indicators on feed row (badges verified msg/10) |
| 7 | 01-messenger.md:83 | VERIFIED | msg/08, msg/09 exact order |
| 8 | 01-messenger.md:91 | VERIFIED | msg/08 Done item |
| 9 | 01-messenger.md:93 | UNVERIFIED | open-at-first-unread setting |
| 10 | 01-messenger.md:96 | VERIFIED | msg/03b filter list |
| 11 | 01-messenger.md:113 | UNVERIFIED | label auto-rule condition vocabulary |
| 12 | 01-messenger.md:126 | UNVERIFIED | consecutive-message grouping (cards each show avatar, msg/10) |
| 13 | 01-messenger.md:156 | VERIFIED | msg/14: no Tasks tab; View Tasks side panel |
| 14 | 01-messenger.md:158 | VERIFIED | msg/15 categories (OCR not tested) |
| 15 | 01-messenger.md:171 | UNVERIFIED | "Create group with this person" |
| 16 | 01-messenger.md:215 | VERIFIED | msg/16, msg/17: Reaction, Reply, More |
| 17 | 01-messenger.md:224 | UNVERIFIED | multiselect forward one-by-one/combined |
| 18 | 01-messenger.md:227 | VERIFIED | msg/18 Clip to Top; msg/37 pinned bar |
| 19 | 01-messenger.md:255 | UNVERIFIED | doc-link card permission prompt |
| 20 | 01-messenger.md:261 | VERIFIED | msg/29, msg/32 @ button |
| 21 | 01-messenger.md:294 | UNVERIFIED | in-chat doc preview permission adjustment |
| 22 | 01-messenger.md:301 | UNVERIFIED | custom bot security options |
| 23 | 01-messenger.md:304 | UNVERIFIED | full system assistant list (seen: Billing/Admin/Open Platform/Approval) |
| 24 | 01-messenger.md:319 | UNVERIFIED | Flagged/Unread empty texts (Labels/Tasks/Search empties verified) |
| 25 | 01-messenger.md:323 | UNVERIFIED | sending/failed message visuals |
| 26 | 01-messenger.md:328 | VERIFIED | msg/10 selected #E3EDFC, filter #DFEAFA |
| 27 | 01-messenger.md:329 | UNVERIFIED | history loading indicator |
| 28 | 01-messenger.md:330 | UNVERIFIED | offline state |
| 29 | 02-docs.md:11 | VERIFIED | docs/01 sidebar incl. trash footer |
| 30 | 02-docs.md:50 | VERIFIED | wiki/03 TOC + and list icon (function unverified) |
| 31 | 02-docs.md:52 | UNVERIFIED | Wiki footer share icon tooltip |
| 32 | 02-docs.md:52 | UNVERIFIED | Wiki footer graph icon tooltip |
| 33 | 02-docs.md:56 | UNVERIFIED | mind-map structure icon |
| 34 | 02-docs.md:57 | UNVERIFIED | desktop compass icon |
| 35 | 02-docs.md:94 | VERIFIED | docs/77, docs/99 Word/PDF/Markdown |
| 36 | 02-docs.md:114 | VERIFIED | docs/79 web More: Add Applications, Show Paragraph Authors, Report |
| 37 | 02-docs.md:145 | UNVERIFIED | mind-map node ··· actions |
| 38 | 02-docs.md:153 | UNVERIFIED | graph node type badge |
| 39 | 02-docs.md:155 | UNVERIFIED | graph pan/zoom |
| 40 | 02-docs.md:155 | UNVERIFIED | graph search behaviour |
| 41 | 02-docs.md:160 | UNVERIFIED | new-doc placeholders |
| 42 | 02-docs.md:164 | UNVERIFIED | presence avatars/cursors |
| 43 | 02-docs.md:165 | UNVERIFIED | docs offline |
| 44 | 02-docs.md:166 | UNVERIFIED | docs loading/error |
| 45 | 03-base.md:9 | UNVERIFIED | Base + New menu |
| 46 | 03-base.md:42 | UNVERIFIED | Rating scale |
| 47 | 03-base.md:47 | UNVERIFIED | Signature field type id (field exists, docs/47) |
| 48 | 03-base.md:55 | VERIFIED | docs/40 per-column stats "Calculating", record count |
| 49 | 03-base.md:57 | VERIFIED | docs/56 Day/Week/Month |
| 50 | 03-base.md:59 | UNVERIFIED | Gantt dependencies (timeframes verified docs/55) |
| 51 | 03-base.md:64 | UNVERIFIED | filter operator vocabulary (panel verified docs/42) |
| 52 | 03-base.md:75 | UNVERIFIED | Send email / Create task actions (other actions verified docs/50) |
| 53 | 03-base.md:100 | UNVERIFIED | empty table defaults |
| 54 | 03-base.md:101 | UNVERIFIED | empty filter result |
| 55 | 03-base.md:105 | UNVERIFIED | loading skeleton |
| 56 | 04-meetings.md:9 | VERIFIED | cmt/15: web has Start a meeting / Join a meeting only |
| 57 | 04-meetings.md:11 | UNVERIFIED | in-call top bar (not reachable) |
| 58 | 04-meetings.md:15 | UNVERIFIED | breakout assignment (not reachable) |
| 59 | 04-meetings.md:23 | UNVERIFIED | in-call toolbar order (not reachable) |
| 60 | 04-meetings.md:39 | UNVERIFIED | lobby/reconnecting (not reachable) |
| 61 | 05-calendar.md:9 | VERIFIED | cmt/01–03 Day/Week/Month only |
| 62 | 05-calendar.md:10 | VERIFIED | cmt/01 mini month |
| 63 | 05-calendar.md:12 | VERIFIED | cmt/08 Default visibility + Busy |
| 64 | 05-calendar.md:13 | UNVERIFIED | event popover actions (no events) |
| 65 | 05-calendar.md:19 | VERIFIED | cmt/06 device/additional time zone |
| 66 | 05-calendar.md:32 | UNVERIFIED | conflicts |
| 67 | 05-calendar.md:34 | VERIFIED | cmt/01 red now-line |
| 68 | 05-calendar.md:35 | UNVERIFIED | calendar loading |
| 69 | 06-tasks.md:29 | UNVERIFIED | Tasks ··· menu |
| 70 | 06-tasks.md:33 | UNVERIFIED | Task List + menu |
| 71 | 06-tasks.md:37 | VERIFIED | cmt/18 New Task Ctrl+N, New Task List Ctrl+L |
| 72 | 06-tasks.md:64 | UNVERIFIED | task list overview/archive |
| 73 | 06-tasks.md:71 | VERIFIED | cmt/18 Ctrl+N / Ctrl+L |
| 74 | 06-tasks.md:74 | VERIFIED | cmt/31 Subscribed empty |
| 75 | 06-tasks.md:75 | UNVERIFIED | overdue colour |
| 76 | 06-tasks.md:76 | UNVERIFIED | completion animation |
| 77 | 06-tasks.md:78 | UNVERIFIED | archived banner |
| 78 | 07-forms.md:9 | UNVERIFIED | Lark Forms app home |
| 79 | 07-forms.md:13 | UNVERIFIED | per-day submission limit |
| 80 | 07-forms.md:13 | VERIFIED | docs/57 form expiration link |
| 81 | 07-forms.md:13 | UNVERIFIED | after-submit message |
| 82 | 07-forms.md:18 | UNVERIFIED | option display style |
| 83 | 07-forms.md:18 | UNVERIFIED | Location input modes |
| 84 | 08-okr.md:39 | UNVERIFIED | OKR first icon function |
| 85 | 08-okr.md:39 | UNVERIFIED | OKR ··· menu |
| 86 | 08-okr.md:55 | UNVERIFIED | KR weight validation |
| 87 | 08-okr.md:63 | UNVERIFIED | KR progress statuses |
| 88 | 08-okr.md:68 | UNVERIFIED | review docs |
| 89 | 09-workplace-email-contacts.md:8 | UNVERIFIED | Workplace favourites edit |
| 90 | 09-workplace-email-contacts.md:10 | UNVERIFIED | app open mode |
| 91 | 09-workplace-email-contacts.md:26 | UNVERIFIED | Mail folders (no mailbox) |
| 92 | 09-workplace-email-contacts.md:26 | UNVERIFIED | Mail search/filters (no mailbox) |
| 93 | 09-workplace-email-contacts.md:28 | UNVERIFIED | Mail ··· (no mailbox) |
| 94 | 09-workplace-email-contacts.md:73 | UNVERIFIED | org member counts |
| 95 | 09-workplace-email-contacts.md:73 | VERIFIED | msg/39 sections |
| 96 | 09-workplace-email-contacts.md:74 | UNVERIFIED | profile card actions |
| 97 | 14-plan.md:35 | meta | meta |

**Additional [UNVERIFIED] items raised by this UI-SPEC** (not phase-1 markers):
- Motion durations (§2.5)
- Muted/draft row visuals (§4.2)
- Tooltips of the ⊞+ and 💼+ header icons (§4.3)
- Group invite-menu placement (§4.3)
- Tab context menu (§4.6)
- Own-message bubble colour (§4.7)
- Docs sidebar footer tooltips (§5.1)
- Selection-toolbar last 3 icons (§5.2)
- Comments / doc-details / slash palette (§5.2)
- Docs Upload menu order (§5.1)
- Filter-manager dialog (§4.1)
- Search result layout / no-results (§3.3)


---

# Part C: Operately UI detail (OPERATELY-SPEC §2–§7 and §13, verbatim)

> **Precedence:** Part A overrides this part. In particular:
> - Operately's top navigation, warm background and quick search are replaced by the Rox shell (Part A §3).
> - "Timeline" is renamed "Gantt" (ADR-U10).
> - `[ROX]` notes below are superseded by Part A and the PRD decisions wherever they differ: for example, the Review page lives inside Inbox (ADR-U12), and Lark REST mirrors are defined in TECH-SPEC.
> - Licence: Apache-2.0 (Operately). `app/ee` is never copied.
> - Section references like `OPERATELY-SPEC §12` refer to `reference/operately/OPERATELY-SPEC.md` in the zip.

### C.2. Global shell and navigation

`[src: turboui/src/CompanyNavigation/*, app/assets/js/layouts/CompanyLayout/*]`

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ [logo] Acme ▾ │ Home  Company  My work  Review (3) │      🔍 Search   ＋New ▾   ?   🔔•  (MA) ▾ │
└────────────────────────────────────────────────────────────────────────────────────────────┘
 Company ▾ = People · Org Chart · Company Admin · Switch Company
 ＋New ▾   = New goal · New project · New space · Invite people
 ? ▾       = Keyboard shortcuts · Contact us · Discord · What's new · Roadmap
 (avatar)▾ = Profile · Settings · Password & Security · API Tokens · MCP Connections · Sign Out
```

**Nav items:**

| Item | Destination |
|---|---|
| **Home** | `/:companyId` |
| **Company** | Company work map, `/:companyId/work-map` |
| **My work** | Own profile, Tasks/Assigned tab |
| **Review** | `/:companyId/review`, with a badge for the outstanding count |
| **Bell** | `/:companyId/notifications`, with an unread dot |

**Global search** opens a quick-search overlay. Placeholder: "Search for spaces, projects, goals, milestones, tasks, or people...". Results are grouped under the headings SPACES · PROJECTS · GOALS · MILESTONES · TASKS · PEOPLE · DISCUSSIONS · DOCUMENTS · FILES · FOLDERS · LINKS. The footer link reads "Search all content for "%{query}"" and goes to `/search?q=`.

**Page container.** Pages render as a white card `bg-surface-base` on a warm background (`surface-bg`), with rounded corners and a border, max width ~1280 (`max-w-6xl`). Each page has a breadcrumb line at its top-left, for example "Product Development › Goals".

**[ROX]**
- Operately's top nav becomes Rox **left-rail entries** under a "Goals & Projects" app icon: Home/feed, Work Map, Review, My work.
- Global search merges into Rox Ctrl+K (TECH-SPEC §9) as new category chips: Goals, Projects, Milestones, Check-ins, Discussions.
- The bell merges into the Rox notification centre and assistant bot (§10).

#### C.2.1 Design tokens (light theme)

`[src: turboui/styles/global.css, turboui/tailwind.config.js]`

| Token | Value | Token | Value |
|---|---|---|---|
| surface-bg | rgba(254,245,237,1) (warm cream) | content-base | rgba(0,0,0,.95) |
| surface-base | #fff | content-dimmed | rgba(0,0,0,.6) |
| surface-dimmed | rgba(249,249,249,1) | content-subtle | ~rgba(0,0,0,.4) |
| surface-outline | rgba(211,204,189,1) | stroke-base | rgba(0,0,0,.1) |
| brand-1 | #3185FF | brand-2 | #E3F2FF |
| accent-1 | rgb(37,155,105) | success | #059669 |
| link | blue-700 | Font | Inter, 16px base |

A dark theme is defined (`dark-1..8`), and `AccountAppearancePage` offers System/Light/Dark.

**Components:**

| Component | Style |
|---|---|
| **PrimaryButton** | `bg-brand-1 text-white`, hover `bg-blue-600` |
| **SecondaryButton** | Outline brand-1, inverts on hover |
| **GhostButton** | `border-surface-outline bg-surface-base text-content-dimmed`, hover `bg-surface-accent` |
| **DangerButton** | `bg-red-500` |
| Button sizes | xxs `px-2 py-0.5 text-xs`, xs `px-2.5 py-1 text-sm`, sm `px-3 py-1.5 text-sm`, base `px-4 py-2`, lg `px-5 py-2.5`. All `rounded-md font-semibold transition-all duration-100`. |
| **Tabs** `[src: turboui/src/Tabs]` | 14px Tabler icon + label + count chip (`bg-stone-100 text-xs rounded-lg px-1.5`). Active tab: 1.5px `bg-blue-500` underline that animates `scale-x 0→100` in 200ms ease-in-out. Inactive: `text-content-dimmed hover:text-content-base hover:bg-surface-dimmed rounded-lg`. |
| **SidebarSection** | Title `text-sm font-semibold` (xs on mobile), content `space-y-2` |
| **PageSection** | `mt-10` |
| **ActionList** (sidebar "Actions") | 16px icon + `text-sm`; hover `bg-surface-dimmed`. Danger items `text-red-600 hover:bg-red-50`. |
| **Section header pattern** [SHOT] | Bold 18px title on the left, then an xxs ghost button ("Edit", "Add", "Add milestone", "Add resource") next to the title |
| **Avatars** | Round. 24px in lists, 32px in sidebar person fields, with name in bold and title in dimmed small text on the line below |

---

### C.3. Statuses and colours (canonical)

`[src: turboui/src/StatusBadge/index.tsx, turboui/src/SmallStatusIndicator, app/lib/operately/goals/goal.ex, app/lib/operately/projects/project.ex]`

#### C.3.1 StatusBadge

The badge is a rounded-full chip: `px-2.5 py-0.5 text-xs font-medium border shadow-sm`, with an optional leading icon.

| Status key | Label | bg | text | border | Icon | Used for |
|---|---|---|---|---|---|---|
| `on_track` | On track | emerald-50 | emerald-600 | emerald-200 | ● filled dot | goal, project, check-in |
| `caution` | Caution | amber-50 | amber-800 | amber-200 | ● | goal, project, check-in |
| `off_track` | Off track | red-50 | red-700 | red-200 | ● | goal, project, check-in |
| `pending` | Pending | blue-50 | blue-700 | blue-200 | ● | not started / no check-in yet |
| `outdated` | Outdated | gray-100 | gray-700 | gray-200 | ● | next check-in is >3 days overdue |
| `paused` | Paused | gray-100 | gray-700 | gray-200 | ⏸ | project paused |
| `achieved` / `completed` | Achieved / Completed | emerald-50 | emerald-600 | emerald-200 | ✓ | closed successfully |
| `missed` | Missed | red-50 | red-700 | red-200 | ✕ | closed unsuccessfully |

**Status descriptions** (shown in the status picker and check-in form; `%{reviewer}` is the reviewer's first name):

| Status | Description |
|---|---|
| On track | "Progressing as planned. No blockers." |
| Caution | "Emerging risks or delays. %{reviewer} should be aware." |
| Off track | "Significant problems affecting success. %{reviewer}'s help is needed." |
| Pending | "Work hasn't started yet." |

#### C.3.2 Derived status

```
goal_status(g)    = g.success_status (achieved|missed) if g.closed_at
                  else 'outdated' if g.next_update_scheduled_at + 3d < now
                  else g.last_update_status (on_track|caution|off_track)
                  else 'pending'
project_status(p) = p.success_status if p.closed_at
                  else 'paused' if p.status = 'paused'
                  else 'outdated' if p.next_check_in_scheduled_at + 3d < now
                  else p.last_check_in_status else 'pending'
```

**Cadence and progress:**
- **Cadence:** goal check-ins are **monthly**, due on the 1st of next month. Project check-ins are **weekly**, due on the first Friday. Oban jobs send reminders and mark items outdated.
- **Editing lock:** a published check-in can be edited for 3 days; after that it is read-only.
- **Goal progress %:** the mean over targets of `clamp((value-from)/(to-from))`, combined with checklist completion. If there are no targets and no checks, progress is 0.
- **Project progress %:** done milestones ÷ all milestones.
- **"Next step":** for a goal, the first incomplete target, else the first unchecked check. For a project, the title of the next pending milestone by due date.

#### C.3.3 Task statuses

These are customizable per project and per space. `[src: app/lib/operately/tasks/status.ex, turboui/src/StatusCustomization]`

| value | label | color | closed | hint text |
|---|---|---|---|---|
| `pending` | Not started | gray | false | "Use for backlog or paused work" |
| `in_progress` | In progress | blue | false | "Active work underway" |
| `done` | Done | green | true | "Completed or approved" |
| `canceled` | Canceled | red | true | "Blocked or intentionally stopped" |

The colour palette is `gray|blue|green|red`. Each status has an icon variant: circle, half-circle, check-circle or x-circle.

#### C.3.4 Other enums

| Enum | Values |
|---|---|
| Milestone `status` | `pending` (Active) \| `done` (Completed) |
| Milestone `phase` (legacy) | concept \| planning \| execution \| control |
| Contributor role | `champion` \| `reviewer` \| `contributor` |
| Check-in and post state | `draft` \| `scheduled` \| `published` |
| Contextual date type | `day` \| `month` \| `quarter` \| `year`. Shown as "Mar 5", "March 2026", "Q2 2026", "2026". |
| Task reminder | `before_due` (N days) \| `due_day` \| `overdue` \| `on_date` |
| Reactions | emoji (free) + legacy `thumbs_up` \| `thumbs_down` \| `heart` \| `rocket` |
| Person type | `human` \| `guest` |
| KPI cadence | `weekly` \| `monthly` |
| Link type | airtable, dropbox, figma, google, google_doc, google_sheet, google_slides, notion, other |

---

### C.4. Screen inventory

The full route table, with all 126 routes (URL, page component, TurboUI view, area and Rox priority), is in **Appendix A** (`gen/routes.md`). Every route sits under `/:companyId/`. A company id is a short id, and resource ids are `<slug>-<shortId>`.

**Priority key:**
- **P0** = wave 1 core: goals, projects, work map, tasks, check-ins.
- **P1** = wave 2: spaces, discussions, docs & files, review, KPIs, feed.
- **P2** = wave 3: templates, admin, exports.
- **skip** = covered by Rox (auth, billing, account).

| # | Screen (page component) | URL | P | Spec § |
|---|---|---|---|---|
| S01 | Home (`HomePage`) | `/` | P1 | 5.1 |
| S02 | Company Work Map (`CompanyWorkMapPage`) | `/work-map?tab=&view=` | P0 | 5.2 |
| S03 | Space Work Map (`SpaceWorkMapPage`) | `/spaces/:id/work-map` | P0 | 5.2 |
| S04 | Profile Work Map tabs (`ProfilePage`) | `/people/:id?tab=` | P0 | 5.2 / 5.12 |
| S05 | Add goal / project modal (`WorkMap AddItemModal`, `GoalAddPage`) | `/goals/new?parentGoalId=`, `/spaces/:id/goals/new` | P0 | 5.3 |
| S06 | Goal page, Overview tab (`GoalPage`) | `/goals/:id` | P0 | 5.4 |
| S07 | Goal page, Check-Ins tab | `/goals/:id?tab=check-ins` | P0 | 5.4.3 |
| S08 | Goal page, Discussions tab | `/goals/:id?tab=discussions` | P0 | 5.4.3 |
| S09 | Goal page, Docs & Files tab | `/goals/:id?tab=docs-and-files` | P1 | 5.4.3 |
| S10 | Goal page, Activity tab | `/goals/:id?tab=activity` | P0 | 5.4.3 |
| S11 | Goal check-in new / edit (`GoalCheckInNewPage`, `GoalCheckInEditPage`) | `/goals/:goalId/check-ins/new` | P0 | 5.5 |
| S12 | Goal check-in view (`GoalCheckInPage`) | `/goal-check-ins/:id` | P0 | 5.5.2 |
| S13 | Close goal (`GoalClosingPage`) | `/goals/:goalId/complete` | P0 | 5.6 |
| S14 | Reopen goal (`GoalReopenPage`) | `/goals/:goalId/reopen` | P0 | 5.6 |
| S15 | Goal activity / retrospective view (`GoalActivityPage`) | `/goal-activities/:id` | P0 | 5.6 |
| S16 | Goal discussion new / edit / view | `/goals/:goalId/discussions/new`, `/goal-activities/:id/edit` | P0 | 5.10 |
| S17 | Goal access mgmt / add / edit levels | `/goals/:goalId/access(/add)`, `/goals/:goalId/edit/permissions` | P1 | 5.15 |
| S18 | New project (`ProjectAddPage`) | `/projects/new?goalId=`, `/spaces/:id/projects/new` | P0 | 5.3 |
| S19 | Project page, Overview (`ProjectPage`) | `/projects/:id` | P0 | 5.7 |
| S20 | Project page, Tasks (list / board) | `/projects/:id?tab=tasks&milestone=&taskDisplay=board` | P0 | 5.8 |
| S21 | Project page, Check-ins | `?tab=check-ins` | P0 | 5.7.3 |
| S22 | Project page, Discussions | `?tab=discussions` | P0 | 5.10 |
| S23 | Project page, Docs & Files | `?tab=docs-and-files` | P1 | 5.11 |
| S24 | Project page, Activity | `?tab=activity` | P0 | 5.13 |
| S25 | Project check-in new / edit / view | `/projects/:id/check-ins/new`, `/project-check-ins/:id(/edit)` | P0 | 5.5 |
| S26 | Pause / Resume project | `/projects/:id/pause`, `/projects/:id/resume` | P0 | 5.7.4 |
| S27 | Close project / retrospective view / edit | `/projects/:id/close`, `/projects/:id/retrospective(/edit)` | P0 | 5.7.4 |
| S28 | Project discussion new / view / edit | `/projects/:id/discussions/new`, `/project-discussions/:id(/edit)` | P0 | 5.10 |
| S29 | Milestone page (`MilestonePage`) | `/milestones/:id` | P0 | 5.8.4 |
| S30 | Task page (`TaskPage`) | `/tasks/:id` | P0 | 5.8.5 |
| S31 | Review (`ReviewPage`) | `/review` | P1 | 5.9 |
| S32 | Notifications (`NotificationsPage`) | `/notifications` | P1 | 5.13 |
| S33 | Space page (`SpacePage`) | `/spaces/:id` | P1 | 5.14 |
| S34 | New space / edit space / tools config | `/spaces/new`, `/spaces/:id/edit`, `/spaces/:id/tools-config` | P1 | 5.14 |
| S35 | Space access / add members / general access | `/spaces/:id/access`, `/spaces/:id/add-members`, `/spaces/:id/edit/general-access` | P1 | 5.15 |
| S36 | Space discussions list / new / drafts | `/spaces/:id/discussions(/new,/drafts)` | P1 | 5.10 |
| S37 | Space discussion view / edit | `/discussions/:id(/edit)` | P1 | 5.10 |
| S38 | Space Kanban (space tasks) | `/spaces/:id/kanban` | P0 | 5.8.6 |
| S39 | Space KPIs list / detail | `/spaces/:id/kpis(/:kpiId)` | P1 | 5.16 |
| S40 | Resource hub, folder, drafts | `/resource-hubs/:id`, `/folders/:id`, `/resource-hubs/:id/drafts` | P1 | 5.11 |
| S41 | Document view / edit / new / versions / compare / public | `/documents/:id(/edit,/versions,/versions/:n)`, `/public/documents/:id` | P1 | 5.11 |
| S42 | File view / edit, Link view / edit / new | `/files/:id(/edit)`, `/links/:id(/edit)`, `/resource-hubs/:id/new-link` | P1 | 5.11 |
| S43 | Project templates list / template page / template sub-pages | `/project-templates(/:id/...)`, `/spaces/:id/project-templates` | P2 | 5.17 |
| S44 | Global search page (`SearchPage`) | `/search?q=` | P1 | 5.18 |
| S45 | People directory / Org chart | `/people`, `/people/org-chart` | P1 | 5.12 |
| S46 | Profile / edit profile | `/people/:id`, `/people/:id/profile/edit` | P1 | 5.12 |
| S47 | Account: settings, notifications, appearance, security, API tokens, MCP | `/account/*` | skip / P2 | 5.19 |
| S48 | Company admin (manage people, admins, trusted domains, permissions, rename, export / import, billing) | `/admin/*` | skip | 5.19 |
| S49 | Markdown export | `/exports/markdown/{goals\|projects}/:id` | P2 | 5.20 |
| S50 | Auth / onboarding / invite (login, sign-up, join, setup wizard, invite links) | `/log_in`, `/sign_up`, `/join`, `/setup` | skip | — |

This gives **50 screen families** (126 routes). Rox must rebuild S01–S46 and S49, which are **47 screen families**. S47, S48 and S50 merge into Rox's existing account, admin and auth.

---

### C.5. Per-screen UI spec

#### C.5.1 Home (S01)

`[src: turboui/src/HomePage, app/assets/js/pages/HomePage]`

```
┌───────────────────────────────────────────────────────────────────────────┐
│                     Good morning, Mark!                                   │  greeting by local time: morning/afternoon/evening
│ Your Operately Spaces                       [Invite People] [Add Space]   │
│ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐               │  space cards (grid 4 cols, wrap)
│ │ ◼ Product  │ │ ◼ Marketing│ │ ◼ General  │ │ ◼ Sales    │               │  card = icon/colour, name, mission (2 lines),
│ │ mission…   │ │ mission…   │ │            │ │            │               │  member avatars (stack, max 6)
│ │ (a)(b)(c)+3│ │ (d)(e)     │ │ (all)      │ │            │               │
│ └────────────┘ └────────────┘ └────────────┘ └────────────┘               │
│ What's new?                                                               │
│  (avatar) Frank Miller posted a check-in in Mobile App Redesign  · 2h     │  company feed (§5.13), infinite scroll
│           "On track — finished usability round…"                         │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Empty state:** "No spaces yet" / "Spaces will appear here when someone grants you access to them."
- **Feed empty state:** "All quiet for now" / "Activity from your spaces, goals, and projects will appear here."
- **[ROX]** This page becomes the Goals & Projects app landing page. The feed reuses the `domain_event` feed renderer.

#### C.5.2 Work Map (S02–S04)

`[src: turboui/src/WorkMap/** (WorkMapPage, WorkMapTable, WorkMapTabs, TableRow, Timeline, AddItemModal), app/assets/js/pages/CompanyWorkMapPage, SpaceWorkMapPage]`

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ Home › Work Map                                                                           │
│ Company work map                                      [Table|Timeline]  [+ Add ▾]         │
│ All work 24 │ Goals 9 │ Projects 15 │ Completed 6 │ Paused 2                              │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ NAME                              STATUS     PROGRESS   DUE DATE  SPACE    CHAMPION  NEXT STEP │
│ ▾ ◎ Accelerate product growth     [On track] ▓▓▓░ 62%   Q4 2026   Product  (P)Paul   Increase MAU │
│   ▾ ◎ Launch AI Platform          [On track] ▓▓░░ 40%   Dec 2026  Product  (P)Paul   …        │
│       ▢ Mobile App Redesign       [Caution]  ▓░░░ 33%   Sep 30    Product  (F)Frank  Beta Release│
│       ▢ ~~Old prototype~~         [Completed]100%       Done Aug 2 …                       │
│ + Add goal / project (hover row action "+" adds child)                                     │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Behaviour:**
- **Row:** chevron that expands the hierarchy. Goals nest under parent goals, and projects nest under their goal.
- **Type icons:** ◎ goal (red-50 icon tile), ▢ project (blue-50 tile).
- **Name:** a link. Closed items are struck through and dimmed.
- **Status:** StatusBadge (§3).
- **Progress:** a 100px bar plus %. The tooltip shows "%{completed}/%{total} completed (%{percentage}%)" with Targets / Checklist / Milestones breakdowns.

**Columns** (some are hidden per tab):

| Column | Notes |
|---|---|
| Name | |
| Status | |
| Progress | |
| Due Date | Becomes "Completed On" in the Completed tab |
| Assigned On | Hidden by default |
| Space | |
| Project | |
| Champion | |
| Role | Profile only: Champion / Reviewer / Contributor |
| Next step | Tooltip: "Shows what needs to happen next for this work to progress." / "For goals: The first target or checklist item that hasn't been completed yet" / "For projects: The upcoming milestone (by due date)" |

**Tabs and URL** (`?tab=all|goals|projects|completed|paused`):
- All work hides closed items.
- The Completed tab shows closed items with success status.
- The Paused tab shows paused projects.

**View toggle** (`view=timeline`): **Timeline**, a Gantt-like month grid.
- Header with month groups, plus a vertical red "Today · %{date}" marker.
- Bars run from start to due date, coloured by status.
- Footer: "%{count} hidden without dates".
- Empty: "Nothing in this view has dates yet."

**+ Add** opens AddItemModal (§5.3).

**Empty states:**
- "No work to show." / "Start by adding a goal or project"
- "No goals to show." / "No projects to show." / "No completed work to show." / "No paused work to show."
- Profile: "Assigned goals and projects will appear here."

**Profile variant** (S04) tabs: **Tasks | Assigned | Reviewing | Paused | Completed | Activity | About**. The Assigned tab shows the Role column.

**[ROX]**
- Implement the view as a hierarchical TanStack Table over `goal` + `project`, with a timeline view sharing the Gantt component (frappe-gantt) planned for Tasks and Base.
- The same component also renders the Lark OKR "Alignment" tree, so there is one component and not two.

#### C.5.3 Add Goal / Add Project (S05, S18)

`[src: turboui/src/WorkMap/components/AddItemModal.tsx, turboui/src/GoalAddForm, app/assets/js/pages/ProjectAddPage, turboui/src/ProjectTemplateSelection]`

```
┌ Add new item ──────────────────────────────── ✕ ┐
│ ( ◎ Goal  big-picture outcome )                 │  segmented choice, 2 large cards
│ ( ▢ Project  concrete actions or deliverables ) │
│ Name  [ e.g. Increase user acquisition      ]   │  placeholder differs per type
│ Space [ Product ▾ ]                             │  "Please select a space"
│ Template [ None ▾ ] (project only, if templates enabled)
│ Start date [ Set date ] (project, from template)│
│ Privacy  [ Everyone in the company can view ▾ ] │  PrivacyField (§7)
│ "Adding under <goal>Launch AI Platform</goal>"  │  when started from a parent row
│ ☐ Create more              [Cancel] [Add Goal]  │
└─────────────────────────────────────────────────┘
```

**Hints:**
- Goal: "Long-term outcomes you're working toward. Track overall progress and impact."
- Project: "Concrete steps and tasks with specific deliverables. Get things done."
- "Not sure? Start with a project - you can always set goals later."
- "Tracking an outcome instead? <goal>Add a goal</goal>."

**Full-page "New Project"** (`ProjectAddPage`):
- Title "Start a new project" or "Start a new project in %{name}".
- Fields:
  - Project Name ("e.g. HR System Update");
  - Space (required);
  - Champion (defaults to me);
  - Reviewer ("No reviewer"; validation "Can't be the same as the champion");
  - Goal (parent);
  - Privacy.
- Button: "Add Project".

**Full-page "Add a new goal" / "Add a subgoal"** (`GoalAddPage`): fields "What do you want to achieve?" (name), Space, Privacy. Button: "Add Goal".

**API:** `goals.create(space_id, name, champion_id, reviewer_id, timeframe, targets[], description, parent_goal_id, anonymous_access_level, company_access_level, space_access_level)`, and `projects.create(space_id, name, champion_id?, reviewer_id?, goal_id?, description?, anonymous/company/space_access_level)`. A project created from a template goes through `project_templates.create_project` instead, which takes the template id, a start date, the space and a name (§5.17).

#### C.5.4 Goal page (S06–S10)

`[src: turboui/src/GoalPage/{index,Overview,PageHeader,Targets,Checklist→turboui/src/Checklist,RelatedWork,Sidebar,CheckIns,Discussions,Contributors,DeleteModal,DocsAndFiles}.tsx, app/assets/js/pages/GoalPage/*]`. Wireframe follows the **[SHOT 01]** screenshot.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ Product Development › Goals                                                                 │ breadcrumb (or "Work Map")
│ ┌──┐                                                                                        │
│ │◎ │ Launch AI Platform   [● On track]   (🔒 Invite-Only, only if restricted)                 │ 38px red-50 tile, title 2xl bold
│ └──┘                                                                                        │ title is inline-editable (click)
│ ⊙ Overview │ ✓ Check-Ins 3 │ 💬 Discussions 6 │ 📁 Docs & Files 2 │ ⚡ Activity                   │ tabs
├───────────────────────────────────────────────────────────┬─────────────────────────────────┤
│ (closed) StatusBanner: "This goal was closed on <date>."  │ ▌Last Check-In                  │ green left border = status colour
│ (outdated) ⚠ "The last check-in was more than a month    │ ▌Apr 17                          │ date of last check-in
│   ago. Please check-in or close the goal."                │ ▌"Strong progress on infra; MAU…"│ 2-line excerpt (link to check-in)
│                                                           │ ▌(K) Karen   [● On track]        │ author avatar + status chip
│ Goal Description  [Edit]                                  │  [Check in]  (champion only)     │ PrimaryButton xs
│ Lorem ipsum rich text … (max ~6 lines) … Expand ⌄         │ Parent Goal                     │
│                                                           │  ◎ Accelerate product growth    │ link / "Set parent goal"
│ Targets  [Add]                                            │ Start Date                      │
│ NAME                               CURRENT VALUE          │  📅 Set date                     │ DateField (contextual)
│ ◔ Increase Monthly Active Users    25000 users  [Update ▾]│ Due Date                        │
│ ◑ Improve Response Time            250 ms                 │  📅 Set date                     │ overdue → red "Overdue by 3 days."
│ ◕ Achieve System Uptime            99.8%                  │ Champion                        │
│                                                           │  (P) Paul Young  ⓘ               │ tooltip = role description
│ Checklist  ◔ 2/5 completed (40%)  [Add]                   │      Director of Business Dev.  │ title dimmed
│ ☑ ~~Hire ML lead~~                                        │ Reviewer                        │
│ ☑ ~~Choose model vendor~~                                 │  (R) Rachel King  ⓘ              │
│ ☐ Ship private beta                                       │      Director of Marketing      │
│ ☐ …                                                       │ Privacy                         │
│                                                           │  🌐 Everyone in the company can view│ + "Manage access" (admins)
│ Subgoals & Projects   [Add goal] [Add project]            │ ─────────────────────────────── │
│ ▾ ◎ Improve model quality          (A)  [● On track]      │  ✓ Close Goal                   │ ActionList
│     ▢ Eval harness                 (B)  [● Caution]       │  ⇄ Move to another space        │
│   ▢ ~~Vendor RFP~~                 (C)  [✓ Completed]     │  ⬇ Export as Markdown (code)    │
│                                                           │  🗑 Delete                       │ red
│ Docs & Files (preview, top 5 + "Show N more")             │                                 │
│ Contributors  ⓘ "Who is listed as a contributor?"         │                                 │
│  (a)(b)(c)(d) … avatars with role tooltip                 │                                 │
└───────────────────────────────────────────────────────────┴─────────────────────────────────┘
 Grid: main col-span-8, sidebar col-span-4 (stacks on mobile; sidebar first on mobile = no, below)
```

##### C.5.4.1 Overview: section behaviour (in order)

1. **Banner.** If closed: "This goal was closed on <date/>." plus a link to the retrospective. If outdated: an amber callout, with copy depending on role:
   - champion: "The last check-in was more than a month ago. Please check-in or close the goal."
   - others: "…The information may be outdated. Please ping the champion check-in or close the goal."
2. **Goal description.**
   - Header "Goal description" ([SHOT]: "Goal Description") with an [Edit] button.
   - Read mode collapses at about 6 lines, with "Expand"/"Collapse".
   - Edit mode is an inline RichEditor with [Save]/[Cancel].
   - Empty (editor): "Describe the goal to provide context and clarity." Placeholder: "Describe the goal...".
   - API: `goals.update_description`.
3. **Targets.** `[src: turboui/src/GoalTargetList]`
   - Two-column table: NAME / CURRENT VALUE. Each row has a progress pie icon (16px, emerald fill = %).
   - Hover row actions: "Update" (opens a popover: "Update %{name}", field "New Value", [Save]), "Edit", "Delete" (confirm: "Delete %{name} target?" / "This will remove your target and all associated progress tracking." / [Yes, Delete]).
   - A row expands to show "From <from> to <to>%{unit}" or "From X down to Y" for decreasing targets.
   - Add form fields: Name ("e.g. Increase monthly signup count"), Start ("e.g. 10000"), Target ("e.g. 15000"), Unit ("e.g. users"). Validation: "Must be a number" / "Can't be empty". Checkbox "Create more". Button [Add Target].
   - Drag to reorder (`index`).
   - Empty: "Add targets to track quantitative progress with numbers." Non-editor: "The champion hasn't yet set targets for this goal."
   - API: `goals.create_target`, `update_target`, `update_target_value`, `update_target_index`, `delete_target`.
4. **Checklist.** `[src: turboui/src/Checklist]`
   - Header: pie + "%{completed}/%{total} completed (%{percentage}%)" + [Add].
   - Rows: checkbox + name. Checked items are struck through and dimmed. Hover: Edit / Delete. Drag to reorder.
   - Add: input "e.g. Sign the contract", "Create more", [Add Check].
   - Empty: "Create a checklist to track qualitative progress or binary outcomes." Read-only: "This goal doesn't have a checklist."
   - API: `goals.create_check`, `update_check`, `toggle_check`, `update_check_index`, `delete_check`.
5. **Subgoals & Projects.** `[src: turboui/src/GoalPage/RelatedWork.tsx + MiniWorkMap]`
   - Header buttons [Add goal] [Add project]. Both open AddItemModal preset to "Adding under <goal>…".
   - Rows: a tree with indent 24px per level, type icon, name link, champion avatar (20px), status chip. Closed items are struck through.
   - Empty: "Break down the work on this goal into subgoals and projects."
6. **Docs & Files preview.** Up to 5 nodes, then "Show %{n} more" and [Add] ("Add files, docs, or links"). Empty: "No support materials yet." Hidden if the resource hub is disabled.
7. **Contributors.** An avatar list of people working on subgoals and projects. The tooltip answers "Who is listed as a contributor?" with "Contributors are people who made contributions to this goal by working on subgoals and projects."

##### C.5.4.2 Sidebar fields (in order)

| # | Field | Edit control | Empty label | Notes |
|---|---|---|---|---|
| 1 | Retrospective card (closed only) | — | — | "Goal Retrospective", links to `/goal-activities/:id` |
| 2 | Completed On (closed) | — | — | date |
| 3 | Last update / [SHOT] "Last Check-In" | — | "%{championName} hasn't shared a check-in yet. Updates will land here soon." / champion: "Share the first update to set the goal status and start the monthly cadence." | card with 3px left border in status colour; [Check in] button (champion & reviewer with edit) |
| 4 | Parent Goal | GoalField popover with search | "No parent goal" / "Set parent goal" | `goals.update_parent_goal` |
| 5 | Start Date | DateField: Day/Month/Quarter/Year tabs + calendar, [Clear] [Confirm] | "Set date" | `goals.update_start_date` |
| 6 | Due Date | DateField | "Set date" | red "Overdue by %{duration}." `goals.update_due_date` |
| 7 | Champion | PersonField (search people, "No champion" / "Set champion"); menu "Assign as reviewer" | "No champion" | ⓘ "The goal owner accountable for completion. Plans projects and submits monthly check-ins." `goals.update_champion` |
| 8 | Reviewer | PersonField; menu "Assign as champion" | "No reviewer" | ⓘ "Provides feedback throughout the goal, and is responsible for acknowledging monthly check-ins." `goals.update_reviewer` |
| 9 | Privacy | PrivacyIndicator + "Manage access" link | — | §7 |
| 10 | Actions | ActionList | — | "Close Goal" or "Re-open Goal", "Move to another space" (space picker modal → `goals.update_space`), "Export as Markdown", "Delete" (danger) |

**Delete modal:**
- Title: "Delete %{goalName}".
- Body: "Deleting a goal is permanent and cannot be undone. Please confirm that you want to delete the %{goalName} goal."
- Buttons: [Cancel] [Delete Forever] (red).
- Blocked variant: "Cannot delete goal" / "You need to delete all subgoals and projects before you can delete this goal. The following items are connected to this goal and must be deleted first:" followed by the list.
- API: `goals.delete`.

##### C.5.4.3 Other goal tabs

- **Check-Ins:**
  - Reverse-chronological list of CheckInCards: "Check-In for <date/>", status chip, author avatar, 3-line excerpt, comment count, "Draft" badge for own drafts.
  - Top-right: [Check in].
  - Empty: "Monthly check-ins keep everyone in the loop. Updates will appear here." + "Champions post monthly updates to document progress and share insights."
- **Discussions:**
  - DiscussionCards (title, author, date, excerpt, comment count) + [Start discussion].
  - Empty: "Start a discussion to share updates, ask questions, or get feedback from your team." Closed: "This goal is closed and has no discussions."
- **Docs & Files:** an embedded ResourceHub (§5.11) scoped to the goal's hub.
- **Activity:**
  - Feed (§5.13) filtered to the goal.
  - Empty: "Activity from this goal will appear here once people start sharing updates."
  - Admins see a ⋯ menu "Delete feed item": "This removes the item from the company feed. The underlying project, goal, task, or document will not be deleted."

#### C.5.5 Check-in form and check-in page (S11, S12, S25)

`[src: app/assets/js/pages/GoalCheckInNewPage, GoalCheckInPage, app/assets/js/features/goals/GoalCheckIn*, turboui/src/ProjectCheckInFormPage, turboui/src/CheckInHeader, turboui/src/SchedulePosting, turboui/src/Subscriptions]`

##### C.5.5.1 Form (goal and project share the pattern)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Work Map › Launch AI Platform › Check-ins                           │
│                Check-In for April 2026  (goal) / "Let's Check In" (project)
│                Share the progress with the team                     │
│ 1. How's the project going?            (goal: "Status")             │
│  [ Pick a status… ▾ ]  → ● On track   Progressing as planned. No blockers.
│                          ● Caution    Emerging risks or delays. Rachel should be aware.
│                          ● Off track  Significant problems… Rachel's help is needed.
│ (goal) Update Targets                                               │
│  Increase MAU     Current [ 25000 ] users   (was 21000)             │
│  Response time    Current [ 250   ] ms                              │
│ (goal) Update Checklist   ☐/☑ items                                 │
│ (goal) Due Date [Set a new due date for the goal.]                  │
│ 2. What's new since the last check-in?  (goal: "Key wins, obstacles and needs")
│  ┌ RichEditor  "Write your check-in here..." / "Describe key wins, obstacles and needs" ┐
│ ▸ Show previous check-in   (expands read-only previous one: "Posted by X on <date/>")   │
│ When I post this, notify:  (•) Everyone  ( ) Only the people I select  ( ) No one   │
│   [Select people to notify] (Champion/Reviewer "Always notified")                    │
│ [Submit check-in]  [Save as draft]  [Schedule Check-in ▾ date+time]  Or, Cancel      │
└─────────────────────────────────────────────────────────────────────┘
```

**Validation:**
- "Status is required", "Description is required", "Fill out all the required fields".
- Schedule: "Time must be in the future", "This time does not exist in your timezone". Scheduled posts show "Will be posted on <date/> at <time/>".
- On edit, the header reads "Editing the Check-In from <date/>". A banner "Editing locked after 3 days" appears when past the window.

**API:**
- `goals.create_check_in(goal_id, status, due_date, checklist[], content, new_target_values[], post_as_draft, scheduled_at, send_notifications_to_everyone, subscriber_ids)`, plus `update_check_in` (which also publishes a draft) and `delete_check_in`.
- `projects.create_check_in(project_id, status, description, post_as_draft, scheduled_at, send_notifications_to_everyone, subscriber_ids)`, plus `update_check_in`, `delete_check_in`.

##### C.5.5.2 Check-in page

```
 Work Map › Launch AI Platform › Check-ins
                       Goal Check-In
             Check-In for April 2026      [● On track]
   (K) Karen · Posted Apr 17 at 10:24 · Acknowledged by (R) Rachel ✓ | Not yet acknowledged
 ┌ status line: "The goal is on track." / "The goal needs caution due to emerging risks." / "…off track…" ┐
 │ Targets table with old→new values and Δ, Checklist snapshot                                 │
 │ Rich message body                                                                           │
 │ Reactions bar  [😀+]  👍 3  🚀 1                                                           │
 │ [Acknowledge this Check-In]  (reviewer only, primary, until acknowledged)                   │
 │ Comments (§6)                                                                                │
 │ Subscribers: "N people will be notified when someone comments on this check-in." [Subscribe me] │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
 Owner actions (⋯): Edit · Delete check-in ("Are you sure you want to delete this check-in?")
 Draft: banner "This is an unpublished draft." [Publish now] [Continue editing] [Discard draft]
        + "Share a link" (anyone with space access)
```

- **Acknowledgement:** `goals.acknowledge_check_in` / `projects.acknowledge_check_in`. Comment threads show "%{fullName} acknowledged this Check-In ✓".
- **[ROX]** The reviewer gets an Assistant bot card in the messenger with [Acknowledge] and [Open] buttons (card action → same mutation).

#### C.5.6 Close / Reopen goal, retrospective (S13–S15)

`[src: app/assets/js/pages/GoalClosingPage, GoalReopenPage, GoalActivityPage]`

```
 Closing Launch AI Platform
          Review & Close Goal
 Was this goal achieved?   ( Yes )  ( No )                   → success_status achieved|missed
 "This goal contains 2 subgoals and 1 project that will remain active:" [list]  (warning)
 Retrospective notes
 ┌ "What went well? What didn't? What did you learn?" ┐
 When I post this, notify: … (Subscriptions)
 [Close Goal]  Or, Cancel
```

- **Reopen:** "Reopen %{name}" / "Why are you reopening this goal?" ("Write here...") / [Reopen Goal] [Cancel].
- **Retrospective view** (`/goal-activities/:id`): title "Retrospective", "<author> on <date>", body, reactions, comments, [Acknowledge Retrospective] (reviewer), "Acknowledged by %{fullName}".
- **API:** `goals.close(goal_id, success, success_status, retrospective, send_to_everyone, subscriber_ids)`, `goals.reopen(id, message, …)`.

#### C.5.7 Project page (S19–S28)

`[src: turboui/src/ProjectPage/{index,Overview,Sidebar,ContributorsSection→turboui/src/ContributorsSection}.tsx, turboui/src/ProjectPageLayout/{PageHeader,useProjectPageTabs}.tsx, turboui/src/MilestoneList, app/assets/js/pages/ProjectPage/*]`. Wireframe follows the **[SHOT 02]** screenshot.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ Product › Projects                                                                          │
│ ┌──┐ Mobile App Redesign   [● On track]        ⟨◔ 42% tasks completed 5/12⟩                  │ 38px blue-50 tile; tasks pill (code)
│ └──┘                                                                                        │
│ ⊙ Overview │ ☑ Tasks 12 │ ✓ Check-ins │ 💬 Discussions │ 📁 Docs & Files │ ⚡ Activity          │
├───────────────────────────────────────────────────────────┬─────────────────────────────────┤
│ (paused) banner "This project is paused" [Resume]         │ ▌Last check-in                   │
│ (closed) "This project was closed on <date/>. Read the    │ ▌Sep 7                           │
│   retrospective."                                         │ ▌"Finished round-1 designs…"     │
│ Description  [Edit]                                       │ ▌(F) Frank   [● On track]        │
│ rich text … Expand ⌄                                      │  [Check in]                      │ overdue: amber "Check-in overdue"
│                                                           │ Parent goal                     │
│ Milestones  ◔ 1/3 completed          [Add milestone]      │  ◎ Improve Customer Experience  │
│ Upcoming                                                  │ Start date  📅 Set start date     │ (code; hidden in SHOT)
│  ⚑ Usability Test Round 1                       Sep 16    │ Due date    📅 Set due date       │
│  ⚑ Beta Release                                 Sep 30    │ ─────────────────────────────── │
│ ▸ Show 1 completed                                        │ Champion                        │
│                                                           │  (F) Frank Miller  ⓘ             │
│ Resources  [Add resource]                                 │      VP of Product              │
│ ⟨🔗 Sprint Planning Spreadsheet ↗⟩ ⟨📄 Project Brief ↗⟩      │ Reviewer                        │
│ ⟨🎨 Design Mockups ↗⟩                                       │  (D) David Brown  ⓘ  CTO         │
│                                                           │ Contributors                    │
│                                                           │  (A) Alice Johnson              │
│                                                           │      Frontend Development & UI/UX│ = responsibility
│                                                           │  (B) Bob Smith                  │
│                                                           │      Backend Architecture & API… │
│                                                           │  [+ Add contributor]            │
│                                                           │ Privacy  🌐 … · Who else has access?│
│                                                           │ Notifications [Subscribe]/[Unsubscribe]│
│                                                           │ Actions: Copy URL · Move to another space · Pause project /
│                                                           │   Resume project · Close project · Export as Markdown ·
│                                                           │   Save as template · Delete (red) │
└───────────────────────────────────────────────────────────┴─────────────────────────────────┘
```

##### C.5.7.1 Overview sections

- **Description:** same pattern as the goal description. Empty: "Add a project description...". API: `projects.update_description`.
- **Milestones** `[src: turboui/src/MilestoneList]`:
  - Header: pie + "%{completed}/%{total} completed" + [Add milestone].
  - **[SHOT]** groups the list into **Upcoming** (pending, sorted by due date) and a collapsible "▸ Show %{n} completed". Rows show a ⚑ flag icon (red if overdue), a title linking to `/milestones/:id`, and the due date right-aligned.
  - **[CODE≠SHOT]** Current code renders one list ordered by `milestones_ordering_state`, with drag reorder and inline edit. **[ROX]** Implement the SHOT grouping, and allow drag-reorder within Upcoming.
  - Add form fields: "Milestone name" ("Enter milestone title"), "Due date (optional)" with "Set target date" or "Set relative date" (template), "Create more", [Save].
  - Empty: "No milestones yet" / "Add milestones to track key deliverables and deadlines" / [Add your first milestone].
  - API: `projects.create_milestone`, `update_milestone`, `update_milestone_ordering`, `delete_milestone`.
- **Resources:**
  - **[SHOT]** "Resources" + [Add resource]. Pill chips: icon by link type + title + ↗, opening the URL in a new tab.
  - **[CODE≠SHOT]** Current code replaced `project_key_resources` with a "Docs & Files" preview of the project resource hub (folder, doc, file and link nodes).
  - **[ROX]** Keep the SHOT chips UI, but back them with Rox Drive or Docs items, plus link items in the project folder (§10, overlap).

##### C.5.7.2 Sidebar

| Field | Control | Empty / help | API |
|---|---|---|---|
| Last check-in | card (as goal) + [Check in] | "Weekly check-ins keep everyone in the loop." / overdue: "%{championName} needs to post a check-in to keep the team updated on the project's latest progress." | — |
| Parent goal | GoalField | "No parent goal" / "Set parent goal" | `projects.update_parent_goal` |
| Start date / Due date | DateField | "Set start date" / "Set due date" | `update_start_date`, `update_due_date` |
| Champion | PersonField | ⓘ "The project owner accountable for completion. Plans, assigns responsibilities, and submits weekly check-ins." | `update_champion` |
| Reviewer | PersonField | ⓘ "Provides feedback throughout the project, and is responsible for acknowledging weekly check-ins." | `update_reviewer` |
| Contributors | ContributorsSection: rows with name + responsibility. Hover menu: Edit contributor / Replace contributor / Remove contributor. Inactive person: "Not active" badge plus "Replace unavailable contributor". | "No contributors" | `create_contributor(s)`, `update_contributor`, `delete_contributor` |
| Privacy | PrivacyIndicator + "Who else has access?" modal (OtherPeopleWithAccess) | — | `update_permissions` |
| Notifications | NotificationToggle | "You're receiving notifications because you're subscribed to this project." | `notifications.subscribe` / `unsubscribe` |
| Actions | ActionList | "Project URL copied to clipboard" toast | `move_to_space`, `pause`, `resume`, `close`, `delete`, `project_templates.create_from_project` |

**Add contributor modal:**
- Title: "Add contributor".
- Fields: Person ("Select person"), Responsibility ("What are they responsible for?"), Access level ("Select access level": View / Comment / Edit / Full Access).
- Buttons: [Save contributor] [Cancel].

##### C.5.7.3 Project tabs

- **Tasks:** §5.8.
- **Check-ins:** list of CheckInCards plus [Check in].
- **Discussions:** list plus [Start discussion] (§5.10).
- **Docs & Files:** §5.11.
- **Activity:** feed.
- **Retrospective:** an extra tab-like link when the project is closed.

##### C.5.7.4 Pause / Resume / Close

`[src: app/assets/js/pages/ProjectPausePage, ProjectResumePage, ProjectClosePage, features/ProjectRetrospective]`

```
 Pause this project?                          | Ready to resume project?
 Pausing this project will:                   | Resuming will:
  • Stop notifications for team members       |  • Restart notifications for team members
  • Suspend all associated milestones and tasks|  • Reactivate project milestones and tasks
  • Move the project to your paused projects list| • Make the project visible in active project lists
 Why are you pausing this project? [Write here...]| Why are you resuming this project? [Write here...]
 Note: You can resume the project at any time.|
 [Pause project]  [Keep it active]            | [Resume project]  [Keep it paused]
```

- **Close** (`/projects/:id/close`):
  - Header: "Closing %{name}", then "Review & Close Project".
  - Question: "Did this project achieve its intended outcomes?" with ( Yes ) / ( No ).
  - "Retrospective notes" with placeholder "What went well? What didn't? What did you learn?".
  - Subscriber picker, then [Close Project].
- **Retrospective page** (`/projects/:id/retrospective`):
  - Title "Project Retrospective": content, reactions, comments.
  - [Acknowledge Retrospective] (reviewer); "Acknowledged by %{fullName}" / "Not yet acknowledged"; "Edit retrospective".
- **API:**
  - `projects.pause(project_id, message, send_notifications_to_everyone, subscriber_ids)`, `projects.resume(...)`.
  - `projects.close(project_id, retrospective, success_status, …)`, `update_retrospective`, `acknowledge_retrospective`.
- **Save as template modal** `[src: turboui/src/SaveProjectAsTemplateModal]`:
  - Title: "Save project as template".
  - Fields: "Template name", then "Include in template" checkboxes: Description, Milestones, Tasks, "People and assignments" ("Copies the project team with their roles and access."), Discussions, Docs & Files, Comments.
  - Validation: "Some dates are before the project start date."

#### C.5.8 Tasks: board, list, milestone and task pages (S20, S29, S30, S38)

`[src: turboui/src/TaskBoard/** (TaskBoard, KanbanView, ListView, filters/*, DisplayMenu, InlineTaskCreator), turboui/src/StatusCustomization, turboui/src/TaskCreationModal, turboui/src/MilestonePage, turboui/src/TaskPage, turboui/src/SpaceKanbanPage]`

##### C.5.8.1 Tasks tab toolbar

```
 Viewing tasks for [All project tasks ▾ | ⚑ Beta Release]   [⚲ Filter]  [Display ▾]  [+ New task]
 Filter chips: Status is In progress ✕ · Assignee is Me ✕ …           ("Clear filters")
 Display ▾ : Layout ( List | Board ) · ☐ Show closed statuses · Manage statuses…
```

- **URL:** `?tab=tasks&milestone=<id>&taskDisplay=list|board`. `tasks_view` is persisted per project with `projects.update_tasks_view`.
- **Filter fields:**
  - Status, Assignee, Creator, Milestone, Content (text);
  - Created / Updated / Due / Completed / Started dates (before, after, between, preset);
  - "Has description", "Has comments".
- **Keyboard:** **c** opens the inline creator.

##### C.5.8.2 Board (Kanban) and List

```
 BOARD
 ┌ ○ Not started 4 ─── + ┐┌ ◐ In progress 3 ─ + ┐┌ ✓ Done 5 ───────── + ┐  (Canceled hidden unless "Show closed")
 │ ┌───────────────────┐ ││ ┌─────────────────┐ ││ ┌─────────────────┐ │
 │ │ Design onboarding │ ││ │ API auth        │ ││ │ ~~Kickoff~~     │ │  card: title, ≡ description icon,
 │ │ ≡ 💬2  📅 Sep 12 (A)│ ││ │ 📅 Sep 20  (B)  │ ││ │                 │ │  💬 count, due date (red if overdue),
 │ └───────────────────┘ ││ └─────────────────┘ ││ └─────────────────┘ │  assignee avatars; ⚑ milestone chip
 │ + Add task            ││                     ││                     │  when viewing all tasks
 └───────────────────────┘└─────────────────────┘└─────────────────────┘
 LIST: grouped by milestone (collapsible headers "⚑ Beta Release · Sep 30 · 2/5"), then "No milestone";
 row = status icon (click → StatusSelector) · title · ≡ · 💬n · due date · assignee avatars; drag to reorder/move between groups.
```

- **Drag and drop** uses pragmatic-drag-and-drop:
  - Board: drag across columns changes status (`tasks.update_status`); drag within a column reorders (`projects.update_kanban`, `update_milestone_kanban`, `spaces.update_kanban`).
  - List: drag between milestones (`tasks.update_milestone_and_ordering`).
- **Empty states:**
  - Milestone: "No tasks yet." / "Click + or press c to add a task, or drag a task here." / "Press Enter to add. You can also drag tasks here."
  - Mobile: "Tap + to add a task."

##### C.5.8.3 Task creation modal and status customization

```
 ┌ Create task ───────────────────────────── ✕ ┐     ┌ Customize statuses ─────────────────── ✕ ┐
 │ Task title [ Enter task title           ]   │     │ Add, edit, or remove task statuses. Click  │
 │ Notes      [ Add notes about this task... ] │     │ the icon to change the color and appearance│
 │ Assignees  [ Select assignees ▾ ]           │     │ ○ [Not started ] ⋮⋮ 🗑                      │
 │ Due date   [ Set due date ] / Relative due  │     │ ◐ [In progress ] ⋮⋮ 🗑                      │
 │ Milestone  [ No milestone ▾ ]               │     │ ✓ [Done        ] ⋮⋮ 🗑                      │
 │ Status     [ ○ Not started ▾ ]              │     │ ✕ [Canceled    ] ⋮⋮ 🗑                      │
 │ ☐ Create more        [Cancel] [Create task] │     │ + Add status                               │
 └─────────────────────────────────────────────┘     │ Deleted statuses → "Select a replacement   │
                                                     │ status" per deleted one   [Cancel][Save changes]│
                                                     └────────────────────────────────────────────┘
```

- **Task creation:** `tasks.create(type: project|space, id, name, description?, assignee_ids?, due_date (contextual), milestone_id?, status?)`.
- **Status customization:** `projects.update_task_statuses` / `spaces.update_task_statuses(statuses[], deleted_status_replacements)`.

##### C.5.8.4 Milestone page (`/milestones/:id`)

```
 Product › Mobile App Redesign › Milestones
 ⚑ Beta Release                         [Active] / [Completed]        [Mark complete]
 Overview | Tasks | (Discussions | Docs & Files in template)
 ┌ main ───────────────────────────────────────┐ ┌ sidebar ─────────────────┐
 │ Notes [Add details about this milestone...]  │ │ Due date   📅 Sep 30       │
 │ Tasks (mini board/list for this milestone)  │ │ Milestone status Active   │
 │   [View on board]  + Add task               │ │ Completed on (if done)    │
 │ Comments & Activity (timeline: §6.3)        │ │ Created  <date> by (X)    │
 └─────────────────────────────────────────────┘ │ Notifications [Subscribe] │
                                                 │ Actions: Copy URL · Delete │
                                                 └───────────────────────────┘
 Complete "Beta Release"?  "This milestone has 3 open tasks. Choose what happens to them before completing it."
   (•) Move tasks to No milestone          — The tasks stay open and remain visible on the project task board.
   ( ) Change tasks to a closed status [Done ▾] — The tasks stay in this milestone and use the selected status.
   ( ) Keep milestone active
   [Cancel] [Complete milestone]
```

- **Delete:** "Delete Milestone" / "Deleting a milestone is permanent and cannot be undone…" / [Delete Forever].
- **API:**
  - `projects.get_milestone`, `update_milestone` (status done/pending), `update_milestone_title`, `update_milestone_due_date`, `update_milestone_description`;
  - `create_milestone_comment` (also used for the "Completed the Milestone" and "Re-Opened the Milestone" timeline entries), `delete_milestone`.

##### C.5.8.5 Task page (`/tasks/:id`)

```
 Product › Mobile App Redesign › Tasks
 ☐ Design onboarding flow  (title inline-editable)            [◐ In progress ▾]
 ┌ main ──────────────────────────────────────────┐ ┌ sidebar ───────────────────────────┐
 │ Notes  [Add notes about this task...] (RichEditor)│ │ Due date  📅 Sep 12 · "Overdue by 2 days."│
 │ Comments & Activity                             │ │ Reminders  + Add reminder           │
 │  timeline (§6.3) + comment box                  │ │   • 2 days before due date  ✕       │
 │  "Tip: @-mention someone to notify them about   │ │ Assignees  (A) Alice  + Assign task  │
 │   this task."                                   │ │ Milestone  ⚑ Beta Release ▾          │
 └─────────────────────────────────────────────────┘ │ Created   Sep 1 by (F) Frank         │
                                                     │ Notifications [Subscribe]            │
                                                     │ Actions: Copy URL · Move · Duplicate │
                                                     │          Archive · Delete            │
                                                     └──────────────────────────────────────┘
```

- **Reminder types:** "Before due date" (with "Days before due date"), due day, "Overdue", "On date" (with "Reminder date").
- **Move task:** "Destination type" (Space or Project), then "Select destination space/project", then milestone. API: `tasks.move`.
- **Other task API:** `tasks.update_name`, `update_description`, `update_status`, `update_due_date`, `update_reminders`, `update_assignee`, `update_milestone`, `delete`.

##### C.5.8.6 Space Kanban (`/spaces/:id/kanban`)

The same TaskBoard as the project, scoped to space tasks (`tasks.space_id`). There is no milestone selector. It is enabled when `tools.tasks_enabled`, and space statuses come from `groups.task_statuses`.

#### C.5.9 Review (S31)

`[src: turboui/src/ReviewPage, app/assets/js/pages/ReviewPage, app/lib/operately/assignments/*]`

```
 ☕ Review                                  12 outstanding items | "All caught up"
 Catch up on work that's due soon or waiting for your review.
 ── Due soon / overdue ──────────────────────────────────────────────────────────
 ◎ Submit goal progress update · Launch AI Platform           CHAMPION   2 days overdue (red)
 ▢ Submit weekly check-in · Mobile App Redesign               CHAMPION   Due today
 ☑ Design onboarding flow (task) · Mobile App Redesign        CONTRIBUTOR Due tomorrow
 ── Needs your review ───────────────────────────────────────────────────────────
 ✓ Review weekly check-in · Mobile App Redesign — Frank       REVIEWER
 ✓ Review goal progress update · Launch AI Platform — Paul    REVIEWER
 ✓ Review project retrospective / Review goal retrospective   REVIEWER
 ── My upcoming work ────────────────────────────────────────────────────────────
 "Work assigned to you with future due dates, sorted chronologically."
```

- **Assignment types:** `check_in`, `goal_update`, `project_task`, `space_task`, `milestone`, `kpi_update` ("Log update for %{name}"), `project_retrospective`, `goal_retrospective`.
- **Roles:** owner (CHAMPION / CONTRIBUTOR) and reviewer (REVIEWER).
- **Empty state:** "You're all caught up" / "No assignments, check-ins, milestones, or reviews need your attention right now."
- **API:** `people.list_assignments`, `people.get_assignments_count`; subscription `assignments_count` drives the nav badge.
- **[ROX]** Review merges with Rox Tasks "My tasks" and the Lark Task Assistant. Rox shows one "Review" inbox list, and the counter appears on the rail.

#### C.5.10 Discussions: space, goal and project (S16, S22, S28, S36, S37)

`[src: app/assets/js/pages/{SpaceDiscussionsPage,DiscussionNewPage,DiscussionPage,DiscussionEditPage,DiscussionDraftsPage,GoalDiscussionNewPage,ProjectDiscussionNewPage,ProjectDiscussionPage}, app/assets/js/features/DiscussionForm, turboui/src/{DiscussionCard,SchedulePosting,OngoingDraftActions,DiscardDiscussionDraftModal}]`

```
 SPACE DISCUSSIONS (/spaces/:id/discussions)
 Product › Discussions                                   [Drafts (2)]  [New Discussion]
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ (F) We need to make a decision on the pricing page            💬 4   Sep 3    │ DiscussionCard: author avatar,
 │     "Two options: A) … B) …"                                                  │ title bold, 2-line excerpt,
 │ (A) Welcome Bob to the team!                                  💬 9   Aug 30   │ comment count, date
 └──────────────────────────────────────────────────────────────────────────────┘

 NEW DISCUSSION (full page, centred 720px)
 New Discussion
 [ Title...                                              ]  "Please add a title"
 [ Write here... (RichEditor, mentions, files)            ]
 When I post this, notify: (•) Everyone ( ) Only the people I select ( ) No one
 [Post]  [Save as draft]  [Schedule Discussion ▾]   Or, Discard this message

 DISCUSSION PAGE: title (3xl), author + "Posted <date/>", body, Reactions, [Edit]/[Delete] (author/admin),
                  Comments (§6), Subscribers block. Draft banner as §5.5.2.
 DRAFTS: "Your Drafts" list: title, "Last edited on <date/>", ⋯ Draft actions → Discard draft.
         Empty: "You don't have any drafts."
```

**Storage by context:**

| Context | Stored as | API |
|---|---|---|
| Space | `messages` row in the space's `messages_boards` (state draft/scheduled/published) | `spaces.create_discussion` / `update_discussion` / `publish_discussion` / `archive_discussion` / `list_discussions` / `get_discussion` |
| Goal | `comment_threads` (parent_type `activity`) + activity `goal_discussion_creation` | `goals.create_discussion`, `update_discussion`, `list_discussions` |
| Project | `comment_threads` (parent_type `project`) | `projects.create_discussion` / `update_discussion` / `get_discussion` / `list_discussions` |

**Space tool card examples** [`features/SpaceTools`] used as empty-state placeholders: "Post Announcements", "Pitch Ideas", "Discuss ideas", with sample titles "We have a new team member...", "I have an idea to expand...", "We need to make a decision...".

#### C.5.11 Docs & Files: resource hub (S09, S23, S40–S42)

`[src: turboui/src/ResourceHub/**, turboui/src/DocsAndFiles, turboui/src/{DocumentEditPage,DocumentVersionHistoryPage,DocumentVersionComparisonPage,DocumentPublicSharingModal,FilePage,LinkPage,LinkNewPage,NewDocumentPage}, app/lib/operately/resource_hubs/*]`

```
 Product › Documents & Files                                   [🔍 Search documents and files…] [+ Add ▾]
 Add ▾ = New document · New folder · Upload files · Add link
 Your drafts (2) ▸
 ┌────────────────────────────────────────────────────────────────────────────────────┐
 │ 📁 Monthly Reports                                    3 items · Updated Sep 3   ⋯ │ ⋯ = Rename · Move · Copy · Delete
 │ 📄 Employee Handbook                                  Updated Aug 12  💬2       ⋯ │ ⋯ = Edit · Move · Create Copy ·
 │ 🖼 roadmap.png                                         Size: 1.2 MB             ⋯ │     Export as Markdown · Download · Delete
 │ 🔗 Product Roadmap (figma)                                                   ⋯ │
 └────────────────────────────────────────────────────────────────────────────────────┘
 Drop zone overlay: "Drop files here to upload them".
 Empty: "Ready for your first document" / "Your team's central hub for sharing documents, images, videos, and files. Click 'Add' to get started."
 Folder empty: "This folder is empty. Click 'Add' to upload your first file."
```

- **Document page:** title, author, "Last saved <date/>", rich body, reactions, comments, subscribers.
  - Actions: Edit · Version history · Share publicly (DocumentPublicSharingModal, which gives a public URL `/public/documents/:id`) · Copy · Move · Export as Markdown · Delete.
  - Version history lists versions (author and date) with "Compare" (RichContentDiff, side-by-side) and restore.
  - Drafts: "Save as draft" / "Publish".
- **File page:** preview (image or video), "Download", description, comments. **Link page:** URL, type icon, description, comments.
- **Hubs per context:** one per space, project and goal. **Tree:** `resource_nodes` of type `document|folder|file|link`, with `parent_folder_id`.
- **API:** `documents.*` (35 operations; current), plus legacy `resource_hubs.*`, `links.*`, `files.*` (catalog hidden).

#### C.5.12 People: directory, org chart, profile (S04, S45, S46)

`[src: turboui/src/{PeoplePage,PeopleOrgChartPage,ProfilePage,ProfileEditPage}]`

- **People:** a centred page (`max-w-5xl`) with an h1 (3xl bold) over a 2-column grid of person cards (`bg-surface-base rounded shadow p-4 border`): avatar, bold name, dimmed title, contact links.
- **Org Chart:** a tree from `manager_id`. Nodes are cards. "Expand %{n} reports for %{name}" / "Collapse".
- **Profile** (`/people/:id`):
  - Header: avatar 96, name, title, contact ("Contact": email), [Edit Profile] (self or admin).
  - Tabs: **Tasks** ("Assigned tasks will appear here.") | **Assigned** (work map, role column) | **Reviewing** | **Paused** | **Completed** | **Activity** ("Recent activity") | **About** ("About me" rich text; Manager; Reports; Peers; "Show all").
- **Edit profile:**
  - Fields: Name, Title, Avatar upload, Manager ("Select manager" / "No manager"), Timezone (full list), Language, About me.
  - API: `people.update`, `update_picture`.

#### C.5.13 Feed (activity) and Notifications (S10, S24, S32)

`[src: app/assets/js/features/Feed/**, app/assets/js/features/activities/<Action>/index.tsx (one renderer per activity), turboui/src/NotificationRow, app/assets/js/pages/NotificationsPage]`

```
 FEED ITEM                                                     NOTIFICATIONS PAGE
 (avatar 32) Frank Miller posted a check-in in            Notifications           [Mark all read]
            Mobile App Redesign             · Sep 7, 10:24  Here's every notification you've received from Operately.
            "Finished round-1 designs; usability test…"     New for you
            [● On track]   👍 2  💬 3                         • (F) Frank Miller posted a check-in · Mobile App…  2h  ◉
 Grouped by day ("Today", "Yesterday", date)                • (R) Rachel acknowledged your check-in …          5h  ◉
 Scope: company (Home), space, goal, project, person       Previous Notifications
                                                            (A) Alice commented on Design onboarding flow     Sep 3
                                                           Empty: "Nothing new for you."
```

- **Feed item:** actor + verb phrase + resource link (per activity; the 624 `features/activities` strings give each phrase), then an optional content excerpt or status badge, then a timestamp.
- **Notification row:** activity title + resource + relative time + unread dot. Clicking marks it read (`notifications.mark_as_read`) and navigates to the resource.
- **Live counters:** `unread_notifications_count` (socket) for the bell dot.

#### C.5.14 Spaces (S33–S36)

`[src: app/assets/js/pages/{SpacePage,SpaceAddPage,SpaceEditPage,SpaceToolsConfigurationPage}, app/assets/js/features/SpaceTools/*, turboui/src/SpaceToolsConfigurationPage]`

```
 Home › Product                                                         [⋯]  ⋯ = Edit · Configure tools · Manage access · Delete space
                         ┌──┐
                         │◼ │ Product                                   (space icon + colour)
                         └──┘ "Create product awareness and bring new leads" (mission)
                    (a)(b)(c)(d)(e) +12   [Manage access]   [Join this Space] (non-members, if open)
 ┌ Goals & Projects ─────┐ ┌ Discussions ──────────┐ ┌ Documents & Files ─┐ ┌ Tasks ───────────┐ ┌ KPIs ─────┐ ┌ Templates ─┐
 │ 3/5 goals on track     │ │ (F) We need to…   💬4 │ │ 📄 Handbook         │ │ ○ Draft the plan  │ │ MRR 42k ▲ │ │ Launch tmpl│
 │ 4/7 projects on track  │ │ (A) Welcome Bob   💬9 │ │ 📁 Monthly Reports  │ │ ◐ Assign an owner │ │ NPS 61    │ │            │
 │ mini work-map list     │ │                       │ │                     │ │ ✓ Mark it done    │ │           │ │            │
 │ "2 goals and 1 project │ │ [Write a new post]    │ │ [Add a document…]   │ │ [Add a new task]  │ │           │ │            │
 │  completed this quarter."│ └──────────────────────┘ └────────────────────┘ └──────────────────┘ └───────────┘ └────────────┘
 └────────────────────────┘   cards ≈ 300×320, click → tool page; empty cards show the sample content above dimmed
 Activity (space feed)
```

- **Delete space:**
  - Text: "Deleting this space will permanently remove everything in it. This includes all projects, goals, and discussions." / "This action cannot be undone."
  - Confirmation by typing the name (ConfirmByTypingModal). Button: [Delete everything].
- **New space:**
  - Titles: "Create a new space" / "Spaces help organize projects, goals, and team members in one place."
  - Fields: Space Name ("e.g. Marketing"), Purpose ("e.g. Create product awareness and bring new leads"), plus general access. Button: [Create Space].
- **Configure tools:** toggles with descriptions for:
  - Tasks ("Work together on tasks that don't belong to a specific project.");
  - Discussions;
  - Documents & Files;
  - KPIs ("Track the numbers this space cares about and log updates on a weekly or monthly cadence.");
  - Templates ("Save reusable project structures and use them for recurring work.").
  - The Goals & Projects card is always on.
  - API: `spaces.update_tools`.
- **API:** `spaces.create(name, mission, company_permissions, public_permissions)`, `update`, `join`, `add_members`, `delete_member`, `update_members_permissions`, `delete`.

#### C.5.15 Access management: goal, project and space (S17, S35)

`[src: app/assets/js/pages/{GoalAccessManagementPage,GoalAccessAddPage,GoalEditAccessLevelsPage,SpaceAccessManagementPage,SpaceAddMembersPage}, turboui/src/{PrivacyField,PrivacyIndicator,AccessLevelBadge,AccessLevelSummary}]`

```
 Team & Access                                              [Add People] / [Add Members]
 Manage the team and access to this goal
 General Access          🌐 Everyone in the company can view · Space members can edit   [Edit]
 People with Direct Access   (goal)        | Space Managers / Members (space)
   (P) Paul Young   Champion   [Full access ▾]   ⋯ Change access level · Remove from goal
   (R) Rachel King  Reviewer   [Full access ▾]
   (A) Alice        —          [Edit access ▾]   (space: ⋯ Promote to manager · Reassign to member · Remove from space)
 Other People with Access   "People who have access to the goal based on their company or space membership but are not directly assigned."
   12 other people have access to this goal · show all
```

**PrivacyField** labels:
- "Everyone in the company can view|comment|edit" / "…has full access";
- "Company members can view, space members can comment|edit|have full access";
- "Only space members can view|comment|edit" / "Space members have full access";
- "Only assigned people have access" (invite-only);
- "Anyone on the internet" (public link).

#### C.5.16 KPIs (S39)

`[src: turboui/src/SpaceKpisPage/**, app/lib/operately/kpis/*]`

```
 Product › KPIs                                                           [Track a KPI]
 ┌ Monthly revenue ─────────────┐ ┌ NPS score ──────────────┐ ┌ Uptime ───────────────┐
 │ 42,300 USD  ▲ +3,100 vs previous│ │ 61  — No change         │ │ 99.92 %  ▼ -0.03       │  card: name, latest value+unit,
 │ ╱╲__╱‾ sparkline  as of Sep 1 │ │                          │ │                        │  delta chip, sparkline, champion,
 │ (F) Monthly                   │ │ (A) Weekly               │ │ (B) Weekly · Due today │  cadence; click → detail
 └───────────────────────────────┘ └──────────────────────────┘ └────────────────────────┘
 DETAIL /spaces/:id/kpis/:kpiId : header (name, unit, cadence, champion, ⋯ Edit · Copy URL · Delete)
   Line chart (KPI history) with annotation markers ("Add annotation": Date + Title "e.g. Launched enterprise plan")
   [Log update] → "Log update — %{name}": Date/period, "Value (%{unit})", "Note (optional)" ("Posted as the first comment on this update.")
   History table: period · value · "Logged by <avatar> on <date/>" · 💬 comments · ⋯ Edit update / Delete update
   Edits keep "Replaced by %{name} on <date/>" trail.
 Empty: "No KPIs yet" / "Track key metrics for this space and record updates over time." [Add the first KPI]
```

- **Create KPI fields:** Name ("e.g. Monthly Recurring Revenue"), Unit ("e.g. USD, %, users"), Cadence (Weekly / Monthly), Champion, Description.
- **API:** `kpis.*` (11 operations).

#### C.5.17 Project templates (S43)

`[src: turboui/src/{ProjectTemplatesPage,TemplateProjectPage,ProjectTemplateSelection,ProjectTemplateLifecycle,SaveProjectAsTemplateModal}, app/lib/operately/project_templates/*]`

- **List page:**
  - Title "Project Templates", with [New template] and a search box ("Search project templates…").
  - Rows: name, description, space, creator, "Updated <date/>". Actions: Create project · Duplicate · Archive · Delete; "View archived" / Restore.
- **Template page:** looks like a project page with tabs Overview / Tasks / Discussions / Docs & Files.
  - "Project duration" replaces dates.
  - Milestones and tasks use **relative due dates** ("%{n} days after project starts" / "On the project start date").
  - Champion and reviewer placeholders; people with roles.
- **Create project from template:** name, space, "Select a project start date", then [Create project]. API: `project_templates.create_project`.

#### C.5.18 Search (S44)

`[src: turboui/src/{GlobalSearch,SearchPage}, app/lib/operately/search/*, app/lib/operately_web/api (companies.global_search)]`

```
 Search
 [ 🔍 Search titles and content…                                   ]
 Refine results:  Type [All ▾] · Status [Active | Closed | Completed | Paused | Archived] · Date [Last 7/30/90 days · 12 months]
 Sort results: [Best match ▾ | Most recent]
 "12 results found."
 ◎ Goal · Launch AI Platform  — "…<mark>AI</mark> platform for…"  Product · Updated Sep 3
 ✓ Goal check-in · Launch AI Platform — …
```

- **Types:** Goal, Goal check-in, Project, Project check-in, Project retrospective, Milestone, Task, Discussion, Document, File, Folder, Link, Person.
- **Empty:** "No content found for "%{query}". Try different keywords."

#### C.5.19 Account and admin (S47, S48: mostly skip, merge into Rox settings)

- **Account Notification Settings** `[src: turboui/src/AccountNotificationSettingsPage]` is the only account page whose semantics Rox must adopt:
  - **Activity emails:** "Activity emails are always batched". Batch window: 5 / 10 / 15 / 30 / 60 minutes.
  - **"Direct mentions are instant"** toggle.
  - **Assignments email:** "Send assignments email".
  - **Daily summary:** "Send daily summary" at a delivery time (hourly 12:00 AM–11:00 PM). Copy: "Receive a daily email with your upcoming check-ins, reviews, and other work that needs your attention."
  - **[ROX]** These go into `notification_pref.prefs.goals_projects`.
- **API Tokens, MCP Connections, CLI auth:** see §11.
- **Company admin:** manage people (suspend / restore), admins and owners, trusted email domains, company permissions, rename, export / import (JSON transfer), billing (EE). Rox: skip; use the existing Rox admin.

#### C.5.20 Markdown export (S49)

`GET /exports/markdown/goals/:id` and `/exports/markdown/projects/:id` return a `.md` file (title, status, champion / reviewer, dates, description, targets / checklist or milestones, latest check-ins, subgoals / projects). `[src: app/lib/operately/md/**]`. **[ROX]** Map this to "Export as Markdown" via the Docs exporter.

---

### C.6. Cross-cutting UI: comments, reactions, subscriptions, timeline, rich text, mentions

#### C.6.1 Comments

`[src: turboui/src/CommentSection, app/lib/operately/updates/comment.ex, app/lib/operately/comments/*]`

```
 (A) Alice Johnson · 2h                                           ⋯ (Edit · Copy link · Delete)
     Great progress! @Frank can we move the beta to Oct 2?
     👍 2  [😀+]
 ┌ (me) Write a comment here...                                                  ┐
 │ RichEditor (compact toolbar), @-mention, attach                                │
 └ "This comment will notify Frank and Rachel" / "…and 1 other."       [Post] [Cancel]┘
 "Tip: @-mention someone to notify them about this task." / "Tip: Subscribe if you want notifications too."
```

- Comments are **flat** (no nesting). Each has: edit (shown with "Edited"), delete, "Copy link" (anchor `#comment-<id>`) and reactions.
- Failed posts keep the draft: "Comment not posted" / "Your draft has been kept for retry."
- **Commentable entity types:** `project_check_in`, `project_milestone`, `goal_update`, `message`, `comment_thread`, `project_retrospective`, `resource_hub_document`, `resource_hub_file`, `resource_hub_link`, `project_task`, `space_task`, `kpi_entry`.
- **API:** `comments.list(entity_id, entity_type)`, `create(entity_id, entity_type, content)`, `update`, `delete`. Subscription `reload_comments` gives live refresh.

#### C.6.2 Reactions

`[src: turboui/src/Reactions]`

- A pill row of emoji with counts. Your own pill is highlighted; clicking it removes the reaction ("Click to remove your reaction").
- The "Add Reaction" button opens an emoji picker with search ("Search emojis...", keyword map).
- **Reaction entity types:** message, update, goal_update, comment, project_check_in, comment_thread, project_retrospective, space_task, resource_hub_document / file / link.
- **API:** `reactions.create(entity_id, entity_type, parent_type, emoji)` / `delete`.

#### C.6.3 Subscriptions ("who gets notified")

`[src: turboui/src/Subscriptions, turboui/src/NotificationToggle, app/lib/operately/notifications/subscription*.ex]`

- **On create forms:** "When I post this, notify:" with options **Everyone** (all with access) / **Only the people I select** / **No one**.
  - The selector modal ("Select people to notify") has checkboxes, [Select everyone] [Select no one] [Save selection], and "Always notified" for the champion and reviewer.
- **On resource pages:** a Subscribers block with "%{n} people will be notified when someone comments on this %{resource}." and [Subscribe me] / [Unsubscribe me], plus "Add/remove people...".
- **Model:** each commentable resource has one `subscription_list` (`send_to_everyone` flag) and many `subscriptions(person, type invited|joined|mentioned, canceled)`. Being @-mentioned auto-subscribes a person (type `mentioned`).

#### C.6.4 Comments & Activity timeline (task, milestone)

`[src: turboui/src/Timeline]` merges comments with system events, for example:
- "<author/> changed status of %{taskName} from <X> to <Y>"
- "… assigned %{taskName} to <assignee>"
- "… changed the due date of %{taskName} from <d1> to <d2>"
- "… attached %{taskName} to milestone <name>"
- "… completed the milestone" / "… re-opened the milestone"
- "… acknowledged this Check-In"

Empty: "No activity yet" / "Comments and task updates will appear here".

#### C.6.5 Rich editor

`[src: turboui/src/RichEditor/**, TipTap]`

- **Toolbar:**
  - Bold, Italic, Strikethrough, Highlight / Remove Highlight, Add / Edit Links ("ex. https://example.com");
  - Heading 1–3, Bullet List, Numbered List, **Task list** (checkbox items, toggled via `rich_content.set_task_item_checked`), Quote, Code Block, Divider;
  - Table (row / column / header controls), "Add an Image or File" (drag and drop: "Drop your files to add them"), Undo / Redo, "More formatting options".
- **Mentions:** @person and **@resource links** (goal, project, task, etc., resolved by `rich_content.resolve_links`).
- **Format:** ProseMirror JSON in every `description`, `message`, `body` or `content` column.
- **[ROX]** Rox's TipTap editor is reused. Store the same ProseMirror JSON (`jsonb`), so Operately content is directly compatible with Rox Docs blocks. Collaborative Yjs is only needed for Docs-backed bodies.

#### C.6.6 Date fields (contextual dates)

`[src: turboui/src/DateField, app/lib/operately/contextual_dates/*]`

- The picker has tabs **Day | Month | Quarter | Year**. It stores `{date_type, value, date}`, where `date` is the normalized last day of the period. Display examples: "Mar 5", "Mar 2026", "Q2 2026", "2026".
- Buttons: [Clear] [Confirm]. Overdue display: "Overdue by %{duration}".
- **[ROX]** Add a `due_precision` column (day|month|quarter|year) next to `due_at` on `task`, goal and project. This keeps one date column and adds no new date type.

---

### C.7. Permissions

`[src: app/lib/operately/access/{binding,context,group,group_membership}.ex, app/lib/operately/{goals,projects,groups,companies,resource_hubs}/permissions.ex, components/Badges]`

#### C.7.1 Model

- Each **company, space, goal and project** has an `access_context`.
- Each person has a personal `access_group`. Spaces and companies have member groups (standard / admin tags).
- An `access_binding(group, context, access_level, tag champion|reviewer)` grants a level.
- **Effective level** = max over the person's groups.
- **Levels:**

| Level | Value |
|---|---|
| no_access | 0 |
| minimal | 1 |
| view | 10 |
| comment | 40 |
| edit | 70 |
| admin | 90 |
| full | 100 |

- **General access** (PrivacyField) for a goal or project is three bindings: anonymous (public link), company members, and space members.

#### C.7.2 Matrix (goal / project; space is analogous)

| Action | View 10 | Comment 40 | Edit 70 | Full 100 |
|---|---|---|---|---|
| See page, check-ins, discussions, docs | ✅ | ✅ | ✅ | ✅ |
| Comment, react, acknowledge (reviewer) | | ✅ | ✅ | ✅ |
| Edit name / description / dates / targets / checklist / milestones / tasks; post check-ins; create discussions / docs | | | ✅ | ✅ |
| Change champion / reviewer, privacy, close / reopen / pause / resume, move space, delete, manage access | | | | ✅ |

**Default bindings:**
- Champion and reviewer get **Full** (tagged).
- Project contributors get their chosen level (View / Comment / Edit / Full).
- Space managers get Full; space members get the space's member level.
- The company: admins and owners = admin / full (billing, members, trusted domains); members can create spaces (edit).

**Badge copy** (exact):
- Goal Full: "Has full access to the goal and can perform any action, including editing, commenting, checking-in, closing, and archiving the goal."
- Goal Edit: "Can edit the goal, including its details and targets."
- Goal Comment: "Can comment on the goal updates and discussions. Cannot edit, close, or archive the goal."
- Goal View: "Can view the goal, including its details and updates. Cannot edit, comment, close, or archive the goal."
- Project variants are analogous.

#### C.7.3 Rox mapping

| Operately level | Rox `acl_entry.role` |
|---|---|
| full 100 | `owner` (champion), `manager` (reviewer or other full) |
| admin 90 | `manager` |
| edit 70 | `editor` |
| comment 40 | `commenter` |
| view 10 | `viewer` |

General access maps to `subject_type`: anonymous = `link`, company = `workspace`, space = **`space`** (a new subject type, or `chat` when the space is backed by a chat).

**[ROX]** Extend the `acl_entry.resource_type` CHECK with `'space','goal','project'`. Milestones, tasks, check-ins and discussions inherit from their parent (no own ACL rows), exactly as in Operately.

---


### C.13. Screenshot details (from Mark)

#### C.13.1 `user-shots/01-goal-overview.png`: Goal "Launch AI Platform"

- **Breadcrumb:** "Product Development › Goals". Goal icon (red target on red-50 tile).
- **Title** "Launch AI Platform" with a green **On track** chip directly after the title.
- **Tabs:** Overview (active, blue underline) · Check-Ins **3** · Discussions **6** · Activity. There is no Docs & Files tab; most likely the resource hub is disabled in that space, or the screenshot predates the tab.
- **Main column, in order:**
  1. **Goal Description** + [Edit], paragraph text, "Expand".
  2. **Targets** + [Add]. A table with headers NAME / CURRENT VALUE (small caps, dimmed). Row 1 shows an [Update ▾] button, which is its hover state.

     | Target | Current value |
     |---|---|
     | Increase Monthly Active Users | 25000 users |
     | Improve Response Time | 250 ms |
     | Achieve System Uptime | 99.8% |

     Each row has a progress pie at the left.
  3. **Checklist**: pie + "2/5 completed (40%)" + [Add]. Five items; the first 2 are checked and struck through.
  4. **Subgoals & Projects** + [Add goal] [Add project]. Nested rows (indent), each with an avatar and a status chip (On track green / Caution amber). A completed item is struck through.
- **Sidebar, in order:**
  - **Last Check-In** card: green left border, "Apr 17", excerpt, author "Karen", On track chip.
  - **Parent Goal**: "Accelerate product growth".
  - **Start Date**: "Set date". **Due Date**: "Set date".
  - **Champion**: Paul Young / Director of Business Development (ⓘ).
  - **Reviewer**: Rachel King / Director of Marketing.
  - **Privacy**: "Everyone in the company can view".
  - Divider, then actions: Close Goal · Move to another space · **Delete** (red).
- **[CODE≠SHOT]**
  - Code labels are "Last update" and "Goal description"; the screenshot uses "Last Check-In" and "Goal Description". **Use the SHOT labels.**
  - Code also has "Export as Markdown" in the actions and a Contributors section.

#### C.13.2 `user-shots/02-project-overview.png`: Project "Mobile App Redesign"

- **Breadcrumb:** "Product › Projects". Project icon on a blue tile. Title + On track chip.
- **Tabs:** Overview · Tasks **12** · Check-ins · Discussions · Activity.
- **Main:**
  - **Description** + [Edit] + Expand.
  - **Milestones**: pie "1/3 completed", [Add milestone]. Subheader **Upcoming**: ⚑ "Usability Test Round 1" (Sep 16) and ⚑ "Beta Release" (Sep 30), both linked. Then "▶ Show 1 completed".
  - **Resources** + [Add resource]: chips "Sprint Planning Spreadsheet", "Project Brief", "Design Mockups", each with an ↗ external icon.
- **Sidebar:**
  - **Last check-in**: Sep 7, author Frank, On track chip.
  - **Parent goal**: "Improve Customer Experience".
  - Divider.
  - **Champion**: Frank Miller / VP of Product. **Reviewer**: David Brown / CTO.
  - **Contributors**: Alice Johnson / "Frontend Development & UI/UX", Bob Smith / "Backend Architecture & API Design".
- **[CODE≠SHOT]**
  - The code adds the start / due date fields, Privacy, Notifications, Actions and the tasks-completed pill.
  - The code shows milestones as one sortable list.
  - Resources are Docs & Files in code.
  - **[ROX]** Use the SHOT layout and append the code-only sections below Contributors in the order of §5.7.2.

---

