/**
 * Agent browser inspection: grab, annotate, preview edits, destructive
 * approval, and stale-selector recovery (Rox tracker Issue 16).
 *
 * Preview edits and destructive actions stay staged until explicit approval.
 * Grab/annotate never mutate the live page.
 */

export type InspectEditKind = 'text' | 'style' | 'property'
export type DestructiveKind = 'submit' | 'purchase' | 'publish'

export interface StableSelector {
  css: string
  ref?: string
  role?: string
  name?: string
  fallbacks: string[]
}

export interface LiveElement {
  selector?: string
  ref?: string
  role?: string
  name?: string
  id?: string
  testId?: string
  tag?: string
}

export type SelectorResolveStatus = 'matched' | 'stale' | 'ambiguous'

export interface ResolvedSelector {
  status: SelectorResolveStatus
  selector: StableSelector
  matchCount: number
}

export interface ElementAnnotation {
  id: string
  pageUrl: string
  pageVersion: string
  selector: StableSelector
  comment: string
  screenshotBase64?: string
  createdAt: number
  stale: boolean
}

export interface PreviewEdit {
  id: string
  kind: InspectEditKind
  selector: StableSelector
  property?: string
  value: string
}

export interface DestructiveRequest {
  id: string
  kind: DestructiveKind
  selector: StableSelector
  ref?: string
}

export interface GrabResult {
  selector: StableSelector
  screenshotBase64?: string
  pageUrl: string
  pageVersion: string
}

export interface AgentElementPayload {
  selector: StableSelector
  screenshotBase64?: string
  comment: string
  pageUrl: string
  pageVersion: string
  stale: boolean
}

const DESTRUCTIVE_PURCHASE = /\b(purchase|buy|checkout|pay|place[\s-]?order|add to cart)\b/i
const DESTRUCTIVE_PUBLISH = /\b(publish|deploy|release|go live)\b/i
const DESTRUCTIVE_SUBMIT = /\b(submit|send form|confirm payment)\b/i

export function escapeCssIdent(value: string): string {
  return value.replace(/([^\w-])/g, '\\$1')
}

export function escapeAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function buildStableSelector(node: {
  ref?: string
  role?: string
  name?: string
  id?: string
  testId?: string
  tag?: string
  nth?: number
}): StableSelector {
  const fallbacks: string[] = []
  let css = ''

  if (node.testId) {
    css = `[data-testid="${escapeAttr(node.testId)}"]`
  } else if (node.id) {
    css = `#${escapeCssIdent(node.id)}`
  } else if (node.tag && node.name) {
    css = `${node.tag.toLowerCase()}[aria-label="${escapeAttr(node.name)}"]`
  } else if (node.tag && node.nth != null) {
    css = `${node.tag.toLowerCase()}:nth-of-type(${node.nth})`
  } else if (node.ref) {
    css = `[data-rox-ref="${escapeAttr(node.ref)}"]`
  } else {
    css = node.tag ? node.tag.toLowerCase() : '*'
  }

  if (node.ref && !css.includes('data-rox-ref')) {
    fallbacks.push(`[data-rox-ref="${escapeAttr(node.ref)}"]`)
  }
  if (node.role && node.name) {
    fallbacks.push(`[role="${escapeAttr(node.role)}"][aria-label="${escapeAttr(node.name)}"]`)
  }
  if (node.tag && node.nth != null && !css.includes(':nth-of-type')) {
    fallbacks.push(`${node.tag.toLowerCase()}:nth-of-type(${node.nth})`)
  }

  return {
    css,
    ref: node.ref,
    role: node.role,
    name: node.name,
    fallbacks,
  }
}

function elementMatches(el: LiveElement, selector: StableSelector, css: string): boolean {
  if (el.selector && el.selector === css) return true
  if (el.testId && css === `[data-testid="${escapeAttr(el.testId)}"]`) return true
  if (el.id && css === `#${escapeCssIdent(el.id)}`) return true
  if (el.ref && (css.includes(el.ref) || selector.ref === el.ref)) return true
  if (selector.role && selector.name && el.role === selector.role && el.name === selector.name) {
    return true
  }
  return false
}

