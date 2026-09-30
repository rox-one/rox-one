/**
 * Project roadmap — the single structured spec behind the Project screen.
 *
 * Pure module (no fs): safe to import from the renderer. Disk IO lives in
 * `roadmap-storage.ts`.
 *
 * Stored next to config.json:
 * {workspaceRootPath}/projects/{slug}/
 *   ├── config.json    - Project settings (name, description, working dir, …)
 *   ├── roadmap.json   - Canonical roadmap (this schema, pretty-printed)
 *   └── roadmap.md     - Human-readable mirror, regenerated on every save
 *
 * Projects created before the roadmap existed simply have no roadmap.json:
 * `normalizeRoadmap(undefined)` yields an empty roadmap, nothing in config.json
 * is rewritten, so migration is lossless.
 */

export const ROADMAP_FILENAME = 'roadmap.json';
export const ROADMAP_MARKDOWN_FILENAME = 'roadmap.md';
export const ROADMAP_SCHEMA_VERSION = 1 as const;

export type MilestoneStatus = 'planned' | 'active' | 'done' | 'blocked';
export const MILESTONE_STATUSES: readonly MilestoneStatus[] = ['planned', 'active', 'done', 'blocked'];

export type RequirementKind = 'functional' | 'technical' | 'quantitative' | 'qualitative';
export const REQUIREMENT_KINDS: readonly RequirementKind[] = ['functional', 'technical', 'quantitative', 'qualitative'];

export type RoadmapInputKind = 'link' | 'text' | 'note' | 'session' | 'source';
export const ROADMAP_INPUT_KINDS: readonly RoadmapInputKind[] = ['link', 'text', 'note', 'session', 'source'];

/** A checkable line (definition-of-done criterion, risk, open question). */
export interface RoadmapItem {
  id: string;
  text: string;
  done: boolean;
}

export interface RoadmapSubstage {
  id: string;
  title: string;
  done: boolean;
}

export interface RoadmapStage {
  id: string;
  title: string;
  done: boolean;
  substages: RoadmapSubstage[];
}

export interface RoadmapMilestone {
  id: string;
  title: string;
  description: string;
  status: MilestoneStatus;
  /** Local calendar date, YYYY-MM-DD. */
  startDate?: string;
  /** Local calendar date, YYYY-MM-DD. */
  dueDate?: string;
  stages: RoadmapStage[];
  /** Personal-task ids (Задачи store) linked to this milestone. */
  taskIds: string[];
}

export interface RoadmapRequirement {
  id: string;
  kind: RequirementKind;
  text: string;
  /** Acceptance criteria — each line must be verifiable. */
  acceptance: string[];
  milestoneId?: string;
}

/**
 * A project input that is not a file. Files live in the project's assets/
 * folder (existing project-asset storage) and are listed from disk.
 * - link: value = URL
 * - text: value = pasted text / note body
 * - note: value = Rox note id
 * - session: value = session id
 * - source: value = workspace source slug
 */
export interface RoadmapInput {
  id: string;
  kind: RoadmapInputKind;
  title: string;
  value: string;
  addedAt: number;
}

export interface ProjectRoadmap {
  schemaVersion: typeof ROADMAP_SCHEMA_VERSION;
  /** Why the project exists — one or two sentences. */
  goal: string;
  /** Expected result / definition of done, as prose. */
  expectedResult: string;
  /** Verifiable definition-of-done criteria. */
  doneCriteria: RoadmapItem[];
  inputs: RoadmapInput[];
  milestones: RoadmapMilestone[];
  requirements: RoadmapRequirement[];
  risks: RoadmapItem[];
  openQuestions: RoadmapItem[];
  updatedAt: number;
  /** Opaque read/save receipt token; not persisted as roadmap content. */
  revision?: string;
}

export function isRoadmapRevision(value: unknown): value is string {
  return typeof value === 'string' && (value === 'missing' || /^[a-f0-9]{64}$/.test(value));
}

