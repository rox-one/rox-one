/**
 * W1-07 (#1504) — resolve a registration's Lucide icon name to a component,
 * so wave-2 modes and slot entries need no shell icon map edits.
 *
 * PERF (#1675): the map below is an explicit, tree-shakeable set of the icons
 * that can actually reach this resolver. A namespace import (`import * as
 * Icons from 'lucide-react'`) makes Rollup treat the whole icon set as live,
 * pulling ~3.5 MB into the entry graph; named imports only keep the icons
 * referenced here.
 */
import {
  Activity,
  BookOpen,
  Bot,
  Brain,
  Cable,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  ChartColumn,
  ClipboardList,
  Contact,
  DatabaseZap,
  FilePlus,
  FilePlus2,
  FileText,
  Folder,
  FolderGit2,
  FolderKanban,
  Gavel,
  GitBranch,
  Globe,
  GraduationCap,
  HardDrive,
  Hash,
  House,
  Inbox,
  KeyRound,
  LayoutGrid,
  Library,
  ListPlus,
  ListTodo,
  MessageCircle,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  Network,
  NotebookPen,
  NotebookText,
  PanelsTopLeft,
  Plus,
  Radar,
  Rss,
  Search,
  Settings,
  SquareCheck,
  SquareTerminal,
  Table,
  Target,
  Timer,
  Upload,
  UserPlus,
  Users,
  UsersRound,
  Video,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/**
 * Name → component for every Lucide name that can reach this resolver.
 *
 * Sources, all in-repo (enumerated per source) — see the PERF #1675 report:
 * - `GLYPH_NAMES` (`platform/glyphs.ts`): the closed dictionary every seeded
 *   mode (`modes-seed.ts`), the `DEFAULT_PILL_SURFACES` and the pill spec use.
 *   `glyphs.test.ts` asserts each name resolves back to its `GLYPHS` component.
 * - `DEFAULT_PILL_SURFACES` (`platform/pill-composition.ts`): `Rss`,
 *   `MessagesSquare`, `Home`, `NotebookPen`, `Globe` (all glyph names, plus the
 *   `Home` alias below).
 * - `CORE_GLOBAL_CREATE_ITEMS` + children (`platform/global-create.ts`): the
 *   «+» menu icons (plus any wave-2 slot override, which falls back to null).
 *
 * `Home` is the deprecated Lucide alias of `House` (`House as Home` in
 * lucide-react 0.561): `DEFAULT_PILL_SURFACES` still carries the string
 * `'Home'`, so the key maps to the same `House` component.
 */
const ICON_COMPONENTS: Record<string, LucideIcon> = {
  Activity,
  BookOpen,
  Bot,
  Brain,
  Cable,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  ChartColumn,
  ClipboardList,
  Contact,
  DatabaseZap,
  FilePlus,
  FilePlus2,
  FileText,
  Folder,
  FolderGit2,
  FolderKanban,
  Gavel,
  GitBranch,
  Globe,
  GraduationCap,
  HardDrive,
  Hash,
  Home: House,
  House,
  Inbox,
  KeyRound,
  LayoutGrid,
  Library,
  ListPlus,
  ListTodo,
  MessageCircle,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  Network,
  NotebookPen,
  NotebookText,
  PanelsTopLeft,
  Plus,
  Radar,
  Rss,
  Search,
  Settings,
  SquareCheck,
  SquareTerminal,
  Table,
  Target,
  Timer,
  Upload,
  UserPlus,
  Users,
  UsersRound,
  Video,
  Workflow,
  Zap,
}

export function resolveLucideIcon(name: string | undefined | null): LucideIcon | null {
  // Icon components are PascalCase; lowercase exports (`icons`,
  // `createLucideIcon`) are helpers and must never render as a component.
  if (!name || !/^[A-Z]/.test(name)) return null
  // Unknown names (a plugin's free-form icon outside the map) degrade to the
  // callers' existing fallbacks (`?? LayoutGrid` / `?? Inbox`).
  const icon = ICON_COMPONENTS[name]
  return icon ?? null
}