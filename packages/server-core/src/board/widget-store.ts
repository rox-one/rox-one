/**
 * Board widget store (wave 3, row b2.3).
 *
 * A board widget is agent-authored code stored under
 * `{workspaceRoot}/board/widgets/<name>/`:
 *
 *   - `widget.json` — the `WidgetRecord` for the CURRENT revision (identity,
 *     kind, revision, sha256 of the stored document, authorship).
 *   - `index.html`  — the exact bytes that revision carries. For `kind:'html'`
 *     this is the rendered widget document produced by `buildWidgetDocument`,
 *     NOT the raw authored fragment: the bridge bootstrap bytes are emitted
 *     STRICTLY BEFORE the widget code so widget code can never observe, patch
 *     or pre-empt the host bridge primitives.
 *
 * Contract, ported from OpenClaw's canvas store and tightened for ROX:
 *
 *   - A name is the widget's stable identity AND its on-disk directory name, so
 *     every write is confined to one validated path segment. The `widgetId` in
 *     the record is that name — the frozen `board:widgetGet|widgetMount` RPC
 *     surfaces resolve a widget by a single id with no separate name argument.
 *   - A re-put of the same name is a NEW revision sharing the identity. The
 *     previous revision's bytes are overwritten, so a render ticket minted for
 *     the old revision must stop working (enforced by the ticket registry's
 *     revision + view-generation fences, not by this store).
 *   - `kind:'a2ui'` payloads are validated against the A2UI JSONL contract and
 *     then refused with a typed `UNSUPPORTED_WIDGET_KIND`: ROX ships no A2UI
 *     renderer bundle yet, and storing a half-baked revision a host cannot
 *     render would be worse than a truthful refusal. Nothing is written.
 *   - A full HTML document (doctype/html element) is refused: the wrapper owns
 *     the document shell, and accepting one would let an author replace the
 *     CSP and bridge bytes. `canvas-doc`-style pre-wrapped input is exactly
 *     this case.
 *
 * Writes are atomic (temp file + fsync + rename + directory fsync) and are
 * verified by re-reading the stored bytes and comparing sha256, reusing the
 * `workspace-work/store.ts` idioms. Path confinement reuses the same
 * `checkPath` shape: the workspace root must be a stable realpath and no
 * component of the widget path may be a symlink or a multiply-linked file.
 */

import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { CodedError } from '@rox/shared/protocol'
import { validateA2uiJsonl } from '@rox/shared/widgets/a2ui'
import { buildWidgetDocument } from '@rox/shared/widgets/wrap'
import type { WidgetKind, WidgetRecord } from '@rox/shared/widgets/types'

/** Max authored (unwrapped) widget source accepted. */
export const MAX_WIDGET_SOURCE_BYTES = 512 * 1024
/** Max wrapped document written to disk (wrapper + source). */
export const MAX_WIDGET_DOCUMENT_BYTES = 1024 * 1024
/** A widget name is one path segment: leading alphanumeric, no separators. */
const WIDGET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SHA256_HEX = /^[0-9a-f]{64}$/

export interface WidgetPutInput {
  /** Stable widget name; also the on-disk directory name and the `widgetId`. */
  name: string
  /** Operator-visible title, escaped into the document `<title>`. */
  title: string
  /** Authored source format. */
  kind: WidgetKind
  /** Authored source: an HTML fragment for `html`, an A2UI JSONL stream for `a2ui`. */
  widgetCode: string
  /** Exact outbound origins the widget may reach (validated by the wrapper). */
  netOrigins?: readonly string[]
  /** Session that authored this revision, when authored inside one. */
  sessionId?: string
  /** Identity that authored the widget. NEVER client-supplied on the RPC path. */
  createdBy: string
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function invalid(message: string): never {
  throw new CodedError('INVALID_PAYLOAD', message)
}

function assertKind(kind: unknown): WidgetKind {
  if (kind !== 'html' && kind !== 'a2ui') {
    throw new CodedError('UNSUPPORTED_WIDGET_KIND', 'Unsupported widget kind')
  }
  return kind
}

function validateRecord(value: unknown, name: string): WidgetRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid('Board widget record is malformed')
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort().join(',')
  if (keys !== 'createdAt,createdBy,kind,name,revision,sha256,widgetId' && keys !== 'createdAt,createdBy,kind,name,revision,sessionId,sha256,widgetId') {
    invalid('Board widget record is malformed')
  }
  if (record.widgetId !== name || record.name !== name) invalid('Board widget record identity mismatch')
  if (record.kind !== 'html') invalid('Board widget record kind is unsupported')
  if (typeof record.revision !== 'number' || !Number.isInteger(record.revision) || record.revision < 1) invalid('Board widget record revision is invalid')
  if (typeof record.sha256 !== 'string' || !SHA256_HEX.test(record.sha256)) invalid('Board widget record digest is invalid')
  if (typeof record.createdBy !== 'string' || record.createdBy.length === 0) invalid('Board widget record author is invalid')
  if (typeof record.createdAt !== 'string' || Number.isNaN(Date.parse(record.createdAt))) invalid('Board widget record timestamp is invalid')
  if (record.sessionId !== undefined && (typeof record.sessionId !== 'string' || record.sessionId.length === 0)) invalid('Board widget record session is invalid')
  return record as unknown as WidgetRecord
}

export class WidgetStore {
  readonly rootPath: string
  readonly directory: string

  constructor(rootPath: string, readonly workspaceId: string) {
    this.rootPath = realpathSync(rootPath)
    this.directory = join(this.rootPath, 'board', 'widgets')
  }

  private folder(name: string): string {
    return join(this.directory, name)
  }

