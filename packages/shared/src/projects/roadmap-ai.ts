/**
 * Project roadmap AI — prompt builders, tolerant response parsing and
 * per-item proposal application. Pure (no fs, no network): the server runs the
 * model, the renderer shows the proposal and applies only accepted items.
 */

import {
  addDays,
  normalizeRoadmap,
  REQUIREMENT_KINDS,
  roadmapId,
  roadmapToPromptText,
  type ProjectRoadmap,
  type RequirementKind,
  type RoadmapMilestone,
} from './roadmap.ts';

export type RoadmapAiMode = 'clarify' | 'spec' | 'improve';

export interface RoadmapAiAnswer {
  question: string;
  answer: string;
}

export interface RoadmapAiContext {
  projectName: string;
  projectDescription?: string;
  /** Current roadmap (so the model refines instead of duplicating). */
  roadmap?: ProjectRoadmap;
  /** Short lines describing inputs: file names, link titles, note excerpts. */
  inputs?: string[];
  /** Local date YYYY-MM-DD, for milestone scheduling hints. */
  today?: string;
  /** UI language name for the answer (e.g. "Russian"). */
  language?: string;
}

export interface RoadmapAiRequest {
  mode: RoadmapAiMode;
  /** Raw brief / intent dump (clarify, spec) or the text to improve (improve). */
  text: string;
  answers?: RoadmapAiAnswer[];
}

export interface ProposedMilestone {
  title: string;
  description: string;
  durationDays: number;
  stages: { title: string; substages: string[] }[];
}

export interface ProposedRequirement {
  kind: RequirementKind;
  text: string;
  acceptance: string[];
}

export interface RoadmapProposal {
  goal: string;
  expectedResult: string;
  doneCriteria: string[];
  milestones: ProposedMilestone[];
  requirements: ProposedRequirement[];
  risks: string[];
  openQuestions: string[];
}

export interface LlmPrompt {
  systemPrompt: string;
  prompt: string;
}

const BRIEF_CAP = 24_000;
const INPUT_LINES_CAP = 40;

function contextBlock(ctx: RoadmapAiContext): string {
  const lines: string[] = [`Project: ${ctx.projectName}`];
  if (ctx.projectDescription?.trim()) lines.push(`Description: ${ctx.projectDescription.trim()}`);
  if (ctx.today) lines.push(`Today: ${ctx.today}`);
  const current = ctx.roadmap ? roadmapToPromptText(ctx.roadmap, 4000) : null;
  if (current) lines.push('', 'Current roadmap (refine it, do not duplicate items already present):', current);
  const inputs = (ctx.inputs ?? []).filter(Boolean).slice(0, INPUT_LINES_CAP);
  if (inputs.length) lines.push('', 'Project inputs the user attached:', ...inputs.map((l) => `- ${l.slice(0, 600)}`));
  return lines.join('\n');
}

function languageRule(ctx: RoadmapAiContext): string {
  return `Write every string in ${ctx.language || 'the language of the brief'}.`;
}

export function buildClarifyPrompt(ctx: RoadmapAiContext, brief: string): LlmPrompt {
  return {
    systemPrompt: [
      'You are a senior project lead helping a person turn a raw idea into a deterministic project spec.',
      'Before writing the spec you ask the few clarifying questions whose answers most change the expected result:',
      'scope boundaries, target users, success metrics, deadlines, constraints, quality bar.',
      'Do not ask about things already stated in the brief or the current roadmap.',
      languageRule(ctx),
      'Answer with ONLY a JSON object: {"questions": ["...", "..."]} — 3 to 6 short, concrete questions. No prose, no code fences.',
    ].join('\n'),
    prompt: `${contextBlock(ctx)}\n\nBrief:\n${brief.trim().slice(0, BRIEF_CAP)}`,
  };
}

export function buildSpecPrompt(ctx: RoadmapAiContext, brief: string, answers: RoadmapAiAnswer[] = []): LlmPrompt {
  const qa = answers
    .filter((a) => a.question.trim() && a.answer.trim())
    .map((a) => `Q: ${a.question.trim()}\nA: ${a.answer.trim()}`)
    .join('\n\n');
  return {
    systemPrompt: [
      'You are a senior project lead. Transform the brief into a precise, verifiable project spec so the expected result is deterministic.',
      'Rules:',
      '- goal: one or two sentences, why the project exists.',
      '- expectedResult: what exactly exists when the project is done (the definition of done, as prose).',
      '- doneCriteria: 3-8 checkable statements; each must be objectively verifiable.',
      '- milestones: 2-6 ordered milestones; each with a realistic durationDays (integer), a one-line description, and 2-5 stages; stages may have 0-4 substages.',
      '- requirements: split by kind: "functional" (what it does), "technical" (stack, integrations, constraints),',
      '  "quantitative" (numbers: latency, volume, budget, deadlines), "qualitative" (UX, reliability, tone).',
      '  Every requirement has 1-3 acceptance criteria that can be tested.',
      '- risks: 2-6 concrete risks. openQuestions: what is still unknown and blocks certainty.',
      '- Never invent facts about the user\'s organisation; unknowns go to openQuestions.',
      languageRule(ctx),
      'Answer with ONLY a JSON object, no prose, no code fences, matching:',
      '{"goal":"","expectedResult":"","doneCriteria":[""],"milestones":[{"title":"","description":"","durationDays":7,"stages":[{"title":"","substages":[""]}]}],',
      '"requirements":[{"kind":"functional","text":"","acceptance":[""]}],"risks":[""],"openQuestions":[""]}',
    ].join('\n'),
    prompt: [
      contextBlock(ctx),
      '',
      'Brief:',
      brief.trim().slice(0, BRIEF_CAP),
      ...(qa ? ['', 'Clarifications from the user:', qa] : []),
    ].join('\n'),
  };
}