export function resolveSelector(
  selector: StableSelector,
  live: readonly LiveElement[],
): ResolvedSelector {
  const candidates = [selector.css, ...selector.fallbacks]
  const matched = new Set<LiveElement>()
  for (const candidate of candidates) {
    for (const el of live) {
      if (elementMatches(el, selector, candidate)) matched.add(el)
    }
  }
  if (selector.ref) {
    for (const el of live) {
      if (el.ref === selector.ref) matched.add(el)
    }
  }

  const matchCount = matched.size
  const status: SelectorResolveStatus =
    matchCount === 1 ? 'matched' : matchCount === 0 ? 'stale' : 'ambiguous'
  return { status, selector, matchCount }
}

export function classifyDestructiveAction(input: {
  role?: string
  name?: string
  type?: string
  href?: string
  formMethod?: string
}): DestructiveKind | null {
  const haystack = [input.name, input.type, input.href, input.formMethod].filter(Boolean).join(' ')
  if (DESTRUCTIVE_PURCHASE.test(haystack)) return 'purchase'
  if (DESTRUCTIVE_PUBLISH.test(haystack)) return 'publish'
  if (input.type === 'submit' || DESTRUCTIVE_SUBMIT.test(haystack)) return 'submit'
  if (input.formMethod?.toLowerCase() === 'post' && /\bconfirm\b/i.test(haystack)) return 'submit'
  return null
}

let nextId = 0
function mintId(prefix: string): string {
  nextId += 1
  return `${prefix}-${nextId}`
}

export function resetInspectIds(): void {
  nextId = 0
}

export class InspectSession {
  readonly sessionId: string
  inspectMode = false
  private annotations: ElementAnnotation[] = []
  private preview: PreviewEdit | null = null
  private pendingDestructive: DestructiveRequest | null = null
  private lastGrab: GrabResult | null = null
  private mutated = false

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  enterInspectMode(): void {
    this.inspectMode = true
  }

  exitInspectMode(): void {
    this.inspectMode = false
  }

  grab(input: {
    node: Parameters<typeof buildStableSelector>[0]
    pageUrl: string
    pageVersion: string
    screenshotBase64?: string
  }): GrabResult {
    const selector = buildStableSelector(input.node)
    const result: GrabResult = {
      selector,
      screenshotBase64: input.screenshotBase64,
      pageUrl: input.pageUrl,
      pageVersion: input.pageVersion,
    }
    this.lastGrab = result
    return result
  }

  annotate(input: {
    comment: string
    selector?: StableSelector
    pageUrl: string
    pageVersion: string
    screenshotBase64?: string
  }): ElementAnnotation {
    const selector = input.selector ?? this.lastGrab?.selector
    if (!selector) {
      throw new Error('Grab an element before annotating')
    }
    const annotation: ElementAnnotation = {
      id: mintId('ann'),
      pageUrl: input.pageUrl,
      pageVersion: input.pageVersion,
      selector,
      comment: input.comment.trim(),
      screenshotBase64: input.screenshotBase64 ?? this.lastGrab?.screenshotBase64,
      createdAt: Date.now(),
      stale: false,
    }
    this.annotations.push(annotation)
    return annotation
  }

  stagePreviewEdit(input: {
    kind: InspectEditKind
    value: string
    property?: string
    selector?: StableSelector
  }): PreviewEdit {
    const selector = input.selector ?? this.lastGrab?.selector
    if (!selector) {
      throw new Error('Grab an element before staging a preview edit')
    }
    if (input.kind === 'property' && !input.property) {
      throw new Error('Property edits require a property name')
    }
    this.preview = {
      id: mintId('edit'),
      kind: input.kind,
      selector,
      property: input.property,
      value: input.value,
    }
    return this.preview
  }

  getPreviewEdit(): PreviewEdit | null {
    return this.preview
  }

  hasMutatedPage(): boolean {
    return this.mutated
  }

  applyPreview(live: readonly LiveElement[]): PreviewEdit {
    if (!this.preview) {
      throw new Error('No preview edit to approve')
    }
    const resolved = resolveSelector(this.preview.selector, live)
    if (resolved.status === 'stale') {
      this.markAnnotationStale(this.preview.selector)
      throw new Error('Selector is stale; recover before applying the preview')
    }
    this.mutated = true
    const applied = this.preview
    this.preview = null
    return applied
  }

