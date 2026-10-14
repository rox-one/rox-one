/**
 * Phosphor glyphs for the navigation chrome (rail + secondary sidebars).
 * Owner decision: navigation uses @phosphor-icons/react (MIT), regular weight,
 * 16px muted grey like Cursor's sidebar. `GLYPHS` stays the Lucide concept map
 * (string names, plugin contracts); this maps each concept — and its Lucide
 * component — to the Phosphor glyph the chrome renders.
 */
import type { ComponentType } from 'react'
import {
  AddressBook, BookBookmark, BookOpen, Books, Brain, Browsers, CalendarBlank, ChartBar,
  ChatCircle, ChatsCircle, Clipboard, Code, Crosshair, Database, FilePlus, FlowArrow, Gavel,
  Gear, GitBranch, Globe, GraduationCap, HardDrive, House, Kanban, Key, Lightning, ListChecks,
  ListPlus, MagnifyingGlass, Notebook, NotePencil, Plugs, Pulse, Robot, Rss, Target, Timer,
  Tray, type Icon as PhosphorIcon,
} from '@phosphor-icons/react'
import { GLYPHS, type GlyphConcept } from './glyphs'

export type { PhosphorIcon }

export const PHOSPHOR_GLYPHS: Record<GlyphConcept, PhosphorIcon> = {
  home: House, sessions: ChatCircle, notes: NotePencil, tasks: ListChecks, feed: Rss,
  inbox: Tray, team: ChatsCircle, calendar: CalendarBlank, goals: Target, memory: Brain,
  skills: Lightning, learning: GraduationCap, sources: Database, browser: Globe,
  projects: Kanban, pages: Browsers, automations: FlowArrow, connections: Plugs,
  knowledge: BookOpen, settings: Gear, search: MagnifyingGlass, addNote: FilePlus,
  addTask: ListPlus, dossier: AddressBook, radar: Crosshair, decisions: Gavel, agents: Robot,
  focus: Timer, secrets: Key, activity: ChartBar, library: Books, health: Pulse,
  repository: GitBranch, clipboard: Clipboard, drive: HardDrive, developers: Code,
  playbooks: Notebook, cookbooks: BookBookmark,
}

const BY_LUCIDE = new Map<unknown, PhosphorIcon>(
  (Object.keys(GLYPHS) as GlyphConcept[]).map((concept) => [GLYPHS[concept], PHOSPHOR_GLYPHS[concept]]),
)

/** Phosphor twin of a shell glyph; unknown (plugin/free-form) icons pass through unchanged. */
export function navGlyph<P>(icon: ComponentType<P>): ComponentType<P> | PhosphorIcon {
  return BY_LUCIDE.get(icon) ?? icon
}
