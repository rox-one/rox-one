/**
 * Boot-closure split: `shared/types.ts` used `export * from '@rox/shared/protocol'`,
 * a value re-export. Any boot file that value-imported a helper from the barrel
 * (`generateMessageId`, `RPC_CHANNELS`, `isSessionsNavigation`, …) evaluated
 * protocol dto.ts + channels.ts (~120 KB of source) on every launch.
 *
 * Protocol types stay as `export type *`. Runtime `RPC_CHANNELS` is imported
 * from `@rox/shared/protocol/channels` so the protocol barrel cannot evaluate
 * routing.ts (54 KB of channel Sets) on boot. `generateMessageId` in App.tsx
 * uses the local event-processor helper. `boot-manifest.json` guards the built
 * graph; this is the source-level guard that fails in a plain `bun test` run.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const renderer = join(import.meta.dir, '..')
const electronSrc = join(renderer, '..')

function read(rel: string): string {
  return readFileSync(join(electronSrc, rel), 'utf8')
}

function staticImportLines(src: string): string {
  return src
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line) || /^\s*\}?\s*from\s+['"]/.test(line))
    .join('\n')
}

describe('protocol values stay out of the shared/types boot barrel', () => {
  it('types.ts re-exports protocol as types only', () => {
    const types = read('shared/types.ts')
    expect(types).toContain("export type * from '@rox/shared/protocol'")
    expect(types).not.toMatch(/^export \* from '@rox\/shared\/protocol'/m)
    expect(types).not.toMatch(/export\s*\{[^}]*RPC_CHANNELS/)
  })

  it('App.tsx does not value-import generateMessageId from the barrel', () => {
    const app = read('renderer/App.tsx')
    expect(app).toContain("import { generateMessageId } from './event-processor/helpers'")
    const staticImports = staticImportLines(app)
    expect(staticImports).not.toMatch(/generateMessageId[\s\S]*from ['"][^'"]*shared\/types['"]/)
  })

  it('boot toolchain hook does not value-import RPC_CHANNELS from the barrel', () => {
    const hook = read('renderer/hooks/useToolchainStatus.ts')
    const staticImports = staticImportLines(hook)
    expect(staticImports).toContain("from '@rox/shared/protocol/channels'")
    expect(staticImports).not.toMatch(/RPC_CHANNELS[\s\S]*from ['"][^'"]*shared\/types['"]/)
    expect(staticImports).not.toMatch(/from ['"]@rox\/shared\/protocol['"]/)
  })

  it('menu-schema (boot) does not pull protocol through the types barrel', () => {
    const schema = read('shared/menu-schema.ts')
    expect(schema).toContain("import { RPC_CHANNELS } from '@rox/shared/protocol/channels'")
    expect(schema).not.toMatch(/from ['"]\.\/types['"]/)
  })

  it('boot notifications hook loads channels, not the protocol barrel', () => {
    const hook = read('renderer/hooks/useNotifications.ts')
    expect(hook).toContain("from '@rox/shared/protocol/channels'")
    expect(staticImportLines(hook)).not.toMatch(/from ['"]@rox\/shared\/protocol['"]/)
  })

  it('CollectionBulkBar value-imports the bulk limit, not dto.ts', () => {
    const bar = read('renderer/components/app-shell/collection/CollectionBulkBar.tsx')
    const staticImports = staticImportLines(bar)
    expect(staticImports).toContain("from '@rox/shared/protocol/bulk-limit'")
    expect(staticImports).not.toMatch(/BULK_UPDATE_MAX_IDS[\s\S]*from ['"]@rox\/shared\/protocol\/dto['"]/)
    const dto = readFileSync(join(import.meta.dir, '../../../../../packages/shared/src/protocol/dto.ts'), 'utf8')
    expect(dto).toContain("export { BULK_UPDATE_MAX_IDS } from './bulk-limit'")
    expect(dto).not.toMatch(/export const BULK_UPDATE_MAX_IDS/)
  })
})
