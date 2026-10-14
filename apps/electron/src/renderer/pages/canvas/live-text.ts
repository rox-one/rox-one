/**
 * «Доска» live text binding (review 6, S1): an UNCONTROLLED textarea bound to a
 * Y.Text.
 * - Local input is applied as a minimal diff against the text the textarea last
 *   reflected (`shadow`, always equal to the Y.Text outside IME composition).
 * - Remote changes arrive as Y deltas and are applied to the textarea in place,
 *   mapping selection start/end through the delta so the caret stays put.
 * - IME: nothing is written while composing; remote deltas received meanwhile
 *   are buffered and the composed change is mapped through them on compositionend.
 */
import type * as Y from 'yjs'

export interface TextAreaLike {
  value: string
  selectionStart: number | null
  selectionEnd: number | null
  setSelectionRange(start: number, end: number): void
  addEventListener(type: string, fn: (e: unknown) => void): void
  removeEventListener(type: string, fn: (e: unknown) => void): void
}
type Delta = Array<{ insert?: unknown; delete?: number; retain?: number }>

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff

/** Minimal single-range change from a to b (never splits a surrogate pair). */
export function diffRange(a: string, b: string): { index: number; remove: number; insert: string } {
  let p = 0
  const max = Math.min(a.length, b.length)
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++
  if (p > 0 && isHigh(a.charCodeAt(p - 1))) p--
  let s = 0
  while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++
  if (s > 0 && isLow(a.charCodeAt(a.length - s))) s--
  return { index: p, remove: a.length - p - s, insert: b.slice(p, b.length - s) }
}

export function bindTextArea(el: TextAreaLike, yt: Y.Text, origin: unknown): () => void {
  el.value = yt.toString()
  let shadow = el.value
  let composing = false
  let pending: Delta[] = []

  const applyLocal = () => {
    const d = diffRange(shadow, el.value)
    if (!d.remove && !d.insert) {
      // No local change (e.g. a cancelled composition): still consume buffered remote
      // deltas, or the next local edit would be mapped through them twice.
      if (pending.length) {
        let c = el.selectionEnd ?? 0
        for (const delta of pending) c = mapPoint(delta, c)
        pending = []
        if (el.value !== yt.toString()) { el.value = yt.toString(); el.setSelectionRange(c, c) }
        shadow = el.value
      }
      return
    }
    let index = d.index, remove = d.remove
    // Map the change (made against `shadow`) through remote deltas buffered during IME.
    for (const delta of pending) {
      const end = mapRangeEnd(delta, index + remove)
      index = mapPoint(delta, index)
      remove = Math.max(0, end - index)
    }
    pending = []
    const doc = yt.doc
    const write = () => { if (remove) yt.delete(index, remove); if (d.insert) yt.insert(index, d.insert) }
    if (doc) doc.transact(write, origin); else write()
    const caret = index + d.insert.length
    if (el.value !== yt.toString()) { el.value = yt.toString(); el.setSelectionRange(caret, caret) }
    shadow = el.value
  }
  const onInput = () => { if (!composing) applyLocal() }
  const onStart = () => { composing = true }
  const onEnd = () => { composing = false; applyLocal() }

  const observer = (ev: Y.YTextEvent, tr: Y.Transaction) => {
    if (tr.origin === origin) return
    const delta = ev.delta as Delta
    if (composing) { pending.push(delta); return }
    const s = el.selectionStart ?? 0, e = el.selectionEnd ?? s
    const ns = mapPoint(delta, s), ne = mapPoint(delta, e)
    el.value = yt.toString()
    shadow = el.value
    el.setSelectionRange(ns, Math.max(ns, ne))
  }
  yt.observe(observer)
  el.addEventListener('input', onInput)
  el.addEventListener('compositionstart', onStart)
  el.addEventListener('compositionend', onEnd)
  return () => {
    yt.unobserve(observer)
    el.removeEventListener('input', onInput)
    el.removeEventListener('compositionstart', onStart)
    el.removeEventListener('compositionend', onEnd)
  }
}

/** Map a caret position (old doc) through a delta; a remote insert exactly at the caret lands after it, so the caret does not jump. */
export function mapPoint(delta: Delta, index: number): number {
  let oldPos = 0, shift = 0
  for (const op of delta) {
    if (oldPos > index) break
    if (op.retain) oldPos += op.retain
    else if (op.insert !== undefined) {
      const len = typeof op.insert === 'string' ? op.insert.length : 1
      if (oldPos < index) shift += len
    } else if (op.delete) {
      const cut = Math.min(op.delete, Math.max(0, index - oldPos))
      shift -= cut
      oldPos += op.delete
    }
  }
  return Math.max(0, index + shift)
}
const mapRangeEnd = mapPoint
