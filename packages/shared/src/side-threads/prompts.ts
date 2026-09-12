export const SIDE_THREAD_ACTIONS = [
  'grill',
  'challenge',
  'verify',
  'counterarguments',
  'rewrite',
  'research',
  'concise',
] as const

export type SideThreadAction = (typeof SIDE_THREAD_ACTIONS)[number]

export const META_PROMPT_SECTIONS = [
  'intent',
  'examples',
  'constraints',
  'requirements',
  'skills',
  'risk',
  'evidence',
  'outputSchema',
  'hardness',
] as const

export type MetaPromptSection = (typeof META_PROMPT_SECTIONS)[number]

export const META_PROMPT_SECTION_TITLES: Record<MetaPromptSection, string> = {
  intent: 'Intent',
  examples: 'Examples',
  constraints: 'Constraints',
  requirements: 'Requirements',
  skills: 'Skills',
  risk: 'Risk',
  evidence: 'Evidence',
  outputSchema: 'Output schema',
  hardness: 'Hardness',
}

const ACTION_META: Record<
  SideThreadAction,
  { intent: string; hardness: string; requirements: string; risk: string }
> = {
  grill: {
    intent: 'Strictly verify the source answer. Attack weak claims, demand evidence, and refuse to rubber-stamp.',
    hardness: 'high',
    requirements: 'List failures first. Cite the source passage for every objection.',
    risk: 'Do not invent facts. Mark speculation explicitly.',
  },
  challenge: {
    intent: 'Challenge the source answer: find the strongest counter-case and where it would fail.',
    hardness: 'high',
    requirements: 'Give the best opposing argument, then a fair residual-confidence note.',
    risk: 'Stay on the original claim. No unrelated debates.',
  },
  verify: {
    intent: 'Independently verify the source answer against checkable claims.',
    hardness: 'medium',
    requirements: 'Mark each claim as confirmed, contradicted, or unverifiable.',
    risk: 'Do not treat missing evidence as confirmation.',
  },
  counterarguments: {
    intent: 'Produce the strongest counterarguments to the source answer.',
    hardness: 'medium',
    requirements: 'At least three distinct counters, ranked by force.',
    risk: 'Do not strawman. Steelman the source first in one sentence.',
  },
  rewrite: {
    intent: 'Rewrite the source answer so it is clearer, tighter, and still faithful.',
    hardness: 'low',
    requirements: 'Preserve meaning. Improve structure and remove filler.',
    risk: 'Do not add new claims.',
  },
  research: {
    intent: 'Research the source answer: what to check next and which sources would decide it.',
    hardness: 'medium',
    requirements: 'List open questions, search queries, and what evidence would change the conclusion.',
    risk: 'Do not pretend to have fetched live sources unless tools are used.',
  },
  concise: {
    intent: 'Reply to the source answer as concisely as possible without losing the decision.',
    hardness: 'low',
    requirements: 'At most 8 lines. Lead with the conclusion.',
    risk: 'Do not drop caveats that change the decision.',
  },
}

export type SideThreadPromptInput = {
  action: SideThreadAction
  sourceText: string
  sourceMessageId: string
  sourceSessionId: string
}

function renderSections(values: Record<MetaPromptSection, string>): string {
  return META_PROMPT_SECTIONS.map((key) => `## ${META_PROMPT_SECTION_TITLES[key]}\n${values[key].trim()}`).join('\n\n')
}

export function buildSideThreadPrompt(input: SideThreadPromptInput): string {
  const meta = ACTION_META[input.action]
  const excerpt = input.sourceText.trim() || '(empty message)'
  const values: Record<MetaPromptSection, string> = {
    intent: meta.intent,
    examples: 'Treat the source message as the only starting artifact. Quote it when objecting.',
    constraints: [
      `Stay attached to source message ${input.sourceMessageId} in session ${input.sourceSessionId}.`,
      'Do not silently switch topics.',
    ].join('\n'),
    requirements: meta.requirements,
    skills: 'Use verification, structured critique, and explicit uncertainty.',
    risk: meta.risk,
    evidence: 'Prefer quotes from the source. Separate evidence from inference.',
    outputSchema: [
      '- verdict',
      '- findings[] (claim, status, note)',
      '- next_checks[]',
    ].join('\n'),
    hardness: meta.hardness,
  }

  return [
    `# Side thread: ${input.action}`,
    '',
    '## Source provenance',
    `- sessionId: ${input.sourceSessionId}`,
    `- messageId: ${input.sourceMessageId}`,
    '',
    '## Source message',
    excerpt,
    '',
    renderSections(values),
  ].join('\n')
}

export function improvePromptWithMeta(draft: string): string {
  const trimmed = draft.trim()
  const values: Record<MetaPromptSection, string> = {
    intent: trimmed || 'Clarify the user request and produce a complete, checkable answer.',
    examples: trimmed
      ? 'Follow the draft as the primary example of desired work.'
      : 'If the user later adds examples, obey them over defaults.',
    constraints: 'Keep the original user wording unless it is ambiguous. Do not drop constraints present in the draft.',
    requirements: 'Cover the draft fully. Ask only if a missing input blocks the answer.',
    skills: 'Planning, tool use when needed, and explicit uncertainty.',
    risk: 'Do not invent sources, credentials, or completed work.',
    evidence: 'Cite files, quotes, or tool results when making factual claims.',
    outputSchema: 'Match the format implied by the draft. Default to short sections with a final answer.',
    hardness: trimmed.length > 800 ? 'high' : trimmed.length > 200 ? 'medium' : 'low',
  }

  return [`# Improved prompt`, '', renderSections(values)].join('\n')
}

export function isSideThreadAction(value: string): value is SideThreadAction {
  return (SIDE_THREAD_ACTIONS as readonly string[]).includes(value)
}
