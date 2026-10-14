/**
 * Boot-closure split: AppShell statically imported SuperEngineeringShellExtras,
 * which pulled WhatsNewSheet, SeChatPictureInPicture (deferred-motion) and
 * SuperEngineeringOnboardingDialog (Radix Dialog + Button) into the first
 * paint even when the SE profile is off and every overlay is closed.
 *
 * The extras host stays eager (it has to register the PiP action + gate).
 * The overlay modules load through `import()`. `useSeOnboardingGate` lives
 * on a leaf so the gate can run without evaluating the dialog UI.
 *
 * `boot-manifest.json` guards the built graph; this is the source-level
 * guard that fails in a plain `bun test` run.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const renderer = join(import.meta.dir, '..')

function read(rel: string): string {
  return readFileSync(join(renderer, rel), 'utf8')
}

function staticImportLines(src: string): string {
  return src
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line) || /^\s*\}?\s*from\s+['"]/.test(line))
    .join('\n')
}

describe('SE overlays stay out of the boot closure', () => {
  it('SuperEngineeringShellExtras lazy-loads overlay UI and keeps the gate as a leaf', () => {
    const extras = read('components/app-shell/SuperEngineeringShellExtras.tsx')
    const staticImports = staticImportLines(extras)
    expect(staticImports).not.toMatch(/from\s+['"]\.\/WhatsNewSheet['"]/)
    expect(staticImports).not.toMatch(/from\s+['"]\.\/SeChatPictureInPicture['"]/)
    expect(staticImports).not.toMatch(/from\s+['"]@\/components\/onboarding\/SuperEngineeringOnboardingDialog['"]/)
    expect(extras).toContain("import('@/components/onboarding/SuperEngineeringOnboardingDialog')")
    expect(extras).toContain("import('./WhatsNewSheet')")
    expect(extras).toContain("import('./SeChatPictureInPicture')")
    expect(staticImports).toMatch(/from\s+['"]@\/components\/onboarding\/se-onboarding-gate['"]/)
    expect(extras).toMatch(/onboarding\.shouldShow\s+&&/)
    expect(extras).toMatch(/whatsNewOpen\s+&&/)
  })

  it('se-onboarding-gate is a leaf: no Dialog / Button / overlay UI', () => {
    const src = read('components/onboarding/se-onboarding-gate.ts')
    const staticImports = staticImportLines(src)
    expect(staticImports).not.toMatch(/dialog|button|WhatsNewSheet|SeChatPictureInPicture|SuperEngineeringOnboarding[^G]/i)
    expect(src).toContain('export function useSeOnboardingGate')
  })
})
