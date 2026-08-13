/**
 * Infisical availability diagnostic for the settings GET payload.
 * Never resolves secret values — token missing → typed INFISICAL_UNAVAILABLE.
 */
import { describe, expect, it } from 'bun:test'
import { diagnoseInfisicalAvailability } from '../availability.ts'

describe('diagnoseInfisicalAvailability', () => {
  it('returns typed INFISICAL_UNAVAILABLE when the token is missing', async () => {
    const result = await diagnoseInfisicalAvailability({
      token: undefined,
      projectId: 'proj-test',
      environment: 'dev',
    })
    expect(result.available).toBe(false)
    expect(result.errorCode).toBe('INFISICAL_UNAVAILABLE')
    expect(Object.keys(result).sort()).toEqual(['available', 'errorCode'])
  })

  it('returns available when token, projectId and environment are set', async () => {
    const result = await diagnoseInfisicalAvailability({
      token: 'st.test-not-resolved',
      projectId: 'proj-test',
      environment: 'dev',
    })
    expect(result).toEqual({ available: true })
    expect(JSON.stringify(result)).not.toContain('st.test-not-resolved')
  })
})
