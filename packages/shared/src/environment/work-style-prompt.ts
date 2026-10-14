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
  type WorkStyleScaleKey,
  WORK_STYLE_SCALES,
  WORK_STYLE_SCALE_MAX,
} from './types.ts'

const AGENT_LABELS: Record<WorkStyleAgent, string> = {
  claudeCode: 'Claude Code',
  codex: 'Codex CLI',
  opencode: 'OpenCode',
  omp: 'OMP',
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
  cursor: 'Cursor',
  geminiCli: 'Gemini CLI',
  antigravity: 'Antigravity CLI',
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
  grok: 'Grok',
  qwen: 'Qwen',
  deepseek: 'DeepSeek',
  gigachat: 'GigaChat',
  zai: 'Z.ai',
  kimi: 'Kimi',
  mistral: 'Mistral',
  copilot: 'GitHub Copilot',
  windsurf: 'Windsurf',
  kiloCode: 'Kilo Code',
  cline: 'Cline',
  rooCode: 'Roo Code',
  aider: 'Aider',
  other: 'other agent tools',
}

const FORMAT_LABELS: Record<WorkStyleFormat, string> = {
  chat: 'a plain chat answer (no file)',
  docx: 'DOCX documents',
  json: 'JSON',
  office: 'office documents (Word / Excel / PowerPoint)',
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
  dataScientist: 'data scientist',
  mlEngineer: 'ML engineer',
  devops: 'DevOps / SRE engineer',
  qa: 'QA engineer',
  security: 'security engineer',
  projectManager: 'project manager',
  founder: 'founder',
  executive: 'executive',
  marketer: 'marketer',
  sales: 'sales',
  support: 'customer support',
  researcher: 'researcher',
  scientist: 'scientist',
  student: 'student',
  teacher: 'teacher',
  writer: 'writer / editor',
  creator: 'content creator',
  lawyer: 'lawyer',
  finance: 'finance / accounting',
  hr: 'HR / recruiting',
  doctor: 'medical professional',
  consultant: 'consultant',
  engineer: 'hardware engineer',
  operations: 'operations',
}

/** [left, right] meaning of each 0–10 slider, model-facing. */
const SCALE_AXES: Record<WorkStyleScaleKey, { label: string; left: string; right: string }> = {
  detail: { label: 'Answer length', left: 'very concise', right: 'very detailed' },
  layout: { label: 'Answer layout', left: 'flowing prose', right: 'bullet lists and short sections' },
  tone: { label: 'Tone', left: 'reserved and neutral', right: 'warm and friendly' },
  formality: { label: 'Register', left: 'formal', right: 'informal / casual' },
  clarify: { label: 'Before starting', left: 'ask clarifying questions first', right: 'act autonomously on reasonable assumptions' },
  collaboration: { label: 'Collaboration', left: 'reason through it together with the user', right: 'just deliver the result with brief reasoning' },
}

function describeScale(key: WorkStyleScaleKey, value: number): string {
  const axis = SCALE_AXES[key]
  const lean = value <= 3 ? `lean strongly towards ${axis.left}`
    : value <= 4 ? `lean slightly towards ${axis.left}`
      : value === 5 ? 'balanced between both'
        : value <= 6 ? `lean slightly towards ${axis.right}`
          : `lean strongly towards ${axis.right}`
  return `- ${axis.label}: ${value}/${WORK_STYLE_SCALE_MAX} on a scale from ${axis.left} (0) to ${axis.right} (${WORK_STYLE_SCALE_MAX}) — ${lean}.`
}

export function formatWorkStyleForPrompt(role: Choice<OnboardingRoleProfile> | null | undefined): string {
  if (!role || role.status !== 'answered' || !role.value) return ''
  const profile = role.value
  const style = normalizeWorkStyle(profile.workStyle)
  const lines: string[] = []

  const roles = profile.relatedRoles.map((r) => RELATED_ROLE_LABELS[r]).filter(Boolean)
  // Free text is user-typed: quote it and keep it on one line.
  const otherRole = typeof profile.otherRole === 'string' ? profile.otherRole.replace(/[\r\n"]/g, ' ').trim() : ''
  if (otherRole) roles.push(`"${otherRole}"`)
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
    const primary = style.primaryFormat
    lines.push(primary
      ? `- Preferred result format: ${FORMAT_LABELS[primary]} by default${style.formats.length > 1 ? `; also fine: ${style.formats.filter((f) => f !== primary).map((f) => FORMAT_LABELS[f]).join(', ')}` : ''}.`
      : `- Preferred deliverable formats: ${style.formats.map((f) => FORMAT_LABELS[f]).join(', ')}. When producing an artifact and the format is open, pick one of these.`)
  }
  const scales = style?.scales ?? {}
  for (const key of WORK_STYLE_SCALES) {
    const value = scales[key]
    if (typeof value === 'number') lines.push(describeScale(key, value))
  }
  if (style?.detail && scales.detail === undefined) {
    lines.push(style.detail === 'concise'
      ? '- Answer length: concise — lead with the answer, skip preamble and repetition.'
      : '- Answer length: detailed — explain reasoning, trade-offs and context.')
  }
  if (style?.layout && scales.layout === undefined) {
    lines.push(style.layout === 'bullets'
      ? '- Answer layout: prefer bullet points and short sections.'
      : '- Answer layout: prefer flowing prose paragraphs over bullet lists.')
  }
  if (style?.clarify && scales.clarify === undefined) {
    lines.push(style.clarify === 'askFirst'
      ? '- Before starting non-trivial work, ask the clarifying questions you need.'
      : '- Act autonomously: make reasonable assumptions, state them, and proceed without asking first.')
  }
  if (style?.collaboration && scales.collaboration === undefined) {
    lines.push(style.collaboration === 'reasonTogether'
      ? '- Collaboration: think through the problem together with the user — share options and reasoning.'
      : '- Collaboration: just deliver the result; keep the reasoning brief unless asked.')
  }
  if (lines.length === 0) return ''
  return ['### How this user wants you to work', ...lines].join('\n')
}