export interface RoadmapSaveQueue {
  save(draft: ProjectRoadmap): Promise<ProjectRoadmap>;
}

/** One read scope, ordered commits and revisions advanced only by an ACK. */
export function createRoadmapSaveQueue(
  initialRevision: string,
  commit: (draft: ProjectRoadmap) => Promise<ProjectRoadmap>,
): RoadmapSaveQueue {
  if (!isRoadmapRevision(initialRevision)) throw new Error('PROJECT_ROADMAP_INVALID_REVISION');
  let revision = initialRevision;
  let tail: Promise<void> = Promise.resolve();
  return {
    save(draft) {
      // Freeze the user's intent before an earlier asynchronous save completes.
      const snapshot = structuredClone(draft);
      const pending = tail.then(async () => {
        const saved = await commit({ ...snapshot, revision });
        if (!isRoadmapRevision(saved.revision) || saved.revision === 'missing') {
          throw new Error('PROJECT_ROADMAP_MISSING_RECEIPT');
        }
        revision = saved.revision;
        return saved;
      });
      // Failure retains the observed token; a retry cannot overwrite a winner.
      tail = pending.then(() => {}, () => {});
      return pending;
    },
  };
}

// ============================================================
// Construction / normalization
// ============================================================

export function roadmapId(prefix = 'r'): string {
  const uuid = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.();
  const raw = uuid ? uuid.replace(/-/g, '').slice(0, 10) : Math.random().toString(36).slice(2, 12);
  return `${prefix}-${raw}`;
}

