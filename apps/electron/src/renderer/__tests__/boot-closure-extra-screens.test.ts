/**
 * Boot-closure split (audit 2026-10-13, entry-связка): AppShell statically imported
 * `@/pages/extra-screens/background`, and AppShell is in the boot module graph — so the exported
 * chunk carrying the extra-screens subsystem (~1.94 MB) was preloaded on every launch, even though
 * everything it installs is timer-driven and off first paint.
 *
 * The measured failure this pins: index.html's static JS closure is 3.93 MB, of which
 * `calendar-autostart-*.js` was 1.94 MB. `boot-manifest.json` guards the same boundary on a real
 * build; this is the source-level guard that fails in a plain `bun test` run.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const renderer = join(import.meta.dir, '..')

function read(rel: string): string {
  return readFileSync(join(renderer, rel), 'utf8')
}

describe('extra-screens background work stays off the boot closure', () => {
  it('AppShell does not statically import the subsystem', () => {
    const appShell = read('components/app-shell/AppShell.tsx')
    expect(appShell).not.toMatch(/import\s+\{[^}]*useExtraScreensBackground[^}]*\}\s*from/)
    expect(appShell).not.toMatch(/from\s+["']@\/pages\/extra-screens\/background["']/)
    expect(appShell).not.toMatch(/useExtraScreensBackground\s*\(/)
  })

  it('reaches it through one lazy host instead', () => {
    const appShell = read('components/app-shell/AppShell.tsx')
    expect(appShell).toContain('React.lazy(() => import("@/platform/ExtraScreensBackground"))')
    expect(appShell).toContain('<ExtraScreensBackground workspaceId={activeWorkspaceId ?? null} />')
  })

  it('the host is the only module that still pulls the subsystem, and it renders nothing', () => {
    const hostPath = join(renderer, 'platform', 'ExtraScreensBackground.tsx')
    expect(existsSync(hostPath)).toBe(true)
    const host = readFileSync(hostPath, 'utf8')
    expect(host).toMatch(/from\s+'@\/pages\/extra-screens\/background'/)
    expect(host).toContain('export default function ExtraScreensBackground')
    expect(host).toContain('return null')
  })
})
