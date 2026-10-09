/**
 * Active composer presence for hotkey arbitration.
 *
 * The native `voice:hotkey` event is broadcast to every mounted listener.
 * Composer controls only start when they can actually receive a transcript
 * (visible host, no foreign owner), so the global host must yield to a
 * composer that is *on screen* — a composer mounted inside a hidden, inert or
 * `aria-hidden` surface cannot take the capture and must not block the
 * global overlay.
 *
 * Every composer's dictation control renders `data-voice-dictation-host`.
 */

/** Marker rendered by every mounted composer's dictation control. */
export const COMPOSER_HOST_SELECTOR = '[data-voice-dictation-host]'

/**
 * True while at least one composer control is connected, laid out and free of
 * `hidden`/`inert`/`aria-hidden` ancestors — i.e. the composer can start a
 * capture and receive the transcript.
 */
export function activeComposerPresent(root: ParentNode = document): boolean {
  const hosts = root.querySelectorAll(COMPOSER_HOST_SELECTOR)
  for (const host of Array.from(hosts)) {
    if (!(host instanceof HTMLElement) || !host.isConnected) continue
    if (host.closest('[hidden], [inert], [aria-hidden="true"]')) continue
    if (host.getClientRects().length === 0) continue
    if (getComputedStyle(host).visibility === 'hidden') continue
    return true
  }
  return false
}