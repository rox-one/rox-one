/**
 * A2UI widget stream validation (Wave 3 row b2.4).
 *
 * `@a2ui/web_core` — the package whose v0.9 message schema OpenClaw's canvas
 * validated against — is not a ROX dependency (verified across every workspace
 * `package.json` and `bun.lock`). This module therefore re-expresses the wire
 * contract as an explicit structural validator instead of importing a schema
 * that does not exist here.
 *
 * The contract, applied per JSONL line:
 *
 * - v0.8 messages are UNVERSIONED: exactly one of `beginRendering`,
 *   `surfaceUpdate`, `dataModelUpdate`, `deleteSurface`, and any explicit
 *   `version` field is an error at every value.
 * - v0.9 messages are VERSIONED: `"version":"0.9"` plus exactly one of
 *   `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`.
 *   The upstream OpenClaw build spells the same version `"v0.9"`; the ROX
 *   wave-3 contract uses the bare literal `A2UI_V09_VERSION` and every other
 *   spelling is rejected as an unknown version (fail-closed, never guessed).
 * - One document speaks one version. A stream that mixes v0.8 and v0.9 is
 *   rejected outright — a widget is never partially rendered.
 * - Unknown keys are rejected at the envelope, at the payload, and inside the
 *   fully-specified payloads. Component entries keep renderer/catalog-owned
 *   props open (see `validateV09Payload`).
 * - A raw `</script>` sequence anywhere in a line is rejected unless it is
 *   backslash-escaped, because the A2UI source is embedded in an HTML document
 *   and an unescaped sequence would terminate the carrying script element
 *   regardless of the JSON string it appears to live in.
 *
 * What this validator does NOT guarantee: it does not check catalog ids against
 * a catalog, does not resolve surface/component references, and does not
 * validate component property types or action handlers. Those are owned by the
 * A2UI renderer that consumes the parsed messages; this module only guarantees
 * that the envelope is well-formed, single-versioned and structurally
 * unambiguous.
 */

/** Version of a validated document, in wire literal form. */
export type A2uiVersion = '0.8' | '0.9'

/** The only accepted `version` value; v0.9 messages carry it, v0.8 carry none. */
export const A2UI_V09_VERSION = '0.9'

/** The four unversioned v0.8 operations. */
export const A2UI_V08_ACTION_KEYS = [
  'beginRendering',
  'surfaceUpdate',
  'dataModelUpdate',
  'deleteSurface',
] as const

/** The four versioned v0.9 operations. */
export const A2UI_V09_ACTION_KEYS = [
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
] as const

export type A2uiActionKey = (typeof A2UI_V08_ACTION_KEYS)[number] | (typeof A2UI_V09_ACTION_KEYS)[number]

/** One parsed, validated action line. */
export type A2uiMessage = Record<string, unknown>

export interface A2uiValidationResult {
  /** The document's single version, reported as its wire literal. */
  version: A2uiVersion
  /** Number of non-blank lines that carried a message. */
  messageCount: number
  /** Parsed messages in document order. */
  messages: readonly A2uiMessage[]
}

/**
 * Every validation problem in the document, so an author fixes a widget in one
 * pass instead of one error per round trip.
 */
