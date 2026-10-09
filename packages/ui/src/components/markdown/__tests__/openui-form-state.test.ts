/**
 * Unit tests for the module-private openui form-state store, exercised without
 * mounting the vendor `@openuidev/react-ui` renderer (whose writes only happen
 * on user interaction inside the component tree).
 */
import { describe, expect, it } from 'bun:test'
import {
  FORM_STATE_CAP,
  extractOpenUIFormValues,
  openUIFormStateKey,
  readOpenUIFormState,
  writeOpenUIFormState,
} from '../openui-form-state'

describe('openUIFormStateKey', () => {
  it('composes the key from scope and block id', () => {
    expect(openUIFormStateKey('message-1', 'blk-abc')).toBe('message-1|blk-abc')
  })

  it('renders undefined scope and id as empty segments', () => {
    expect(openUIFormStateKey(undefined, 'blk-abc')).toBe('|blk-abc')
    expect(openUIFormStateKey('message-1', undefined)).toBe('message-1|')
    expect(openUIFormStateKey(undefined, undefined)).toBe('|')
  })

  it('distinguishes scopes so one message cannot hydrate another', () => {
    expect(openUIFormStateKey('message-1', 'blk-abc')).not.toBe(openUIFormStateKey('message-2', 'blk-abc'))
  })
})

describe('extractOpenUIFormValues', () => {
  it('extracts the flat {field: value} map from a non-form store snapshot', () => {
    expect(
      extractOpenUIFormValues({
        name: { value: 'Ada', componentType: 'Input' },
        count: { value: 3, componentType: 'Number' },
        $binding: 42,
      }),
    ).toEqual({ name: 'Ada', count: 3, $binding: 42 })
  })

  it('unwraps a form-named payload one level into the flat map', () => {
    expect(
      extractOpenUIFormValues({
        contact: {
          notes: { value: 'hello', componentType: 'Input' },
          amount: { value: 12, componentType: 'Number' },
        },
      }),
    ).toEqual({ notes: 'hello', amount: 12 })
  })
})

describe('form-state store LRU contract', () => {
  /** Insert `n` fresh keys `prefix-0..prefix-(n-1)` oldest-first. */
  function seed(prefix: string, n: number): void {
    for (let i = 0; i < n; i += 1) writeOpenUIFormState(`${prefix}-${i}`, { n: i })
  }

  it('exposes a cap of 32', () => {
    expect(FORM_STATE_CAP).toBe(32)
  })

  it('evicts the oldest entry once a 33rd distinct key is written', () => {
    seed('evict', FORM_STATE_CAP + 1)
    expect(readOpenUIFormState('evict-0')).toBeUndefined()
    expect(readOpenUIFormState('evict-1')).toEqual({ n: 1 })
    expect(readOpenUIFormState(`evict-${FORM_STATE_CAP}`)).toEqual({ n: FORM_STATE_CAP })
  })

  it('refreshes recency on read so the entry survives a later eviction', () => {
    seed('read-lru', FORM_STATE_CAP)
    // Touch the oldest entry, making it the most recent.
    expect(readOpenUIFormState('read-lru-0')).toEqual({ n: 0 })
    writeOpenUIFormState('read-lru-new', { n: 99 })
    // The un-touched second-oldest was evicted; the refreshed one survived.
    expect(readOpenUIFormState('read-lru-1')).toBeUndefined()
    expect(readOpenUIFormState('read-lru-0')).toEqual({ n: 0 })
  })

  it('re-writing an existing key updates the value and refreshes recency', () => {
    seed('rewrite', FORM_STATE_CAP)
    writeOpenUIFormState('rewrite-0', { n: 100 })
    writeOpenUIFormState('rewrite-new', { n: 99 })
    // If the re-write had not refreshed recency, rewrite-0 would be the
    // evicted entry instead of rewrite-1.
    expect(readOpenUIFormState('rewrite-0')).toEqual({ n: 100 })
    expect(readOpenUIFormState('rewrite-1')).toBeUndefined()
  })
})