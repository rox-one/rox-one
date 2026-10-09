/**
 * W1-14 (#1511) — Anchor property test against real yjs (§11.3, §11.4).
 *
 * The contract this file exists to prove: a comment anchor — base64 of
 * `Y.encodeRelativePosition` — still resolves to the same text after
 * concurrent edits, because relative positions are what survives an edit and
 * an absolute index is not. `y-prosemirror` builds the document the way the
 * editor does (`Y.XmlFragment` → `Y.XmlText`); the random edits come from a
 * seeded generator so a failure is reproducible.
 */

import { describe, expect, test } from 'bun:test'
import { Schema } from 'prosemirror-model'
import { prosemirrorJSONToYDoc } from 'y-prosemirror'
import * as Y from 'yjs'
import { anchorResolution, decodeYAnchor, encodeYAnchor } from '../anchor'

const ROUNDS = 200

/** mulberry32: deterministic, so a failing round can be replayed. */
function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const schema = new Schema({
  nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} },
  marks: {},
})

/** A fresh prosemirror-shaped Y doc with `paragraphs` paragraphs of `length` chars. */
function makeDoc(random: () => number, paragraphs: number, length: number): Y.Doc {
  const content = Array.from({ length: paragraphs }, (_, index) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: token(random, length) }],
  }))
  return prosemirrorJSONToYDoc(schema, { type: 'doc', content }, 'prosemirror')
}

function token(random: () => number, length: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  return Array.from({ length }, () => letters[Math.floor(random() * letters.length)]).join('')
}

/** The paragraph texts of a Y doc, in document order. */
function paragraphsOf(doc: Y.Doc): Y.XmlText[] {
  const fragment = doc.getXmlFragment('prosemirror')
  const texts: Y.XmlText[] = []
  for (let index = 0; index < fragment.length; index += 1) {
    const element = fragment.get(index)
    if (element instanceof Y.XmlElement) {
      const text = element.get(0)
      if (text instanceof Y.XmlText) texts.push(text)
    }
  }
  return texts
}

/** Encode a range of one paragraph, the way the editor does on "Comment". */
function anchorOf(text: Y.XmlText, from: number, to: number): string {
  const start = Y.createRelativePositionFromTypeIndex(text, from)
  const end = Y.createRelativePositionFromTypeIndex(text, to)
  return JSON.stringify(encodeYAnchor(Y.encodeRelativePosition(start), Y.encodeRelativePosition(end), { quote: text.toString().slice(from, to) }))
}

/** Resolve a stored anchor against a doc: the absolute range, or `null`. */
function resolve(doc: Y.Doc, stored: string): { from: number; to: number } | null {
  const anchor = JSON.parse(stored) as { start: string; end: string }
  const bytes = decodeYAnchor(anchor)
  if (!bytes) return null
  const start = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(bytes.start), doc)
  const end = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(bytes.end), doc)
  if (!start || !end) return null
  return { from: start.index, to: end.index }
}

describe('comment anchors survive concurrent edits (yjs)', () => {
  test('an anchor resolves to the same text after random edits elsewhere', () => {
    const random = rng(0x1511)
    for (let round = 0; round < ROUNDS; round += 1) {
      const doc = makeDoc(random, 2 + Math.floor(random() * 3), 40)
      const texts = paragraphsOf(doc)
      const target = texts[Math.floor(random() * texts.length)]!
      const length = target.toString().length
      const from = Math.floor(random() * (length - 5))
      const to = from + 1 + Math.floor(random() * Math.min(4, length - from - 1))
      const expected = target.toString().slice(from, to)
      const stored = anchorOf(target, from, to)

      // Someone else edits every paragraph *except* the anchored one.
      for (const [index, other] of texts.entries()) {
        if (other === target) continue
        const edits = 1 + Math.floor(random() * 3)
        for (let edit = 0; edit < edits; edit += 1) {
          const at = Math.floor(random() * Math.max(1, other.toString().length))
          if (random() < 0.5) other.insert(at, token(random, 1 + Math.floor(random() * 4)))
          else if (other.toString().length > 1) other.delete(at, 1)
        }
        expect(index).toBeGreaterThanOrEqual(0)
      }

      const resolved = resolve(doc, stored)
      expect(resolved).not.toBeNull()
      expect(anchorResolution(resolved!.from, resolved!.to)).toBe('resolved')
      expect(paragraphsOf(doc)[texts.indexOf(target)]!.toString().slice(resolved!.from, resolved!.to)).toBe(expected)
    }
  })

  test('two replicas editing the same document keep the anchor on the same text', () => {
    const random = rng(0x14_14)
    for (let round = 0; round < ROUNDS; round += 1) {
      const origin = makeDoc(random, 1, 60)
      const originTexts = paragraphsOf(origin)
      const from = Math.floor(random() * 20)
      const to = from + 5
      const expected = originTexts[0]!.toString().slice(from, to)
      const stored = anchorOf(originTexts[0]!, from, to)
      const update = Y.encodeStateAsUpdate(origin)

      // Replica A types before the anchor, replica B after it; then they merge.
      const a = new Y.Doc()
      const b = new Y.Doc()
      Y.applyUpdate(a, update)
      Y.applyUpdate(b, update)
      paragraphsOf(a)[0]!.insert(0, token(random, 1 + Math.floor(random() * 5)))
      const bText = paragraphsOf(b)[0]!
      bText.insert(bText.toString().length, token(random, 1 + Math.floor(random() * 5)))

      const fromA = Y.encodeStateAsUpdate(a)
      const fromB = Y.encodeStateAsUpdate(b)
      Y.applyUpdate(a, fromB, 'b')
      Y.applyUpdate(b, fromA, 'a')

      for (const doc of [a, b]) {
        const resolved = resolve(doc, stored)
        expect(resolved).not.toBeNull()
        expect(paragraphsOf(doc)[0]!.toString().slice(resolved!.from, resolved!.to)).toBe(expected)
      }
    }
  })

  test('deleting the anchored text collapses the anchor instead of drifting', () => {
    const random = rng(0x1513)
    for (let round = 0; round < 50; round += 1) {
      const doc = makeDoc(random, 1, 30)
      const text = paragraphsOf(doc)[0]!
      const from = 5
      const to = 10
      const stored = anchorOf(text, from, to)
      text.delete(from, to - from)
      const resolved = resolve(doc, stored)
      expect(resolved).not.toBeNull()
      expect(anchorResolution(resolved!.from, resolved!.to)).toBe('deleted')
    }
  })

  test('the same property holds on a plain Y.Text (no y-prosemirror)', () => {
    const random = rng(0x1515)
    for (let round = 0; round < ROUNDS; round += 1) {
      const doc = new Y.Doc()
      const text = doc.getText('body')
      text.insert(0, token(random, 80))
      const from = Math.floor(random() * 40)
      const to = from + 6
      const expected = text.toString().slice(from, to)
      const start = Y.createRelativePositionFromTypeIndex(text, from)
      const end = Y.createRelativePositionFromTypeIndex(text, to)
      const stored = encodeYAnchor(Y.encodeRelativePosition(start), Y.encodeRelativePosition(end))
      text.insert(0, token(random, 1 + Math.floor(random() * 3)))
      text.insert(text.toString().length - 1, token(random, 1 + Math.floor(random() * 3)))
      const decoded = decodeYAnchor(stored)!
      const resolvedStart = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(decoded.start), doc)
      const resolvedEnd = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(decoded.end), doc)
      expect(resolvedStart).not.toBeNull()
      expect(text.toString().slice(resolvedStart!.index, resolvedEnd!.index)).toBe(expected)
    }
  })
})