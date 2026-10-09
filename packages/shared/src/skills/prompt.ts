/**
 * Available-skills prompt block
 *
 * A bounded, agent-facing catalog of the skills the current session may use.
 * Injected into the OMP spawn prompt (`--append-system-prompt`) so the model
 * can discover a skill and then load it through the `skills_read` host tool —
 * the catalog advertises; reading is explicit.
 *
 * Bounded on three axes so a 330-skill install cannot flood the prompt:
 * entry count, per-description length, and total bytes. Truncation is always
 * signposted so the model knows more skills exist behind `skills_search`.
 */

import type { LoadedSkill, SkillSource } from './types.ts';

export const AVAILABLE_SKILLS_MAX_ENTRIES = 64;
export const AVAILABLE_SKILLS_MAX_BYTES = 8000;
export const AVAILABLE_SKILLS_MAX_DESCRIPTION_CHARS = 200;

const OPEN_TAG = '<available_skills>';
const CLOSE_TAG = '</available_skills>';

/** Group order: most specific craft tier first, OMP last. */
const GROUP_ORDER: readonly SkillSource[] = ['project', 'workspace', 'global', 'omp'];

const GROUP_HEADINGS: Record<SkillSource, string> = {
  project: 'Project skills',
  workspace: 'Workspace skills',
  global: 'Global skills',
  omp: 'OMP skills',
};

export interface AvailableSkillsPromptOptions {
  maxEntries?: number;
  maxBytes?: number;
  maxDescriptionChars?: number;
}

function collapseDescription(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, maxChars - 1)}…`;
}

/**
 * Render the `<available_skills>` block, or null when there is nothing to
 * advertise. `skills` should already be gated (eligible only).
 */
export function buildAvailableSkillsBlock(
  skills: readonly LoadedSkill[],
  options?: AvailableSkillsPromptOptions,
): string | null {
  const maxEntries = options?.maxEntries ?? AVAILABLE_SKILLS_MAX_ENTRIES;
  const maxBytes = options?.maxBytes ?? AVAILABLE_SKILLS_MAX_BYTES;
  const maxDescriptionChars = options?.maxDescriptionChars ?? AVAILABLE_SKILLS_MAX_DESCRIPTION_CHARS;

  const usable = skills.filter(skill => !skill.shadowedByCraft);
  if (usable.length === 0) return null;

  const groups = new Map<SkillSource, LoadedSkill[]>();
  for (const source of GROUP_ORDER) groups.set(source, []);
  for (const skill of usable) groups.get(skill.source)?.push(skill);

  const header = [
    OPEN_TAG,
    'Skills are installed but their instructions load only when you read one. Search',
    'with `skills_search`, then load a skill with `skills_read` before following it.',
  ].join('\n');

  // The byte cap governs the WHOLE rendered block. Seed the running total with
  // the fixed header/footer plus a reserve wide enough for the omission notice,
  // so an over-long catalog shrinks entries rather than the notice overflowing.
  const RESERVED_OMISSION_BYTES = 96;
  let bytes = Buffer.byteLength(header, 'utf8') + 1 + Buffer.byteLength(CLOSE_TAG, 'utf8') + 1 + RESERVED_OMISSION_BYTES;
  const lines: string[] = [];
  let emitted = 0;
  let truncated = false;

  outer: for (const source of GROUP_ORDER) {
    const group = groups.get(source) ?? [];
    if (group.length === 0) continue;
    const heading = `## ${GROUP_HEADINGS[source]}`;
    const headingCost = Buffer.byteLength(heading, 'utf8') + 1;
    if (bytes + headingCost > maxBytes) {
      truncated = true;
      break;
    }
    lines.push(heading);
    bytes += headingCost;
    for (const skill of group) {
      if (emitted >= maxEntries) {
        truncated = true;
        break outer;
      }
      const description = collapseDescription(skill.metadata.description, maxDescriptionChars);
      const line = `- \`${skill.slug}\` — ${description} _(load: skills_read slug="${skill.slug}")_`;
      const cost = Buffer.byteLength(line, 'utf8') + 1;
      if (bytes + cost > maxBytes) {
        truncated = true;
        break outer;
      }
      lines.push(line);
      bytes += cost;
      emitted += 1;
    }
  }

  if (emitted === 0) return null;

  const omitted = usable.length - emitted;
  if (truncated || omitted > 0) {
    lines.push(`_(${Math.max(omitted, 0)} more skill(s) omitted — use skills_search to find them.)_`);
  }

  return [header, ...lines, CLOSE_TAG].join('\n');
}