  /** Confine a name to one path segment; the directory name IS the widgetId. */
  private assertName(name: unknown): string {
    if (typeof name !== 'string' || !WIDGET_NAME_PATTERN.test(name)) invalid('Invalid board widget name')
    return name
  }

  private checkPath(name?: string): void {
    if (realpathSync(this.rootPath) !== this.rootPath) {
      throw new CodedError('FORBIDDEN', 'Board widget path denied')
    }
    const targets: Array<[string, 'dir' | 'file']> = [[this.directory, 'dir']]
    if (name !== undefined) {
      const folder = this.folder(name)
      targets.push([folder, 'dir'], [join(folder, 'index.html'), 'file'], [join(folder, 'widget.json'), 'file'])
    }
    for (const [path, kind] of targets) {
      if (!existsSync(path)) continue
      const stat = lstatSync(path)
      if (
        stat.isSymbolicLink() ||
        (kind === 'dir' ? !stat.isDirectory() : !stat.isFile()) ||
        (kind === 'file' && stat.nlink !== 1)
      ) {
        throw new CodedError('FORBIDDEN', 'Board widget path denied')
      }
    }
  }

  /** Read the current revision's record, or null when the widget does not exist. */
  read(name: string): WidgetRecord | null {
    const safe = this.assertName(name)
    this.checkPath(safe)
    const file = join(this.folder(safe), 'widget.json')
    if (!existsSync(file)) return null
    if (statSync(file).size > MAX_WIDGET_DOCUMENT_BYTES) invalid('Board widget record too large')
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      invalid('Board widget record is corrupt')
    }
    return validateRecord(parsed, safe)
  }

  /**
   * Read the current revision's stored document (index.html), verifying it still
   * matches the record digest. A mismatch is a readback failure, never a
   * silently returned stale document.
   */
  readDocument(name: string): string {
    const record = this.read(name)
    if (!record) throw new CodedError('NOT_FOUND', 'Board widget unavailable')
    this.checkPath(record.name)
    const file = join(this.folder(record.name), 'index.html')
    let bytes: Buffer
    try {
      bytes = readFileSync(file)
    } catch {
      throw new CodedError('DOCUMENT_RESULT_UNAVAILABLE', 'Board widget readback failed')
    }
    if (sha256Hex(bytes) !== record.sha256) {
      throw new CodedError('DOCUMENT_RESULT_UNAVAILABLE', 'Board widget readback failed')
    }
    return bytes.toString('utf8')
  }

  /**
   * Store a new revision of `name`. Wrapping/validation happen before any
   * write; the returned record is the exact committed revision.
   */
  put(input: WidgetPutInput): WidgetRecord {
    const name = this.assertName(input.name)
    if (typeof input.createdBy !== 'string' || input.createdBy.length === 0) invalid('Board widget author is required')
    if (typeof input.title !== 'string' || input.title.trim().length === 0) invalid('Board widget title is required')
    if (typeof input.widgetCode !== 'string' || input.widgetCode.length === 0) invalid('Board widget source is required')

    const kind = assertKind(input.kind)
    if (kind === 'a2ui') {
      // Validate first so a malformed stream reports its real issues, then refuse:
      // an author cannot tell a valid-unrenderable widget from an invalid one if
      // the kind refusal pre-empts validation.
      try {
        validateA2uiJsonl(input.widgetCode)
      } catch (error) {
        invalid(error instanceof Error ? error.message : 'Invalid A2UI widget stream')
      }
      throw new CodedError('UNSUPPORTED_WIDGET_KIND', 'A2UI widgets cannot be stored until an A2UI renderer ships')
    }

    if (Buffer.byteLength(input.widgetCode) > MAX_WIDGET_SOURCE_BYTES) invalid('Board widget source too large')
    // A full HTML document is the wrapper's job, never the author's: accepting one
    // would let the author replace the host CSP and bridge bytes.
    if (/<!doctype\s|<html[\s>]/i.test(input.widgetCode)) invalid('Board widget source must be a fragment, not a full HTML document')

    let document: string
    try {
      document = buildWidgetDocument(input.title, input.widgetCode, { connectOrigins: input.netOrigins })
    } catch (error) {
      invalid(error instanceof Error ? error.message : 'Invalid board widget declaration')
    }
    const documentBytes = Buffer.from(document, 'utf8')
    if (documentBytes.byteLength > MAX_WIDGET_DOCUMENT_BYTES) invalid('Board widget document too large')

    this.checkPath()
    const existing = this.read(name)
    const folder = this.folder(name)
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    this.checkPath(name)

    const sha256 = sha256Hex(documentBytes)
    this.writeAtomic(folder, 'index.html', documentBytes)
    const observed = readFileSync(join(folder, 'index.html'))
    if (sha256Hex(observed) !== sha256) {
      throw new CodedError('DOCUMENT_RESULT_UNAVAILABLE', 'Board widget readback failed')
    }

    const record: WidgetRecord = {
      widgetId: name,
      name,
      kind,
      revision: (existing?.revision ?? 0) + 1,
      sha256,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      createdBy: input.createdBy,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    }
    this.writeAtomic(folder, 'widget.json', Buffer.from(JSON.stringify(record), 'utf8'))
    return record
  }

  private writeAtomic(directory: string, fileName: string, bytes: Buffer): void {
    const tmp = join(directory, `.${fileName}-${randomUUID()}.tmp`)
    try {
      const fd = openSync(tmp, 'wx', 0o600)
      try {
        writeFileSync(fd, bytes)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(tmp, join(directory, fileName))
      const dirFd = openSync(directory, 'r')
      try {
        fsyncSync(dirFd)
      } finally {
        closeSync(dirFd)
      }
    } finally {
      rmSync(tmp, { force: true })
    }
  }
}