export function emptyRoadmap(): ProjectRoadmap {
  return {
    schemaVersion: ROADMAP_SCHEMA_VERSION,
    goal: '',
    expectedResult: '',
    doneCriteria: [],
    inputs: [],
    milestones: [],
    requirements: [],
    risks: [],
    openQuestions: [],
    updatedAt: 0,
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(value: unknown, max = 20_000): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function id(value: unknown, prefix: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 64) : roadmapId(prefix);
}

function date(value: unknown): string | undefined {
  return typeof value === 'string' && DATE_RE.test(value) ? value : undefined;
}

function normalizeItem(raw: unknown, prefix: string): RoadmapItem | null {
  if (typeof raw === 'string') return raw.trim() ? { id: roadmapId(prefix), text: raw.trim(), done: false } : null;
  const o = obj(raw);
  const text = str(o.text).trim();
  if (!text) return null;
  return { id: id(o.id, prefix), text, done: o.done === true };
}

function normalizeStage(raw: unknown): RoadmapStage | null {
  if (typeof raw === 'string') return raw.trim() ? { id: roadmapId('st'), title: raw.trim(), done: false, substages: [] } : null;
  const o = obj(raw);
  const title = str(o.title, 500).trim();
  if (!title) return null;
  const substages = arr(o.substages)
    .map((s): RoadmapSubstage | null => {
      if (typeof s === 'string') return s.trim() ? { id: roadmapId('ss'), title: s.trim(), done: false } : null;
      const so = obj(s);
      const t = str(so.title, 500).trim();
      return t ? { id: id(so.id, 'ss'), title: t, done: so.done === true } : null;
    })
    .filter((s): s is RoadmapSubstage => s !== null);
  return { id: id(o.id, 'st'), title, done: o.done === true, substages };
}

function normalizeMilestone(raw: unknown): RoadmapMilestone | null {
  const o = obj(raw);
  const title = str(o.title, 500).trim();
  if (!title) return null;
  const status = MILESTONE_STATUSES.includes(o.status as MilestoneStatus) ? (o.status as MilestoneStatus) : 'planned';
  let startDate = date(o.startDate);
  let dueDate = date(o.dueDate);
  if (startDate && dueDate && startDate > dueDate) [startDate, dueDate] = [dueDate, startDate];
  return {
    id: id(o.id, 'ms'),
    title,
    description: str(o.description).trim(),
    status,
    ...(startDate ? { startDate } : {}),
    ...(dueDate ? { dueDate } : {}),
    stages: arr(o.stages).map(normalizeStage).filter((s): s is RoadmapStage => s !== null),
    taskIds: [...new Set(arr(o.taskIds).filter((t): t is string => typeof t === 'string' && t.length > 0))],
  };
}

function normalizeRequirement(raw: unknown): RoadmapRequirement | null {
  const o = obj(raw);
  const text = str(o.text, 4000).trim();
  if (!text) return null;
  const kind = REQUIREMENT_KINDS.includes(o.kind as RequirementKind) ? (o.kind as RequirementKind) : 'functional';
  const acceptance = arr(o.acceptance)
    .map((a) => (typeof a === 'string' ? a.trim() : ''))
    .filter(Boolean);
  const milestoneId = typeof o.milestoneId === 'string' && o.milestoneId ? o.milestoneId : undefined;
  return { id: id(o.id, 'rq'), kind, text, acceptance, ...(milestoneId ? { milestoneId } : {}) };
}

function normalizeInput(raw: unknown): RoadmapInput | null {
  const o = obj(raw);
  const kind = ROADMAP_INPUT_KINDS.includes(o.kind as RoadmapInputKind) ? (o.kind as RoadmapInputKind) : null;
  const value = str(o.value, 200_000);
  if (!kind || !value.trim()) return null;
  return {
    id: id(o.id, 'in'),
    kind,
    title: str(o.title, 500).trim(),
    value,
    addedAt: typeof o.addedAt === 'number' && Number.isFinite(o.addedAt) ? o.addedAt : 0,
  };
}

/**
 * Tolerant normalization: unknown/garbled fields are dropped, never thrown on.
 * `undefined` (no roadmap.json yet) → empty roadmap.
 */
export function normalizeRoadmap(raw: unknown): ProjectRoadmap {
  const o = obj(raw);
  const milestones = arr(o.milestones).map(normalizeMilestone).filter((m): m is RoadmapMilestone => m !== null);
  const milestoneIds = new Set(milestones.map((m) => m.id));
  return {
    schemaVersion: ROADMAP_SCHEMA_VERSION,
    goal: str(o.goal).trim(),
    expectedResult: str(o.expectedResult).trim(),
    doneCriteria: arr(o.doneCriteria).map((r) => normalizeItem(r, 'dod')).filter((r): r is RoadmapItem => r !== null),
    inputs: arr(o.inputs).map(normalizeInput).filter((r): r is RoadmapInput => r !== null),
    milestones,
    requirements: arr(o.requirements)
      .map(normalizeRequirement)
      .filter((r): r is RoadmapRequirement => r !== null)
      .map((r) => (r.milestoneId && !milestoneIds.has(r.milestoneId) ? { ...r, milestoneId: undefined } : r)),
    risks: arr(o.risks).map((r) => normalizeItem(r, 'rk')).filter((r): r is RoadmapItem => r !== null),
    openQuestions: arr(o.openQuestions).map((r) => normalizeItem(r, 'oq')).filter((r): r is RoadmapItem => r !== null),
    updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : 0,
    ...(isRoadmapRevision(o.revision) ? { revision: o.revision } : {}),
  };
}

export function isRoadmapEmpty(roadmap: ProjectRoadmap): boolean {
  return (
    !roadmap.goal &&
    !roadmap.expectedResult &&
    roadmap.doneCriteria.length === 0 &&
    roadmap.inputs.length === 0 &&
    roadmap.milestones.length === 0 &&
    roadmap.requirements.length === 0 &&
    roadmap.risks.length === 0 &&
    roadmap.openQuestions.length === 0
  );
}

// ============================================================
// Dates (local calendar days, YYYY-MM-DD)
// ============================================================

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export function addDays(value: string, days: number): string {
  const d = parseIsoDate(value);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000);
}