export function buildImprovePrompt(ctx: RoadmapAiContext, text: string): LlmPrompt {
  return {
    systemPrompt: [
      'You rewrite a project brief/description so it is clearer, more specific and more complete, ready to be decomposed into a spec.',
      'Keep the original intent and every concrete detail (names, numbers, dates, links). Make implicit expectations explicit.',
      'Do not add facts that are not implied. Do not answer or plan — only rewrite.',
      languageRule(ctx),
      'Return ONLY the improved text, no quotes, no headings about what you changed.',
    ].join('\n'),
    prompt: `${contextBlock(ctx)}\n\nText to improve:\n${text.trim().slice(0, BRIEF_CAP)}`,
  };
}

// ============================================================
// Parsing
// ============================================================

/** Extract the first JSON object from a model answer (tolerates fences and chatter). */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function strings(value: unknown, cap = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : v && typeof v === 'object' && typeof (v as { text?: unknown }).text === 'string' ? String((v as { text: string }).text).trim() : ''))
    .filter(Boolean)
    .slice(0, cap);
}

export function parseClarifyResponse(text: string): string[] {
  const parsed = extractJsonObject(text) as { questions?: unknown } | null;
  const fromJson = strings(parsed?.questions, 8);
  if (fromJson.length) return fromJson;
  // Fallback: numbered / bulleted lines ending with "?"
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.endsWith('?'))
    .slice(0, 8);
}

function kindOf(value: unknown): RequirementKind {
  const v = typeof value === 'string' ? value.toLowerCase().trim() : '';
  if (REQUIREMENT_KINDS.includes(v as RequirementKind)) return v as RequirementKind;
  if (v.startsWith('func') || v.startsWith('функ')) return 'functional';
  if (v.startsWith('tech') || v.startsWith('тех')) return 'technical';
  if (v.startsWith('quant') || v.startsWith('кол')) return 'quantitative';
  if (v.startsWith('qual') || v.startsWith('кач')) return 'qualitative';
  return 'functional';
}

export function emptyProposal(): RoadmapProposal {
  return { goal: '', expectedResult: '', doneCriteria: [], milestones: [], requirements: [], risks: [], openQuestions: [] };
}

export function isProposalEmpty(p: RoadmapProposal): boolean {
  return (
    !p.goal &&
    !p.expectedResult &&
    !p.doneCriteria.length &&
    !p.milestones.length &&
    !p.requirements.length &&
    !p.risks.length &&
    !p.openQuestions.length
  );
}

/** Parse a spec answer. Returns null when the answer holds no usable JSON. */
export function parseSpecResponse(text: string): RoadmapProposal | null {
  const raw = extractJsonObject(text);
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const milestones: ProposedMilestone[] = (Array.isArray(o.milestones) ? o.milestones : [])
    .map((m): ProposedMilestone | null => {
      const mo = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
      const title = typeof mo.title === 'string' ? mo.title.trim() : '';
      if (!title) return null;
      const d = Number(mo.durationDays);
      return {
        title,
        description: typeof mo.description === 'string' ? mo.description.trim() : '',
        durationDays: Number.isFinite(d) && d > 0 ? Math.min(365, Math.round(d)) : 7,
        stages: (Array.isArray(mo.stages) ? mo.stages : [])
          .map((s) => {
            if (typeof s === 'string') return s.trim() ? { title: s.trim(), substages: [] } : null;
            const so = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
            const st = typeof so.title === 'string' ? so.title.trim() : '';
            return st ? { title: st, substages: strings(so.substages, 8) } : null;
          })
          .filter((s): s is { title: string; substages: string[] } => s !== null)
          .slice(0, 10),
      };
    })
    .filter((m): m is ProposedMilestone => m !== null)
    .slice(0, 12);
  const requirements: ProposedRequirement[] = (Array.isArray(o.requirements) ? o.requirements : [])
    .map((r): ProposedRequirement | null => {
      const ro = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
      const t = typeof ro.text === 'string' ? ro.text.trim() : '';
      return t ? { kind: kindOf(ro.kind), text: t, acceptance: strings(ro.acceptance, 6) } : null;
    })
    .filter((r): r is ProposedRequirement => r !== null)
    .slice(0, 40);
  const proposal: RoadmapProposal = {
    goal: typeof o.goal === 'string' ? o.goal.trim() : '',
    expectedResult: typeof o.expectedResult === 'string' ? o.expectedResult.trim() : '',
    doneCriteria: strings(o.doneCriteria, 12),
    milestones,
    requirements,
    risks: strings(o.risks, 12),
    openQuestions: strings(o.openQuestions, 12),
  };
  return isProposalEmpty(proposal) ? null : proposal;
}

