import { describe, expect, test } from 'bun:test'
import { LINK_TTL_MS, MAX_ATTEMPTS } from '../src/link.ts'
import { memoryState, NOW } from './helpers.ts'

describe('link state', () => {
  test('a new link is waiting with no code and the 30-minute TTL', () => {
    const state = memoryState()
    const link = state.createLink('acc-1', 'Work', NOW, LINK_TTL_MS)
    expect(link.status).toBe('waiting')
    expect(link.code).toBeNull()
    expect(link.phone).toBeNull()
    expect(link.accountLabel).toBe('Work')
    expect(link.expiresAt).toBe(NOW + LINK_TTL_MS)
    expect(state.status(link.linkId, NOW)).toEqual({ status: 'waiting' })
    state.close()
  })

  test('sharing a phone issues an 8-letter code exactly once', () => {
    const state = memoryState({ code: 'ABCDEFGH' })
    const link = state.createLink('acc-1', null, NOW, LINK_TTL_MS)
    state.bindChat('42', link.linkId, NOW)

    const issued = state.issueCode('42', '+79991234567', NOW)
    expect(issued?.issued).toBe(true)
    expect(issued?.record.code).toBe('ABCDEFGH')
    expect(issued?.record.status).toBe('code_issued')

    const again = state.issueCode('42', '+79991234567', NOW + 1000)
    expect(again?.issued).toBe(false)
    expect(again?.record.code).toBe('ABCDEFGH')

    expect(state.status(link.linkId, NOW)).toEqual({
      status: 'code_issued',
      code: 'ABCDEFGH',
      phoneMasked: '+7********67',
    })
    state.close()
  })

  test('a foreign chat with no bound link cannot issue a code', () => {
    const state = memoryState()
    const link = state.createLink('acc-1', null, NOW, LINK_TTL_MS)
    expect(state.issueCode('99', '+79991234567', NOW)).toBeNull()
    expect(state.status(link.linkId, NOW)).toEqual({ status: 'waiting' })
    state.close()
  })

  test('a correct code confirms once and is idempotent afterwards', () => {
    const state = memoryState({ code: 'ABCDEFGH' })
    const link = state.createLink('acc-1', null, NOW, LINK_TTL_MS)
    state.bindChat('42', link.linkId, NOW)
    state.issueCode('42', '+79991234567', NOW)

    expect(state.confirm(link.linkId, 'abcdefgh', NOW + 1, MAX_ATTEMPTS)).toBe('confirmed')
    expect(state.confirm(link.linkId, 'ABCDEFGH', NOW + 2, MAX_ATTEMPTS)).toBe('confirmed')
    expect(state.status(link.linkId, NOW + 2)).toEqual({
      status: 'confirmed',
      phoneMasked: '+7********67',
      confirmedAt: NOW + 1,
    })
    state.close()
  })

  test('a wrong code is invalid and never confirms', () => {
    const state = memoryState({ code: 'ABCDEFGH' })
    const link = state.createLink('acc-1', null, NOW, LINK_TTL_MS)
    state.bindChat('42', link.linkId, NOW)
    state.issueCode('42', '+79991234567', NOW)

    expect(state.confirm(link.linkId, 'ZZZZZZZZ', NOW, MAX_ATTEMPTS)).toBe('invalid')
    expect(state.byId(link.linkId)?.attempts).toBe(1)
    expect(state.byId(link.linkId)?.status).toBe('code_issued')
    state.close()
  })

  test(`the link is invalidated after ${MAX_ATTEMPTS} wrong attempts`, () => {
    const state = memoryState({ code: 'ABCDEFGH' })
    const link = state.createLink('acc-1', null, NOW, LINK_TTL_MS)
    state.bindChat('42', link.linkId, NOW)
    state.issueCode('42', '+79991234567', NOW)

    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) {
      expect(state.confirm(link.linkId, 'ZZZZZZZZ', NOW, MAX_ATTEMPTS)).toBe('invalid')
    }
    expect(state.confirm(link.linkId, 'ZZZZZZZZ', NOW, MAX_ATTEMPTS)).toBe('invalid')
    expect(state.byId(link.linkId)?.status).toBe('expired')
    // Even the correct code cannot revive an invalidated link.
    expect(state.confirm(link.linkId, 'ABCDEFGH', NOW, MAX_ATTEMPTS)).toBe('expired')
    state.close()
  })

  test('expiry is swept on access and blocks confirmation', () => {
    const state = memoryState({ code: 'ABCDEFGH' })
    const link = state.createLink('acc-1', null, NOW, LINK_TTL_MS)
    state.bindChat('42', link.linkId, NOW)
    state.issueCode('42', '+79991234567', NOW)

    const after = NOW + LINK_TTL_MS
    expect(state.status(link.linkId, after)).toEqual({ status: 'expired' })
    expect(state.byId(link.linkId)?.status).toBe('expired')
    expect(state.confirm(link.linkId, 'ABCDEFGH', after, MAX_ATTEMPTS)).toBe('expired')
    expect(state.issueCode('42', '+79991234567', after)).toBeNull()
    state.close()
  })

  test('unknown links are reported as not_found and never confirm', () => {
    const state = memoryState()
    expect(state.status('nope', NOW)).toBeNull()
    expect(state.confirm('nope', 'ABCDEFGH', NOW, MAX_ATTEMPTS)).toBe('not_found')
    state.close()
  })
})