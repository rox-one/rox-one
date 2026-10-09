/**
 * Concealed clipboard writes.
 *
 * Rox's own secret copies — the OpenClaw gateway credential and organization
 * invite tokens — must never land in Rox History or any other clipboard
 * manager (which would keep the plaintext for up to the retention window).
 * Compliant managers skip a pasteboard entry tagged with
 * `org.nspasteboard.ConcealedType`, so every first-party secret copy writes the
 * text and that marker together in one atomic write; a host without the async
 * multi-format clipboard falls back to a plain text write.
 */

export const CONCEALED_FORMAT = 'org.nspasteboard.ConcealedType'

/** Electron's raw-pasteboard key carrying {@link CONCEALED_FORMAT} through `ClipboardItem`. */
export const CONCEALED_CLIPBOARD_TYPE = `electron application/osclipboard;format="${CONCEALED_FORMAT}"`

/** Minimal clipboard surface; the default is Electron's `clipboard`. */
export interface ConcealedClipboard {
  writeText(text: string): void | Promise<void>
  /** Atomic multi-format write; absent on hosts without the async clipboard API. */
  write?(items: Electron.ClipboardItem[]): void | Promise<void>
}

/** Builds the one `ClipboardItem` carrying the text and the concealed marker. */
export type ConcealedClipboardItemFactory = (items: Record<string, string>) => Electron.ClipboardItem

/** Constructor shape shared by Electron's module export and any host global. */
type ClipboardItemCtor = new (items: Record<string, string>) => Electron.ClipboardItem

// Electron exposes `ClipboardItem` as a module export in the main process (there
// is no such global there), so resolve it lazily; tests replace this factory to
// exercise the conceal logic without an Electron runtime.
function defaultClipboardItemFactory(items: Record<string, string>): Electron.ClipboardItem {
  // Unchecked casts: `require` is untyped at this boundary; both names are
  // guarded by `typeof … === 'function'` before use.
  const electronModule = require('electron') as { ClipboardItem?: ClipboardItemCtor }
  if (typeof electronModule.ClipboardItem === 'function') return new electronModule.ClipboardItem(items)
  const hostGlobals = globalThis as unknown as { ClipboardItem?: ClipboardItemCtor }
  if (typeof hostGlobals.ClipboardItem === 'function') return new hostGlobals.ClipboardItem(items)
  throw new Error('ClipboardItem is unavailable in this Electron runtime')
}

let createClipboardItem: ConcealedClipboardItemFactory = defaultClipboardItemFactory

/** Test seam: replace (`null` restores) how the concealed marker item is built. */
export function setConcealedClipboardItemFactory(factory: ConcealedClipboardItemFactory | null): void {
  createClipboardItem = factory ?? defaultClipboardItemFactory
}

/**
 * Writes `text` to the clipboard together with a {@link CONCEALED_FORMAT} marker
 * in one atomic `clipboard.write` so every compliant manager, Rox History
 * included, skips it. Falls back to `writeText` (no marker) when the combined
 * write is unavailable or rejects — logged at debug level, never thrown.
 * The optional `clipboard` parameter exists for tests; production passes
 * Electron's `clipboard` (or omits it and Electron is required lazily).
 */
export async function writeClipboardTextConcealed(
  text: string,
  clipboard?: ConcealedClipboard,
): Promise<void> {
  const target = clipboard ?? (require('electron').clipboard as ConcealedClipboard)
  if (typeof target.write === 'function') {
    try {
      await target.write([createClipboardItem({ 'text/plain': text, [CONCEALED_CLIPBOARD_TYPE]: '1' })])
      return
    } catch (error) {
      console.debug('[clipboard-history] concealed combined write failed; falling back to plain text', error)
    }
  }
  await target.writeText(text)
}