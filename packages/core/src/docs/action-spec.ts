/**
 * Declarative ActionSpec helpers (LSX-WP-033 narrow slice).
 *
 * Docs action buttons are typed configs only. Imported fences stay inert until
 * reviewed. This module never executes JS/shell/network — it only validates,
 * normalizes, and serializes safe declarative payloads.
 */

export const ACTION_KINDS = [
  'command',
  'entityLink',
  'template',
  'appendBlock',
  'safeFormula',
  'workflow',
] as const

export type ActionKind = (typeof ACTION_KINDS)[number]

export type ActionReviewState = 'unreviewed' | 'reviewed'

/** Presentation-only chrome; never a durable execution receipt. */
export type ActionPresentationState =
  | 'inert'
  | 'default'
  | 'pending'
  | 'success'
  | 'failure'
  | 'offline'

export type ActionFailurePolicy = 'stopOnError' | 'continueOnError'

export interface ActionSpec {
  kind: ActionKind
  /** Safe plain-text label (no HTML / scripts). */
  label: string
  reviewState: ActionReviewState
  failurePolicy: ActionFailurePolicy
  /** Registered command id (kind=command). */
  commandId?: string
  /** Entity ref target (kind=entityLink). */
  entityRef?: string
  /** Template id (kind=template). */
  templateId?: string
  /** Append-block kind id (kind=appendBlock). */
  blockKind?: string
  /** Bounded safe formula expression id/text (kind=safeFormula) — never eval. */
  formula?: string
  /** Workflow ref (kind=workflow). */
  workflowRef?: string
  /** Typed mapped values; nested objects rejected. */
  inputs?: Record<string, string | number | boolean | null>
  /**
   * True when inbound payload contained rejected raw script/eval/shell/HTML.
   * Always forces inert presentation; never grants execution.
   */
  rejectedUnsafe: boolean
  /** Optional retained inbound marker (language tag), for lossless export. */
  sourceLanguage?: string
}

export type ActionSpecValidationIssue =
  | 'invalid-shape'
  | 'unknown-kind'
  | 'unsafe-payload'
  | 'unsafe-label'
  | 'missing-target'
  | 'invalid-inputs'

export type ActionSpecParseResult =
  | { ok: true; spec: ActionSpec }
  | { ok: false; issues: ActionSpecValidationIssue[]; inertSpec: ActionSpec }

const ACTION_KIND_SET = new Set<string>(ACTION_KINDS)

const KIND_ALIASES: Readonly<Record<string, ActionKind>> = {
  command: 'command',
  cmd: 'command',
  entitylink: 'entityLink',
  'entity-link': 'entityLink',
  entity: 'entityLink',
  link: 'entityLink',
  template: 'template',
  'create-from-template': 'template',
  appendblock: 'appendBlock',
  'append-block': 'appendBlock',
  append: 'appendBlock',
  block: 'appendBlock',
  safeformula: 'safeFormula',
  'safe-formula': 'safeFormula',
  formula: 'safeFormula',
  workflow: 'workflow',
  flow: 'workflow',
}

/** Obsidian Buttons / inbound fence language tags we accept as action fences. */
export const ACTION_FENCE_LANGUAGES = new Set([
  'rox-action',
  'rox-button',
  'button',
  'buttons',
])

const UNSAFE_KEY_RE =
  /^(script|eval|shell|javascript|node|bash|powershell|cmd|exec|spawn|child_process|onload|onclick|onerror|rawjs|js|templater)$/i

const UNSAFE_TYPE_RE = /^(js|javascript|shell|bash|powershell|cmd|eval|templater|raw)$/i

const HTML_TAG_RE = /<\/?[a-z][^>]*>/gi
const EVENT_HANDLER_RE = /\bon[a-z]+\s*=/i
const UNSAFE_URL_RE = /^\s*(javascript|data|vbscript):/i
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

const MAX_LABEL = 200
const MAX_ID = 256
const MAX_FORMULA = 512
const MAX_INPUT_KEYS = 32
const MAX_INPUT_STRING = 1024

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function canonicalizeActionKind(raw: unknown): ActionKind | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim().toLowerCase()
  if (ACTION_KIND_SET.has(key)) return key as ActionKind
  return KIND_ALIASES[key] ?? null
}

export function isActionFenceLanguage(lang: unknown): boolean {
  if (typeof lang !== 'string') return false
  return ACTION_FENCE_LANGUAGES.has(lang.trim().toLowerCase())
}