export function stripImprovedText(text: string): string {
  return text.trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').replace(/^["«](.*)["»]$/s, '$1').trim();
}

// ============================================================
// Per-item acceptance
// ============================================================

export type ProposalItemKey =
  | { section: 'goal' }
  | { section: 'expectedResult' }
  | { section: 'doneCriteria'; index: number }
  | { section: 'milestones'; index: number }
  | { section: 'requirements'; index: number }
  | { section: 'risks'; index: number }
  | { section: 'openQuestions'; index: number };

export function proposalItemId(key: ProposalItemKey): string {
  return 'index' in key ? `${key.section}:${key.index}` : key.section;
}

/** Every item in a proposal, in display order. */
export function proposalItemKeys(p: RoadmapProposal): ProposalItemKey[] {
  const keys: ProposalItemKey[] = [];
  if (p.goal) keys.push({ section: 'goal' });
  if (p.expectedResult) keys.push({ section: 'expectedResult' });
  p.doneCriteria.forEach((_, index) => keys.push({ section: 'doneCriteria', index }));
  p.milestones.forEach((_, index) => keys.push({ section: 'milestones', index }));
  p.requirements.forEach((_, index) => keys.push({ section: 'requirements', index }));
  p.risks.forEach((_, index) => keys.push({ section: 'risks', index }));
  p.openQuestions.forEach((_, index) => keys.push({ section: 'openQuestions', index }));
  return keys;
}

function lastScheduledDate(milestones: readonly RoadmapMilestone[]): string | undefined {
  let last: string | undefined;
  for (const m of milestones) {
    const d = m.dueDate ?? m.startDate;
    if (d && (!last || d > last)) last = d;
  }
  return last;
}

/**
 * Apply ONE accepted proposal item to the roadmap (returns a new roadmap).
 * Goal / expected result replace the current text (the UI shows the diff first);
 * list items are appended; milestones are scheduled after the last dated one.
 */
export function applyProposalItem(roadmap: ProjectRoadmap, proposal: RoadmapProposal, key: ProposalItemKey, today: string): ProjectRoadmap {
  const next = normalizeRoadmap(roadmap);
  switch (key.section) {
    case 'goal':
      next.goal = proposal.goal;
      break;
    case 'expectedResult':
      next.expectedResult = proposal.expectedResult;
      break;
    case 'doneCriteria': {
      const text = proposal.doneCriteria[key.index];
      if (text && !next.doneCriteria.some((c) => c.text === text)) next.doneCriteria.push({ id: roadmapId('dod'), text, done: false });
      break;
    }
    case 'risks': {
      const text = proposal.risks[key.index];
      if (text && !next.risks.some((c) => c.text === text)) next.risks.push({ id: roadmapId('rk'), text, done: false });
      break;
    }
    case 'openQuestions': {
      const text = proposal.openQuestions[key.index];
      if (text && !next.openQuestions.some((c) => c.text === text)) next.openQuestions.push({ id: roadmapId('oq'), text, done: false });
      break;
    }
    case 'requirements': {
      const r = proposal.requirements[key.index];
      if (r && !next.requirements.some((x) => x.text === r.text && x.kind === r.kind)) {
        next.requirements.push({ id: roadmapId('rq'), kind: r.kind, text: r.text, acceptance: [...r.acceptance] });
      }
      break;
    }
    case 'milestones': {
      const m = proposal.milestones[key.index];
      if (!m || next.milestones.some((x) => x.title === m.title)) break;
      const last = lastScheduledDate(next.milestones);
      const startDate = last ? addDays(last, 1) : today;
      next.milestones.push({
        id: roadmapId('ms'),
        title: m.title,
        description: m.description,
        status: 'planned',
        startDate,
        dueDate: addDays(startDate, Math.max(1, m.durationDays) - 1),
        stages: m.stages.map((s) => ({
          id: roadmapId('st'),
          title: s.title,
          done: false,
          substages: s.substages.map((title) => ({ id: roadmapId('ss'), title, done: false })),
        })),
        taskIds: [],
      });
      break;
    }
  }
  return next;
}

/** RPC answer of projects:aiRoadmap. */
export type RoadmapAiResponse =
  | { ok: true; mode: 'clarify'; questions: string[]; model?: string }
  | { ok: true; mode: 'spec'; proposal: RoadmapProposal; model?: string }
  | { ok: true; mode: 'improve'; text: string; model?: string }
  | { ok: false; error: string; unavailable?: boolean; raw?: string };
