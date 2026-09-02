import { describe, expect, it } from 'bun:test'
import { createSyntheticBundleSteps, profileBundleSteps } from '../bundle-profile'

describe('bundle profile track', () => {
  it('profiles synthetic minify steps without hanging', async () => {
    const result = await profileBundleSteps(createSyntheticBundleSteps())
    expect(result.hung).toBe(false)
    expect(result.steps.map((s) => s.name)).toEqual(['parse-graph', 'minify-js', 'write-assets'])
  })

  it('marks a hang on a slow step and stops the track', async () => {
    const result = await profileBundleSteps(
      [
        { name: 'ok', run: () => {} },
        { name: 'slow-minify', run: () => {} },
      ],
      { hangMs: 5, now: (() => { let t = 0; return () => { t += 10; return t } })() },
    )
    expect(result.hung).toBe(true)
    expect(result.steps).toHaveLength(1)
  })
})
