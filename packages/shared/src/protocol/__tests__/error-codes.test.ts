import { describe, expect, it } from 'bun:test'
import { isErrorCode } from '../types.ts'

describe('protocol ErrorCode — secrets settings', () => {
  it('recognizes SECRET_ENVVAR_DENIED so settings SET can throw a typed deny', () => {
    expect(isErrorCode('SECRET_ENVVAR_DENIED')).toBe(true)
  })
})