/** Strip HTML/tags/control chars; plain text only. */
export function sanitizeActionLabel(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const stripped = raw
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\bon[a-z]+\s*=/gi, '')
    .replace(CONTROL_CHARS_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (/^\s*(javascript|data|vbscript):/i.test(stripped)) return ''
  return stripped.slice(0, MAX_LABEL)
}

export function labelLooksUnsafe(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  if (/<\/?[a-z][^>]*>/i.test(raw) || /\bon[a-z]+\s*=/i.test(raw)) return true
  if (/^\s*(javascript|data|vbscript):/i.test(raw.trim())) return true
  return false
}

function clampId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.replace(CONTROL_CHARS_RE, '').trim()
  if (!value || value.length > MAX_ID) return undefined
  if (UNSAFE_URL_RE.test(value)) return undefined
  return value
}

function normalizeInputs(
  raw: unknown,
): { inputs?: ActionSpec['inputs']; unsafe: boolean } {
  if (raw === undefined || raw === null) return { unsafe: false }
  if (!isPlainObject(raw)) return { unsafe: true }
  const entries = Object.entries(raw)
  if (entries.length > MAX_INPUT_KEYS) return { unsafe: true }
  const inputs: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of entries) {
    if (typeof key !== 'string' || !key || key.length > 64) return { unsafe: true }
    if (UNSAFE_KEY_RE.test(key)) return { unsafe: true }
    if (value === null || typeof value === 'boolean') {
      inputs[key] = value
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      inputs[key] = value
      continue
    }
    if (typeof value === 'string') {
      if (value.length > MAX_INPUT_STRING) return { unsafe: true }
      const lower = value.toLowerCase()
      if (
        UNSAFE_URL_RE.test(value) ||
        EVENT_HANDLER_RE.test(value) ||
        /<\/?[a-z][^>]*>/i.test(value) ||
        lower.includes('eval(') ||
        lower.includes('function(') ||
        lower.includes('new function')
      ) {
        return { unsafe: true }
      }
      inputs[key] = value.replace(CONTROL_CHARS_RE, '')
      continue
    }
    // Nested objects/arrays/functions are rejected (no eval surface).
    return { unsafe: true }
  }
  return { inputs, unsafe: false }
}

