import { describe, expect, it } from 'bun:test'
import {
  buildSuggestInput,
  normalizeSuggestResult,
  suggestErrorMessageKey,
} from '../profile-suggest'
import { DEFAULT_PROFILE_FORM } from '../profile-form'

describe('suggest result handling', () => {
  it('accepts a valid ok+text reply', () => {
    expect(normalizeSuggestResult({ ok: true, text: '  черновик  ' })).toEqual({ ok: true, text: '  черновик  ' })
  })

  it('rejects ok replies without usable text', () => {
    expect(normalizeSuggestResult({ ok: true, text: '   ' })).toEqual({ ok: false, reason: 'error' })
    expect(normalizeSuggestResult({ ok: true })).toEqual({ ok: false, reason: 'error' })
  })

  it('preserves the explicit no-provider reason', () => {
    expect(normalizeSuggestResult({ ok: false, reason: 'no-provider' })).toEqual({ ok: false, reason: 'no-provider' })
  })

  it('coerces unknown payloads and reasons to an error, never fake text', () => {
    expect(normalizeSuggestResult(null)).toEqual({ ok: false, reason: 'error' })
    expect(normalizeSuggestResult('text')).toEqual({ ok: false, reason: 'error' })
    expect(normalizeSuggestResult({ ok: false, reason: 'weird' })).toEqual({ ok: false, reason: 'error' })
  })

  it('maps reasons to i18n keys', () => {
    expect(suggestErrorMessageKey('no-provider')).toBe('onboarding.profile.suggestNoProvider')
    expect(suggestErrorMessageKey('timeout')).toBe('onboarding.profile.suggestTimeout')
    expect(suggestErrorMessageKey('error')).toBe('onboarding.profile.suggestError')
  })
})

describe('buildSuggestInput', () => {
  it('drops empty strings and maps bubble labels', () => {
    const input = buildSuggestInput({ ...DEFAULT_PROFILE_FORM, name: '  ', city: 'Москва', bubbles: ['design', 'ai'] })
    expect(input.name).toBeUndefined()
    expect(input.city).toBe('Москва')
    expect(input.bubbles).toEqual(['design', 'ai'])
    expect(input.bubbleLabels).toEqual(['Дизайн', 'Искусственный интеллект'])
    expect(input.timezone).toBe('Europe/Moscow')
  })
})