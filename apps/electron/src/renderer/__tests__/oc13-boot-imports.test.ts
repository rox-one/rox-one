/**
 * OC-13 / #1675 (entry closure): the first-run onboarding graph must stay off
 * App.tsx's static import list.
 *
 * The measured failure this pins: App.tsx statically imported `useOnboarding`,
 * so Vite grouped the whole onboarding graph into `useOnboarding-*.js` (2.02 MB)
 * and listed it in index.html's modulepreload closure — paid on every launch for
 * a flow that runs at most once. `boot-manifest.json` guards the route-level
 * version of this boundary on a real build; this is the source-level guard that
 * fails in a plain `bun test` run.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const renderer = join(import.meta.dir, '..')
const appTsx = readFileSync(join(renderer, 'App.tsx'), 'utf8')
const hostPath = join(renderer, 'OnboardingHost.tsx')

describe('OC-13: onboarding is lazy in App.tsx', () => {
  it('does not statically import the onboarding hook', () => {
    expect(appTsx).not.toMatch(/from\s+'@\/hooks\/useOnboarding'/)
    expect(appTsx).not.toMatch(/useOnboarding\s*\(/)
  })

  it('does not statically import the onboarding barrel', () => {
    expect(appTsx).not.toMatch(/from\s+'@\/components\/onboarding'/)
  })

  it('reaches the wizard through one lazy OnboardingHost edge', () => {
    expect(appTsx).toContain("const OnboardingHost = React.lazy(() => import('./OnboardingHost'))")
    // The lazy host is the only render site and it remounts after a reset.
    expect(appTsx).toContain('<OnboardingHost')
    expect(appTsx).toContain('key={onboardingEpoch}')
  })
})

describe('OC-13: OnboardingHost owns the hook', () => {
  it('exists and is a module the lazy edge can resolve', () => {
    expect(existsSync(hostPath)).toBe(true)
    const host = readFileSync(hostPath, 'utf8')
    expect(host).toMatch(/from\s+'@\/hooks\/useOnboarding'/)
    expect(host).toMatch(/from\s+'@\/components\/onboarding'/)
    expect(host).toContain('export default function OnboardingHost')
    // A dynamic import resolves the module namespace, not a named binding, so
    // React.lazy needs the default export (no `.then((m) => …)` in App.tsx).
    expect(host).toContain('return (')
  })
})