function objectHasUnsafeKeys(raw: Record<string, unknown>): boolean {
  for (const key of Object.keys(raw)) {
    if (UNSAFE_KEY_RE.test(key)) return true
  }
  const typeRaw = raw.type ?? raw.actionType ?? raw.kind
  if (typeof typeRaw === 'string' && UNSAFE_TYPE_RE.test(typeRaw.trim())) return true
  for (const key of ['action', 'code', 'body', 'source', 'command']) {
    const value = raw[key]
    if (typeof value === 'string') {
      const lower = value.toLowerCase()
      if (lower.includes('eval(') || lower.includes('function(')) return true
      if (lower.includes('=>') && lower.includes('require(')) return true
      const hasSubshell = /\$\(/.test(value) || /`[^`]+`/.test(value)
      if (hasSubshell && /(?:rm|curl|wget|bash|\bsh)\s/.test(lower)) return true
    }
  }
  return false
}

function defaultInertSpec(partial?: Partial<ActionSpec>): ActionSpec {
  return {
    kind: partial?.kind ?? 'command',
    label: sanitizeActionLabel(partial?.label) || 'Action',
    reviewState: 'unreviewed',
    failurePolicy: 'stopOnError',
    rejectedUnsafe: true,
    sourceLanguage: partial?.sourceLanguage,
    commandId: partial?.commandId,
    entityRef: partial?.entityRef,
    templateId: partial?.templateId,
    blockKind: partial?.blockKind,
    formula: partial?.formula,
    workflowRef: partial?.workflowRef,
    inputs: partial?.inputs,
  }
}

function requiredTarget(kind: ActionKind, spec: Partial<ActionSpec>): boolean {
  switch (kind) {
    case 'command':
      return Boolean(spec.commandId)
    case 'entityLink':
      return Boolean(spec.entityRef)
    case 'template':
      return Boolean(spec.templateId)
    case 'appendBlock':
      return Boolean(spec.blockKind)
    case 'safeFormula':
      return Boolean(spec.formula)
    case 'workflow':
      return Boolean(spec.workflowRef)
  }
}

/**
 * Normalize an unknown declarative payload into a typed ActionSpec.
 * Never executes anything. Unsafe inbound material becomes inert.
 */
export function normalizeActionSpec(
  raw: unknown,
  options?: { imported?: boolean; sourceLanguage?: string },
): ActionSpecParseResult {
  const imported = options?.imported === true

  if (!isPlainObject(raw)) {
    const inertSpec = defaultInertSpec({
      label: 'Action',
      sourceLanguage: options?.sourceLanguage,
    })
    return { ok: false, issues: ['invalid-shape'], inertSpec }
  }

  const rawSource =
    typeof raw.sourceLanguage === 'string' ? raw.sourceLanguage.replace(CONTROL_CHARS_RE, '').trim() : ''
  const sourceLanguage =
    options?.sourceLanguage ??
    (rawSource ? rawSource.toLowerCase() : undefined)

  const issues: ActionSpecValidationIssue[] = []
  // Preserve previously-flagged unsafe imports across serialize → re-parse
  // (serialize strips raw script keys but keeps rejectedUnsafe:true).
  if (raw.rejectedUnsafe === true) issues.push('unsafe-payload')
  const unsafeKeys = objectHasUnsafeKeys(raw)
  if (unsafeKeys) issues.push('unsafe-payload')

  const kind = canonicalizeActionKind(raw.kind ?? raw.type ?? raw.actionType)
  if (!kind) issues.push('unknown-kind')

  const labelRaw = raw.label ?? raw.name ?? raw.title
  if (labelLooksUnsafe(labelRaw)) issues.push('unsafe-label')
  const label = sanitizeActionLabel(labelRaw) || (kind ? defaultLabelForKind(kind) : 'Action')

  const { inputs, unsafe: unsafeInputs } = normalizeInputs(raw.inputs ?? raw.args ?? raw.params)
  if (unsafeInputs) issues.push('invalid-inputs')

  const failurePolicy: ActionFailurePolicy =
    raw.failurePolicy === 'continueOnError' ||
    raw.stopOnError === false ||
    raw.continueOnError === true
      ? 'continueOnError'
      : 'stopOnError'

  const reviewRaw = raw.reviewState ?? raw.reviewed
  let reviewState: ActionReviewState =
    reviewRaw === 'reviewed' || reviewRaw === true ? 'reviewed' : 'unreviewed'
  if (imported) reviewState = 'unreviewed'

  const commandId = clampId(raw.commandId ?? raw.command ?? (kind === 'command' ? raw.action : undefined))
  const entityRef = clampId(raw.entityRef ?? raw.ref ?? raw.target)
  const templateId = clampId(raw.templateId ?? raw.template)
  const blockKind = clampId(raw.blockKind ?? raw.block)
  let formula = typeof raw.formula === 'string' ? raw.formula.replace(CONTROL_CHARS_RE, '').trim() : undefined
  if (formula && formula.length > MAX_FORMULA) formula = formula.slice(0, MAX_FORMULA)
  // Mirror normalizeInputs: reject eval(/function(/HTML (and event-handler/URL) — never store eval-shaped formula.
  if (formula) {
    const lower = formula.toLowerCase()
    if (
      EVENT_HANDLER_RE.test(formula) ||
      UNSAFE_URL_RE.test(formula) ||
      /<\/?[a-z][^>]*>/i.test(formula) ||
      lower.includes('eval(') ||
      lower.includes('function(') ||
      lower.includes('new function')
    ) {
      issues.push('unsafe-payload')
      formula = undefined
    }
  }
  const workflowRef = clampId(raw.workflowRef ?? raw.workflow)

  const candidate: ActionSpec = {
    kind: kind ?? 'command',
    label,
    reviewState,
    failurePolicy,
    rejectedUnsafe: false,
    sourceLanguage,
    ...(commandId ? { commandId } : {}),
    ...(entityRef ? { entityRef } : {}),
    ...(templateId ? { templateId } : {}),
    ...(blockKind ? { blockKind } : {}),
    ...(formula ? { formula } : {}),
    ...(workflowRef ? { workflowRef } : {}),
    ...(inputs ? { inputs } : {}),
  }

  if (kind && !requiredTarget(kind, candidate)) issues.push('missing-target')

  // rejectedUnsafe is ONLY for unsafe-payload / unsafe-label / invalid-inputs.
  // missing-target alone (slash unreviewed drafts omit commandId) is a clean draft.
  const rejectedUnsafe =
    issues.includes('unsafe-payload') ||
    issues.includes('unsafe-label') ||
    issues.includes('invalid-inputs')

  if (rejectedUnsafe) {
    const inertSpec: ActionSpec = {
      ...candidate,
      reviewState: 'unreviewed',
      rejectedUnsafe: true,
    }
    return { ok: false, issues, inertSpec }
  }

  if (!kind || issues.includes('unknown-kind')) {
    const inertSpec: ActionSpec = {
      ...candidate,
      reviewState: 'unreviewed',
      rejectedUnsafe: false,
    }
    return { ok: false, issues: issues.length ? issues : ['unknown-kind'], inertSpec }
  }

  if (issues.includes('missing-target')) {
    // Unreviewed + missing-target = clean draft; inert via reviewState, not rejectedUnsafe.
    if (candidate.reviewState === 'unreviewed') {
      return { ok: true, spec: { ...candidate, rejectedUnsafe: false } }
    }
    const inertSpec: ActionSpec = {
      ...candidate,
      reviewState: 'unreviewed',
      rejectedUnsafe: false,
    }
    return { ok: false, issues, inertSpec }
  }

  return { ok: true, spec: candidate }
}

function defaultLabelForKind(kind: ActionKind): string {
  switch (kind) {
    case 'command':
      return 'Command'
    case 'entityLink':
      return 'Open entity'
    case 'template':
      return 'From template'
    case 'appendBlock':
      return 'Append block'
    case 'safeFormula':
      return 'Formula'
    case 'workflow':
      return 'Workflow'
  }
}

/**
 * Parse a fenced action body (JSON preferred; Obsidian-like key lines fallback).
 * Imported fences always normalize to unreviewed/inert until reviewed.
 */
export function parseActionFenceBody(
  body: string,
  options?: { language?: string; imported?: boolean },
): ActionSpecParseResult {
  const language = options?.language?.trim().toLowerCase()
  const imported =
    options?.imported === true ||
    language === 'button' ||
    language === 'buttons' ||
    language === 'rox-button'

  const trimmed = body.replace(/^\uFEFF/, '').trim()
  if (!trimmed) {
    return {
      ok: false,
      issues: ['invalid-shape'],
      inertSpec: defaultInertSpec({ sourceLanguage: language }),
    }
  }

  // JSON object body
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      return normalizeActionSpec(parsed, {
        imported,
        sourceLanguage: language && language !== 'rox-action' ? language : undefined,
      })
    } catch {
      return {
        ok: false,
        issues: ['invalid-shape'],
        inertSpec: defaultInertSpec({ label: 'Action', sourceLanguage: language }),
      }
    }
  }

  // Obsidian Buttons-style key lines: name / type / action
  const lines = trimmed.split(/\r?\n/)
  const map: Record<string, string> = {}
  for (const line of lines) {
    const match = /^\s*([A-Za-z][\w-]*)\s*[:=]\s*(.*)\s*$/.exec(line)
    if (!match) continue
    map[match[1]!.toLowerCase()] = match[2] ?? ''
  }
  if (Object.keys(map).length === 0) {
    return {
      ok: false,
      issues: ['invalid-shape'],
      inertSpec: defaultInertSpec({ sourceLanguage: language }),
    }
  }

  const type = map.type ?? map.kind ?? map.actiontype
  const action = map.action ?? map.command ?? map.target
  const payload: Record<string, unknown> = {
    kind: type,
    type,
    label: map.name ?? map.label ?? map.title,
    action,
    command: type && UNSAFE_TYPE_RE.test(type) ? undefined : action,
    commandId: type === 'command' || type === 'cmd' ? action : map.commandid,
    entityRef: map.entityref ?? map.ref,
    templateId: map.templateid ?? map.template,
    blockKind: map.blockkind ?? map.block,
    formula: map.formula,
    workflowRef: map.workflowref ?? map.workflow,
  }
  return normalizeActionSpec(payload, { imported: true, sourceLanguage: language ?? 'button' })
}

/** Lossless-ish JSON serialize of safe attrs only (no rejectedUnsafe noise unless true). */
export function serializeActionSpec(spec: ActionSpec): string {
  const payload: Record<string, unknown> = {
    kind: spec.kind,
    label: sanitizeActionLabel(spec.label) || defaultLabelForKind(spec.kind),
    reviewState: spec.reviewState,
    failurePolicy: spec.failurePolicy,
  }
  if (spec.commandId) payload.commandId = spec.commandId
  if (spec.entityRef) payload.entityRef = spec.entityRef
  if (spec.templateId) payload.templateId = spec.templateId
  if (spec.blockKind) payload.blockKind = spec.blockKind
  if (spec.formula) payload.formula = spec.formula
  if (spec.workflowRef) payload.workflowRef = spec.workflowRef
  if (spec.inputs && Object.keys(spec.inputs).length > 0) payload.inputs = spec.inputs
  if (spec.rejectedUnsafe) payload.rejectedUnsafe = true
  if (spec.sourceLanguage && spec.sourceLanguage !== 'rox-action') {
    payload.sourceLanguage = spec.sourceLanguage
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

export function renderActionFenceMarkdown(spec: ActionSpec, _language = 'rox-action'): string {
  // Always canonicalize fence language to rox-action. Review state lives in
  // attrs/metadata only — never dual langs (inbound button → rox-action).
  void _language
  const body = serializeActionSpec(spec).replace(/\n$/, '')
  return `\`\`\`rox-action\n${body}\n\`\`\``
}

/** Basic/export representation stays declarative and inert — never a fake success. */
export function renderActionBasicExport(spec: ActionSpec): string {
  const label = sanitizeActionLabel(spec.label) || defaultLabelForKind(spec.kind)
  const state = presentationStateForSpec(spec)
  const imported =
    spec.rejectedUnsafe ||
    (typeof spec.sourceLanguage === 'string' &&
      spec.sourceLanguage.trim().toLowerCase() !== 'rox-action')
  const note =
    state === 'inert'
      ? imported
        ? 'inert (unreviewed import — not executed)'
        : 'inert (unreviewed draft — not executed)'
      : 'declarative action (client export — not executed)'
  return `[Action: ${label} · ${spec.kind} · ${note}]`
}

export function presentationStateForSpec(spec: ActionSpec): ActionPresentationState {
  if (spec.rejectedUnsafe || spec.reviewState === 'unreviewed') return 'inert'
  return 'default'
}

/**
 * Client-only click helper: may enter pending, never invents side effects or
 * success receipts. Duplicate activate while pending is a no-op.
 */
export type ClientActionUiState = {
  presentation: ActionPresentationState
  attemptId: number
}

export function createClientActionUiState(spec: ActionSpec): ClientActionUiState {
  return { presentation: presentationStateForSpec(spec), attemptId: 0 }
}

export function beginClientActionAttempt(
  spec: ActionSpec,
  ui: ClientActionUiState,
): { ui: ClientActionUiState; accepted: boolean; reason?: 'inert' | 'pending' | 'offline' } {
  const base = presentationStateForSpec(spec)
  if (base === 'inert') {
    return { ui: { ...ui, presentation: 'inert' }, accepted: false, reason: 'inert' }
  }
  if (ui.presentation === 'pending') {
    return { ui, accepted: false, reason: 'pending' }
  }
  if (ui.presentation === 'offline') {
    return { ui, accepted: false, reason: 'offline' }
  }
  return {
    ui: { presentation: 'pending', attemptId: ui.attemptId + 1 },
    accepted: true,
  }
}

/**
 * Clear pending without claiming success/failure unless caller supplies an
 * explicit presentation (still no side effects here).
 */
export function settleClientActionAttempt(
  spec: ActionSpec,
  ui: ClientActionUiState,
  next: Exclude<ActionPresentationState, 'pending'> = 'default',
): ClientActionUiState {
  if (presentationStateForSpec(spec) === 'inert') {
    return { ...ui, presentation: 'inert' }
  }
  if (next === 'success' || next === 'failure') {
    // This slice has no durable receipt pipeline — refuse to invent committed outcomes.
    return { ...ui, presentation: 'default' }
  }
  return { ...ui, presentation: next }
}

/** Read-only probe helper: list command ids from a registry-like map. */
export function listAvailableCommandIds(
  registry: { get?: (id: string) => unknown; query?: (q: { text?: string }, keys?: unknown) => Array<{ id: string }> } | Iterable<string> | readonly string[],
): string[] {
  if (Array.isArray(registry) || (typeof registry === 'object' && registry !== null && Symbol.iterator in registry && !('query' in registry) && !('get' in registry))) {
    return [...(registry as Iterable<string>)].filter((id) => typeof id === 'string' && id.length > 0)
  }
  const query = (registry as { query?: Function }).query
  if (typeof query === 'function') {
    try {
      const rows = query.call(registry, {}, {}) as Array<{ id?: string }>
      return rows.map((row) => row.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
    } catch {
      return []
    }
  }
  return []
}
