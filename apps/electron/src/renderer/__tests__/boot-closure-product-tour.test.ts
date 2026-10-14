/**
 * Boot-closure split: App.tsx always mounts ProductTourProvider, and the
 * provider used to statically import the 96 KB catalogue, the engine, and
 * (via catalogue/dynamic → validate) the catalogue a second time. Tours do
 * not run until the feature flag is on and shellReady; the host wraps the
 * whole app so it cannot itself be React.lazy (that remounts the shell).
 *
 * Catalogue + engine + dynamic admission are therefore loaded with import()
 * after the flag is on. Overlay/popover/vignette follow the same gate so the
 * host's static graph keeps only the target registry and error boundary.
 * initialRuntimeState stays in a 4-line module so the host can seed idle
 * state without the engine. `boot-manifest.json` guards the built graph;
 * this is the source-level guard that fails in a plain `bun test` run.
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

describe('product-tour catalogue and engine stay out of the boot closure', () => {
  it('App still statically mounts the host (hooks keep working)', () => {
    const app = read('App.tsx')
    expect(app).toContain("import { ProductTourProvider, ProductTourHost } from '@/features/product-tour/runtime'")
    expect(app).toContain('<ProductTourProvider')
  })

  it('the host does not statically import catalogue, engine, or the catalogue barrel', () => {
    const host = read('features/product-tour/runtime/ProductTourProvider.tsx')
    const staticImports = staticImportLines(host)
    expect(staticImports).not.toMatch(/from\s+['"]\.\.\/catalogue['"]/)
    expect(staticImports).not.toMatch(/from\s+['"]\.\.\/catalogue\/product-tour-catalogue['"]/)
    expect(staticImports).not.toMatch(/from\s+['"]\.\.\/catalogue\/dynamic['"]/)
    expect(staticImports).not.toMatch(/from\s+['"]\.\.\/core['"]/)
    expect(staticImports).toMatch(/from\s+['"]\.\.\/core\/initial-state['"]/)
    expect(host).toContain("import('../core')")
    expect(host).toContain("import('../catalogue/product-tour-catalogue')")
    expect(host).toContain("import('../catalogue/dynamic')")
  })

  it('the host does not statically import overlay, popover, or the ui barrel', () => {
    const host = read('features/product-tour/runtime/ProductTourProvider.tsx')
    const staticImports = staticImportLines(host)
    expect(staticImports).not.toMatch(/from\s+['"]\.\.\/ui['"]/)
    expect(staticImports).not.toMatch(/SpotlightOverlay/)
    expect(staticImports).not.toMatch(/TourPopover/)
    expect(staticImports).not.toMatch(/TourVignette/)
    expect(staticImports).toMatch(/from\s+['"]\.\.\/ui\/target-registry['"]/)
    expect(staticImports).toMatch(/from\s+['"]\.\.\/ui\/TourErrorBoundary['"]/)
    expect(host).toContain("import('../ui/presentation')")
  })

  it('validate.ts does not import the static catalogue (dynamic admission would drag it into boot)', () => {
    const validate = read('features/product-tour/catalogue/validate.ts')
    const staticImports = staticImportLines(validate)
    expect(staticImports).not.toMatch(/product-tour-catalogue/)
  })
})