/** Shift a milestone by N days, keeping its duration. */
export function shiftMilestone(m: RoadmapMilestone, days: number): RoadmapMilestone {
  if (!days) return m;
  return {
    ...m,
    ...(m.startDate ? { startDate: addDays(m.startDate, days) } : {}),
    ...(m.dueDate ? { dueDate: addDays(m.dueDate, days) } : {}),
  };
}

/** Timeline window covering every dated milestone (padded), or null when nothing is dated. */
export function roadmapTimelineRange(milestones: readonly RoadmapMilestone[], today: string): { start: string; end: string } | null {
  const dates: string[] = [];
  for (const m of milestones) {
    if (m.startDate) dates.push(m.startDate);
    if (m.dueDate) dates.push(m.dueDate);
  }
  if (dates.length === 0) return null;
  dates.push(today);
  dates.sort();
  let start = addDays(dates[0]!, -3);
  let end = addDays(dates[dates.length - 1]!, 3);
  if (daysBetween(start, end) < 14) end = addDays(start, 14);
  return { start, end };
}

// ============================================================
// Progress
// ============================================================

export function milestoneProgress(m: RoadmapMilestone): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const s of m.stages) {
    if (s.substages.length) {
      total += s.substages.length;
      done += s.substages.filter((x) => x.done).length;
    } else {
      total += 1;
      if (s.done) done += 1;
    }
  }
  return { done, total };
}

// ============================================================
// Markdown mirror / export
// ============================================================

export interface RoadmapMarkdownLabels {
  goal: string;
  expectedResult: string;
  doneCriteria: string;
  milestones: string;
  requirements: string;
  acceptance: string;
  risks: string;
  openQuestions: string;
  inputs: string;
  status: Record<MilestoneStatus, string>;
  requirementKind: Record<RequirementKind, string>;
  inputKind: Record<RoadmapInputKind, string>;
  generatedNote: string;
}

export const DEFAULT_ROADMAP_MARKDOWN_LABELS: RoadmapMarkdownLabels = {
  goal: 'Цель',
  expectedResult: 'Ожидаемый результат',
  doneCriteria: 'Критерии готовности',
  milestones: 'Вехи',
  requirements: 'Требования',
  acceptance: 'Критерии приёмки',
  risks: 'Риски',
  openQuestions: 'Открытые вопросы',
  inputs: 'Вводные',
  status: { planned: 'запланирована', active: 'в работе', done: 'готово', blocked: 'заблокирована' },
  requirementKind: {
    functional: 'Функциональные',
    technical: 'Технические',
    quantitative: 'Количественные',
    qualitative: 'Качественные',
  },
  inputKind: { link: 'ссылка', text: 'текст', note: 'заметка', session: 'сессия', source: 'источник' },
  generatedNote: 'Сгенерировано из roadmap.json — правьте проект в Rox, файл перезаписывается.',
};

function check(done: boolean): string {
  return done ? '[x]' : '[ ]';
}