export class A2uiValidationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid A2UI JSONL:\n- ${issues.join('\n- ')}`)
    this.name = 'A2uiValidationError'
    this.issues = issues
  }
}

/**
 * A raw `</script` that the HTML tokenizer could treat as the end of the
 * carrying script element. Deliberately broader than the tokenizer's
 * terminator set (it also rejects a bare trailing `</script`), and satisfied by
 * the JSON escape `<\/script`.
 */
const RAW_SCRIPT_END = /(?<!\\)<\/script/i

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireNonEmptyString(value: unknown, field: string, actionKey: string): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return `${actionKey} requires a non-empty string ${field}`
  }
  return null
}

function rejectUnknownKeys(
  actionKey: string,
  payload: Record<string, unknown>,
  allowed: readonly string[],
): string | null {
  const unknown = Object.keys(payload).find((key) => !allowed.includes(key))
  return unknown === undefined ? null : `${actionKey} has an unexpected field ${JSON.stringify(unknown)}`
}

function validateComponents(
  actionKey: string,
  components: unknown,
  requireObjectComponent: boolean,
): string | null {
  if (!Array.isArray(components)) {
    return `${actionKey} requires an array components`
  }
  for (let index = 0; index < components.length; index += 1) {
    const entry = components[index]
    if (!isPlainObject(entry)) {
      return `${actionKey} components[${index}] must be an object`
    }
    const idIssue = requireNonEmptyString(entry.id, 'id', `${actionKey} components[${index}]`)
    if (idIssue) return idIssue
    if (requireObjectComponent) {
      // v0.8 component bodies are a single-key object naming the component.
      if (!isPlainObject(entry.component)) {
        return `${actionKey} components[${index}] requires an object component`
      }
    } else if (typeof entry.component !== 'string' || entry.component.length === 0) {
      // v0.9 names the component as a string; the remaining entry keys are the
      // catalog-owned props, so they stay open here.
      return `${actionKey} components[${index}] requires a non-empty string component`
    }
  }
  return null
}

function validateV08Payload(actionKey: A2uiActionKey, payload: Record<string, unknown>): string | null {
  const surfaceIssue = requireNonEmptyString(payload.surfaceId, 'surfaceId', actionKey)
  if (surfaceIssue) return surfaceIssue
  switch (actionKey) {
    case 'beginRendering': {
      const unknown = rejectUnknownKeys(actionKey, payload, ['surfaceId', 'root'])
      if (unknown) return unknown
      return requireNonEmptyString(payload.root, 'root', actionKey)
    }
    case 'surfaceUpdate': {
      const unknown = rejectUnknownKeys(actionKey, payload, ['surfaceId', 'components'])
      if (unknown) return unknown
      return validateComponents(actionKey, payload.components, true)
    }
    case 'dataModelUpdate': {
      const unknown = rejectUnknownKeys(actionKey, payload, ['surfaceId', 'path', 'contents', 'value'])
      if (unknown) return unknown
      if (payload.path !== undefined) {
        const pathIssue = requireNonEmptyString(payload.path, 'path', actionKey)
        if (pathIssue) return pathIssue
      }
      if ('contents' in payload) {
        if (!Array.isArray(payload.contents)) return `${actionKey} contents must be an array`
        return null
      }
      return 'value' in payload ? null : `${actionKey} requires contents or value`
    }
    case 'deleteSurface': {
      return rejectUnknownKeys(actionKey, payload, ['surfaceId'])
    }
    default:
      return `unsupported A2UI v0.8 action ${JSON.stringify(actionKey)}`
  }
}

function validateV09Payload(actionKey: A2uiActionKey, payload: Record<string, unknown>): string | null {
  const surfaceIssue = requireNonEmptyString(payload.surfaceId, 'surfaceId', actionKey)
  if (surfaceIssue) return surfaceIssue
  switch (actionKey) {
    case 'createSurface': {
      const unknown = rejectUnknownKeys(actionKey, payload, ['surfaceId', 'catalogId'])
      if (unknown) return unknown
      return requireNonEmptyString(payload.catalogId, 'catalogId', actionKey)
    }
    case 'updateComponents': {
      const unknown = rejectUnknownKeys(actionKey, payload, ['surfaceId', 'components'])
      if (unknown) return unknown
      return validateComponents(actionKey, payload.components, false)
    }
    case 'updateDataModel': {
      const unknown = rejectUnknownKeys(actionKey, payload, ['surfaceId', 'path', 'value'])
      if (unknown) return unknown
      const pathIssue = requireNonEmptyString(payload.path, 'path', actionKey)
      if (pathIssue) return pathIssue
      return 'value' in payload ? null : `${actionKey} requires value`
    }
    case 'deleteSurface': {
      return rejectUnknownKeys(actionKey, payload, ['surfaceId'])
    }
    default:
      return `unsupported A2UI v0.9 action ${JSON.stringify(actionKey)}`
  }
}

/**
 * Parse and validate an A2UI JSONL stream: one JSON action per line, blank
 * lines ignored, CRLF and a leading BOM tolerated.
 *
 * @throws {A2uiValidationError} when any line, or the document as a whole, is
 * invalid. All problems are reported together.
 */
export function validateA2uiJsonl(jsonl: string): A2uiValidationResult {
  if (typeof jsonl !== 'string') {
    throw new A2uiValidationError(['A2UI JSONL source must be a string'])
  }
  const issues: string[] = []
  const messages: A2uiMessage[] = []
  let sawV08 = false
  let sawV09 = false
  let messageCount = 0

  const lines = jsonl.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1
    // `trim` also strips the UTF-8 BOM, which is whitespace to JS but would
    // otherwise make the first line unparseable.
    const line = lines[index]!.trim()
    if (line.length === 0) continue
    messageCount += 1

    if (RAW_SCRIPT_END.test(line)) {
      issues.push(`line ${lineNumber}: raw </script> sequence in A2UI source (escape it as <\\/script>)`)
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      issues.push(`line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (!isPlainObject(parsed)) {
      issues.push(`line ${lineNumber}: expected a JSON object`)
      continue
    }

    const version = parsed.version
    const isV09 = version === A2UI_V09_VERSION
    if (version !== undefined && !isV09) {
      issues.push(
        version === '0.8' || version === 'v0.8'
          ? `line ${lineNumber}: A2UI v0.8 messages must not carry a version field`
          : `line ${lineNumber}: unsupported A2UI version ${JSON.stringify(version)} (v0.9 messages carry "version":${JSON.stringify(A2UI_V09_VERSION)}, v0.8 messages are unversioned)`,
      )
      continue
    }

    const actionKeys = (isV09 ? A2UI_V09_ACTION_KEYS : A2UI_V08_ACTION_KEYS).filter((key) => key in parsed)
    if (actionKeys.length !== 1) {
      issues.push(
        `line ${lineNumber}: expected exactly one ${isV09 ? 'v0.9' : 'v0.8'} action key, found ${actionKeys.length}`,
      )
      continue
    }
    const actionKey = actionKeys[0]!
    const allowedKeys = isV09 ? ['version', actionKey] : [actionKey]
    const unknownKey = rejectUnknownKeys('message', parsed, allowedKeys)
    if (unknownKey) {
      issues.push(`line ${lineNumber}: ${unknownKey}`)
      continue
    }

    const payload = parsed[actionKey]
    if (!isPlainObject(payload)) {
      issues.push(`line ${lineNumber}: ${actionKey} payload must be a JSON object`)
      continue
    }
    const payloadIssue = isV09
      ? validateV09Payload(actionKey, payload)
      : validateV08Payload(actionKey, payload)
    if (payloadIssue) {
      issues.push(`line ${lineNumber}: ${payloadIssue}`)
      continue
    }

    if (isV09) sawV09 = true
    else sawV08 = true
    messages.push(parsed)
  }

  if (messageCount === 0) issues.push('no A2UI JSONL messages found')
  if (sawV08 && sawV09) issues.push('mixed A2UI v0.8 and v0.9 messages in one document')
  if (issues.length > 0) throw new A2uiValidationError(issues)

  return {
    version: sawV09 ? '0.9' : '0.8',
    messageCount,
    messages,
  }
}