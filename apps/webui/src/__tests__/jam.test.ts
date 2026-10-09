import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  applyConsent,
  disable,
  injectJamRecorder,
  isConsented,
  isEnabled,
  isInjected,
  JAM_CAPTURE_SRC,
  JAM_CONSENT_KEY,
  JAM_RECORDER_SRC,
} from '../jam'

interface StubEl {
  tagName: string
  name?: string
  content?: string
  type?: string
  src?: string
  remove(): void
}

interface HeadStub {
  children: StubEl[]
  appendChild(el: StubEl): StubEl
  querySelectorAll(selector: string): StubEl[]
}

interface DocumentStub {
  head: HeadStub
  createElement(tagName: string): StubEl
}

interface LocalStorageStub {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  has(key: string): boolean
}

interface Dom {
  document: DocumentStub
  head: HeadStub
}

function makeDom(): Dom {
  const head: HeadStub = {
    children: [],
    appendChild(el) {
      head.children.push(el)
      return el
    },
    querySelectorAll() {
      return head.children
    },
  }
  const document: DocumentStub = {
    head,
    createElement(tagName) {
      const el: StubEl = {
        tagName,
        remove() {
          const index = head.children.indexOf(el)
          if (index >= 0) head.children.splice(index, 1)
        },
      }
      return el
    },
  }
  return { document, head }
}

function makeLocalStorage(): LocalStorageStub {
  const map = new Map<string, string>()
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: key => void map.delete(key),
    has: key => map.has(key),
  }
}

let dom: Dom
let store: LocalStorageStub

beforeEach(() => {
  dom = makeDom()
  store = makeLocalStorage()
  ;(globalThis as Record<string, unknown>).document = dom.document
  ;(globalThis as Record<string, unknown>).localStorage = store
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document
  delete (globalThis as Record<string, unknown>).localStorage
})

describe('jam consent gating', () => {
  test('flag off: nothing loads', () => {
    expect(isConsented()).toBe(false)
    expect(isEnabled()).toBe(false)
    applyConsent()
    expect(dom.head.children).toHaveLength(0)
    expect(isInjected()).toBe(false)
  })

  test('injectJamRecorder adds meta + both module scripts once', () => {
    expect(injectJamRecorder('52d8f20d-e8dc-4e05-850a-695cf744701e')).toBe(true)
    expect(isInjected()).toBe(true)

    const meta = dom.head.children.find(el => el.tagName === 'meta')
    expect(meta?.name).toBe('jam:team')
    expect(meta?.content).toBe('52d8f20d-e8dc-4e05-850a-695cf744701e')

    const scripts = dom.head.children.filter(el => el.tagName === 'script')
    expect(scripts.map(s => s.src)).toEqual([JAM_RECORDER_SRC, JAM_CAPTURE_SRC])
    expect(scripts.every(s => s.type === 'module')).toBe(true)

    const count = dom.head.children.length
    expect(injectJamRecorder('other')).toBe(false)
    expect(dom.head.children).toHaveLength(count)
  })

  test('disable revokes consent and clears injected tags', () => {
    store.setItem(JAM_CONSENT_KEY, '1')
    expect(isConsented()).toBe(true)
    disable()
    expect(isConsented()).toBe(false)
    expect(store.has(JAM_CONSENT_KEY)).toBe(false)
    expect(dom.head.children).toHaveLength(0)
  })
})