/**
 * Canonical glyph dictionary (D6, W2.6): one entity concept → exactly one
 * Lucide icon. Navigation (`nav-destinations.ts`), the mode/capability seed
 * (`modes-seed.ts`), the Mode Bar pill (`ModeBar.tsx`) and the extra-screen
 * registry (`pages/extra-screens/registry.ts`) all read their glyphs from here,
 * so «сущность → значок» can no longer drift (`Home`/`House`,
 * `MessageSquare`/`MessageCircle`, `Brain`/`Sparkles`,
 * `NotebookPen`/`FilePlus2`, icon-vs-text `+`).
 *
 * `platform/lucide-icon.ts` still resolves a *free-form* Lucide name to a
 * component (wave-2 modes, plugin commands); this module is the *closed, typed*
 * set of concepts the shell itself renders. Adding an entity means adding ONE
 * concept here and pointing the consumer at it — never hand a raw Lucide name
 * to a glyph-bearing surface.
 */
import {
  Activity,
  BookOpen,
  Bot,
  Brain,
  Cable,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  Contact,
  DatabaseZap,
  FilePlus2,
  FolderGit2,
  FolderKanban,
  Gavel,
  GitBranch,
  Globe,
  GraduationCap,
  HardDrive,
  House,
  Inbox,
  KeyRound,
  Library,
  ListPlus,
  ListTodo,
  MessageSquare,
  MessagesSquare,
  NotebookPen,
  NotebookText,
  PanelsTopLeft,
  Radar,
  Rss,
  Search,
  Settings,
  Target,
  Timer,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/**
 * Concept → Lucide component. This is the primary map: consumers that render a
 * component (`nav-destinations`, `extra-screens/registry`) index it directly.
 *
 * `calendar` is the merged Календарь ← Встречи glyph (D4): the `meetings`
 * destination and the unified `calendar` mode both use it.
 */
export const GLYPHS = {
  home: House,
  sessions: MessageSquare,
  notes: NotebookPen,
  tasks: ListTodo,
  feed: Rss,
  inbox: Inbox,
  team: MessagesSquare,
  calendar: CalendarDays,
  goals: Target,
  memory: Brain,
  memoryRepo: GitBranch,
  skills: Zap,
  learning: GraduationCap,
  sources: DatabaseZap,
  browser: Globe,
  projects: FolderKanban,
  pages: PanelsTopLeft,
  automations: Workflow,
  connections: Cable,
  knowledge: BookOpen,
  settings: Settings,
  search: Search,
  addNote: FilePlus2,
  addTask: ListPlus,
  dossier: Contact,
  radar: Radar,
  decisions: Gavel,
  agents: Bot,
  focus: Timer,
  secrets: KeyRound,
  activity: ChartColumn,
  library: Library,
  health: Activity,
  // Newer rail destinations (clipboard history, drive, developers, playbooks).
  clipboardHistory: ClipboardList,
  drive: HardDrive,
  developers: FolderGit2,
  playbooks: NotebookText,
} as const satisfies Record<string, LucideIcon>

/** Every entity concept the shell renders a glyph for. */
export type GlyphConcept = keyof typeof GLYPHS

/**
 * Concept → Lucide export name, for consumers whose contract carries a string
 * (`ModeContribution.icon`). Kept in lockstep with `GLYPHS` by
 * `glyphs.test.ts` (each name must resolve back to its concept's component).
 */
export const GLYPH_NAMES = {
  home: 'House',
  sessions: 'MessageSquare',
  notes: 'NotebookPen',
  tasks: 'ListTodo',
  feed: 'Rss',
  inbox: 'Inbox',
  team: 'MessagesSquare',
  calendar: 'CalendarDays',
  goals: 'Target',
  memory: 'Brain',
  memoryRepo: 'GitBranch',
  skills: 'Zap',
  learning: 'GraduationCap',
  sources: 'DatabaseZap',
  browser: 'Globe',
  projects: 'FolderKanban',
  pages: 'PanelsTopLeft',
  automations: 'Workflow',
  connections: 'Cable',
  knowledge: 'BookOpen',
  settings: 'Settings',
  search: 'Search',
  addNote: 'FilePlus2',
  addTask: 'ListPlus',
  dossier: 'Contact',
  radar: 'Radar',
  decisions: 'Gavel',
  agents: 'Bot',
  focus: 'Timer',
  secrets: 'KeyRound',
  activity: 'ChartColumn',
  library: 'Library',
  health: 'Activity',
  clipboardHistory: 'ClipboardList',
  drive: 'HardDrive',
  developers: 'FolderGit2',
  playbooks: 'NotebookText',
} as const satisfies Record<GlyphConcept, string>

/**
 * Name → component, the inverse of `GLYPHS`/`GLYPH_NAMES`. Consumers that hold
 * a Lucide name string (mode registry, pill composition) resolve through this
 * instead of carrying their own icon map.
 */
export const GLYPH_ICONS_BY_NAME: Record<string, LucideIcon> = Object.fromEntries(
  (Object.keys(GLYPHS) as GlyphConcept[]).map((concept) => [GLYPH_NAMES[concept], GLYPHS[concept]]),
)