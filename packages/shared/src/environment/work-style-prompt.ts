/**
 * Render the onboarding «Who are you?» answers as agent instructions.
 *
 * Pure: takes the stored role choice and returns a Markdown block (or '' when
 * there is nothing to say). `formatPreferencesForPrompt` appends it to the
 * user-preferences section of the system prompt, so the agent actually
 * follows the answers. Text is English on purpose: it is model-facing.
 */
import {
  normalizeWorkStyle,
  type Choice,
  type OnboardingRoleProfile,
  type WorkStyleAgent,
  type WorkStyleFormat,
} from './types.ts'

const AGENT_LABELS: Record<WorkStyleAgent, string> = {
  claudeCode: 'Claude Code CLI',
  codex: 'Codex CLI',
  opencode: 'opencode',
  omp: 'omp',
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
  cursor: 'Cursor',
  geminiCli: 'Gemini CLI',
  other: 'other agent tools',
}

const FORMAT_LABELS: Record<WorkStyleFormat, string> = {
  pdf: 'PDF',
  pptx: 'PPTX slides',
  xlsx: 'XLSX spreadsheets',
  htmlDashboard: 'HTML dashboards',
  markdown: 'Markdown',
  docs: 'documents (DOCX / Google Docs)',
}

const RELATED_ROLE_LABELS: Record<string, string> = {
  analyst: 'analyst',
  designer: 'designer',
  product: 'product manager',
}

export function formatWorkStyleForPrompt(role: Choice<OnboardingRoleProfile> | null | undefined): string {
  if (!role || role.status !== 'answered' || !role.value) return ''
  const profile = role.value
  const style = normalizeWorkStyle(profile.workStyle)
  const lines: string[] = []

  const roles = profile.relatedRoles.map((r) => RELATED_ROLE_LABELS[r]).filter(Boolean)
  // The developer flag defaults to false: only an explicit pick becomes an instruction.
  if (profile.isDeveloperExplicit === true) {
    lines.push(
      `- Background: ${profile.isDeveloper ? 'software developer' : 'not a developer — avoid unexplained jargon and code unless asked'}${roles.length ? `; also works as ${roles.join(', ')}` : ''}.`,
    )
  } else if (roles.length) {
    lines.push(`- Also works as ${roles.join(', ')}.`)
  }
  if (style?.agents?.length) {
    lines.push(`- Already uses these agent tools: ${style.agents.map((a) => AGENT_LABELS[a]).join(', ')}. Reference their conventions when relevant.`)
  }
  if (style?.formats?.length) {
    lines.push(`- Preferred deliverable formats: ${style.formats.map((f) => FORMAT_LABELS[f]).join(', ')}. When producing an artifact and the format is open, pick one of these.`)
  }
  if (style?.detail) {
    lines.push(style.detail === 'concise'
      ? '- Answer length: concise — lead with the answer, skip preamble and repetition.'
      : '- Answer length: detailed — explain reasoning, trade-offs and context.')
  }
  if (style?.layout) {
    lines.push(style.layout === 'bullets'
      ? '- Answer layout: prefer bullet points and short sections.'
      : '- Answer layout: prefer flowing prose paragraphs over bullet lists.')
  }
  if (style?.clarify) {
    lines.push(style.clarify === 'askFirst'
      ? '- Before starting non-trivial work, ask the clarifying questions you need.'
      : '- Act autonomously: make reasonable assumptions, state them, and proceed without asking first.')
  }
  if (style?.collaboration) {
    lines.push(style.collaboration === 'reasonTogether'
      ? '- Collaboration: think through the problem together with the user — share options and reasoning.'
      : '- Collaboration: just deliver the result; keep the reasoning brief unless asked.')
  }
  if (lines.length === 0) return ''
  return ['### How this user wants you to work', ...lines].join('\n')
}