  discardPreview(): void {
    this.preview = null
  }

  requestDestructive(input: {
    kind: DestructiveKind
    selector?: StableSelector
    ref?: string
  }): DestructiveRequest {
    const selector = input.selector ?? this.lastGrab?.selector
    if (!selector) {
      throw new Error('Grab an element before requesting a destructive action')
    }
    this.pendingDestructive = {
      id: mintId('dest'),
      kind: input.kind,
      selector,
      ref: input.ref,
    }
    return this.pendingDestructive
  }

  getPendingDestructive(): DestructiveRequest | null {
    return this.pendingDestructive
  }

  approveDestructive(live: readonly LiveElement[]): DestructiveRequest {
    if (!this.pendingDestructive) {
      throw new Error('No destructive action awaiting approval')
    }
    const resolved = resolveSelector(this.pendingDestructive.selector, live)
    if (resolved.status === 'stale') {
      this.markAnnotationStale(this.pendingDestructive.selector)
      throw new Error('Selector is stale; recover before approving the action')
    }
    this.mutated = true
    const approved = this.pendingDestructive
    this.pendingDestructive = null
    return approved
  }

  denyDestructive(): void {
    this.pendingDestructive = null
  }

  listAnnotations(pageUrl?: string): ElementAnnotation[] {
    if (!pageUrl) return [...this.annotations]
    return this.annotations.filter((ann) => ann.pageUrl === pageUrl)
  }

  refreshStale(live: readonly LiveElement[], pageUrl: string, pageVersion: string): ElementAnnotation[] {
    for (const ann of this.annotations) {
      if (ann.pageUrl !== pageUrl) continue
      const resolved = resolveSelector(ann.selector, live)
      ann.stale = resolved.status === 'stale' || ann.pageVersion !== pageVersion
    }
    return this.listAnnotations(pageUrl)
  }

  recoverStale(annotationId: string, node: Parameters<typeof buildStableSelector>[0]): ElementAnnotation {
    const ann = this.annotations.find((item) => item.id === annotationId)
    if (!ann) throw new Error(`Unknown annotation ${annotationId}`)
    ann.selector = buildStableSelector(node)
    ann.stale = false
    return ann
  }

  toAgentPayload(annotationId?: string): AgentElementPayload {
    const ann = annotationId
      ? this.annotations.find((item) => item.id === annotationId)
      : this.annotations[this.annotations.length - 1]
    if (!ann) {
      throw new Error('No annotation for the agent')
    }
    return {
      selector: ann.selector,
      screenshotBase64: ann.screenshotBase64,
      comment: ann.comment,
      pageUrl: ann.pageUrl,
      pageVersion: ann.pageVersion,
      stale: ann.stale,
    }
  }

  private markAnnotationStale(selector: StableSelector): void {
    for (const ann of this.annotations) {
      if (ann.selector.css === selector.css) ann.stale = true
    }
  }
}

const sessions = new Map<string, InspectSession>()

export function getInspectSession(sessionId: string): InspectSession {
  let session = sessions.get(sessionId)
  if (!session) {
    session = new InspectSession(sessionId)
    sessions.set(sessionId, session)
  }
  return session
}

export function resetInspectSessions(): void {
  sessions.clear()
  resetInspectIds()
}

export function serializeAnnotations(annotations: readonly ElementAnnotation[]): string {
  return JSON.stringify({ version: 1, annotations }, null, 2)
}

export function parseAnnotations(raw: string): ElementAnnotation[] {
  const parsed = JSON.parse(raw) as { annotations?: ElementAnnotation[] }
  if (!Array.isArray(parsed.annotations)) return []
  return parsed.annotations.map((ann) => ({
    id: String(ann.id),
    pageUrl: String(ann.pageUrl),
    pageVersion: String(ann.pageVersion),
    selector: {
      css: String(ann.selector?.css ?? ''),
      ref: ann.selector?.ref,
      role: ann.selector?.role,
      name: ann.selector?.name,
      fallbacks: Array.isArray(ann.selector?.fallbacks) ? ann.selector.fallbacks : [],
    },
    comment: String(ann.comment ?? ''),
    screenshotBase64: ann.screenshotBase64,
    createdAt: Number(ann.createdAt) || 0,
    stale: Boolean(ann.stale),
  }))
}