export function roadmapToMarkdown(
  roadmap: ProjectRoadmap,
  projectName: string,
  labels: RoadmapMarkdownLabels = DEFAULT_ROADMAP_MARKDOWN_LABELS,
  options: { includeGeneratedNote?: boolean; files?: readonly string[] } = {},
): string {
  const out: string[] = [`# ${projectName}`, ''];
  if (options.includeGeneratedNote) out.push(`> ${labels.generatedNote}`, '');
  if (roadmap.goal) out.push(`## ${labels.goal}`, '', roadmap.goal, '');
  if (roadmap.expectedResult || roadmap.doneCriteria.length) {
    out.push(`## ${labels.expectedResult}`, '');
    if (roadmap.expectedResult) out.push(roadmap.expectedResult, '');
    if (roadmap.doneCriteria.length) {
      out.push(`**${labels.doneCriteria}:**`, '');
      for (const c of roadmap.doneCriteria) out.push(`- ${check(c.done)} ${c.text}`);
      out.push('');
    }
  }
  if (roadmap.milestones.length) {
    out.push(`## ${labels.milestones}`, '');
    roadmap.milestones.forEach((m, i) => {
      const dates = [m.startDate, m.dueDate].filter(Boolean).join(' → ');
      out.push(`### ${i + 1}. ${m.title}${dates ? ` (${dates})` : ''} — ${labels.status[m.status]}`, '');
      if (m.description) out.push(m.description, '');
      for (const s of m.stages) {
        out.push(`- ${check(s.done)} ${s.title}`);
        for (const ss of s.substages) out.push(`  - ${check(ss.done)} ${ss.title}`);
      }
      if (m.stages.length) out.push('');
    });
  }
  if (roadmap.requirements.length) {
    out.push(`## ${labels.requirements}`, '');
    for (const kind of REQUIREMENT_KINDS) {
      const items = roadmap.requirements.filter((r) => r.kind === kind);
      if (!items.length) continue;
      out.push(`### ${labels.requirementKind[kind]}`, '');
      for (const r of items) {
        out.push(`- ${r.text}`);
        if (r.acceptance.length) {
          out.push(`  - ${labels.acceptance}:`);
          for (const a of r.acceptance) out.push(`    - ${check(false)} ${a}`);
        }
      }
      out.push('');
    }
  }
  if (roadmap.risks.length) {
    out.push(`## ${labels.risks}`, '');
    for (const r of roadmap.risks) out.push(`- ${r.text}`);
    out.push('');
  }
  if (roadmap.openQuestions.length) {
    out.push(`## ${labels.openQuestions}`, '');
    for (const q of roadmap.openQuestions) out.push(`- ${check(q.done)} ${q.text}`);
    out.push('');
  }
  const files = options.files ?? [];
  if (roadmap.inputs.length || files.length) {
    out.push(`## ${labels.inputs}`, '');
    for (const f of files) out.push(`- 📎 ${f}`);
    for (const input of roadmap.inputs) {
      const title = input.title || (input.kind === 'text' ? input.value.slice(0, 80).replace(/\s+/g, ' ') : input.value);
      const suffix = input.kind === 'link' && input.title ? ` — ${input.value}` : '';
      out.push(`- ${labels.inputKind[input.kind]}: ${title}${suffix}`);
    }
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * Compact roadmap text for agent system-prompt injection (goal, DoD,
 * milestones, requirements). Capped; returns null when there is nothing useful.
 */
export function roadmapToPromptText(roadmap: ProjectRoadmap, maxChars = 6000): string | null {
  const lines: string[] = [];
  if (roadmap.goal) lines.push(`Goal: ${roadmap.goal}`);
  if (roadmap.expectedResult) lines.push(`Expected result: ${roadmap.expectedResult}`);
  if (roadmap.doneCriteria.length) {
    lines.push('Definition of done:');
    for (const c of roadmap.doneCriteria) lines.push(`- ${check(c.done)} ${c.text}`);
  }
  if (roadmap.milestones.length) {
    lines.push('Milestones:');
    roadmap.milestones.forEach((m, i) => {
      const dates = [m.startDate, m.dueDate].filter(Boolean).join('..');
      lines.push(`${i + 1}. ${m.title} [${m.status}${dates ? `, ${dates}` : ''}]`);
      for (const s of m.stages) lines.push(`   - ${check(s.done)} ${s.title}`);
    });
  }
  if (roadmap.requirements.length) {
    lines.push('Requirements:');
    for (const r of roadmap.requirements) {
      lines.push(`- (${r.kind}) ${r.text}`);
      for (const a of r.acceptance) lines.push(`  • accept: ${a}`);
    }
  }
  if (!lines.length) return null;
  const text = lines.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…[roadmap truncated]` : text;
}
