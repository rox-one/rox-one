import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRox2Cards } from '../registry.ts'
import { ROX2_SCREENS } from '../inventory.ts'

const ROOT = join(import.meta.dir, '../../..')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-192 Voice overlay is native, not Conation', () => {
  test('overlay and voice RPC stay native; mic is device-read, not spend', () => {
    const overlay = source('apps/electron/src/renderer/voice-overlay.tsx')
    expect(overlay).toContain('VOICE_OVERLAY_REQUIRES_CONATION_FLAG')
    expect(overlay).not.toContain('conation.dev')
    expect(overlay).not.toMatch(/<iframe\b/i)
    const rpc = source('packages/server-core/src/handlers/rpc/voice.ts')
    expect(rpc).toContain('rpcVoiceActResult')
    expect(rpc).toContain("action: 'write'")
    expect(rpc).not.toContain("action: 'spend'")
    expect(rpc).not.toContain('conation.dev')
    expect(rpc).not.toContain('CompleteMutationRoot')
  })
})

describe('ROX2-193 Web UI parity is not desktop completion', () => {
  test('webui is inventoried separately; missing parity stays listed, not faked', () => {
    const webui = ROX2_SCREENS.find((row) => row.id === 'webui')
    expect(webui).toBeDefined()
    expect(webui?.files).toEqual(['apps/webui/src/App.tsx'])
    expect(webui?.coverage).toContain('Parity with desktop is incomplete')
    const app = source('apps/webui/src/App.tsx')
    expect(app).toContain('WEBUI_REQUIRES_CONATION_FLAG')
    expect(app).not.toContain('conation.dev')
    expect(app).not.toMatch(/<iframe\b/i)
    expect(app).not.toContain('CompleteMutationRoot')
  })
})

describe('ROX2-194 Extension host crash isolation remains unfinished', () => {
  test('docs keep crash isolation leftover; extensions RPC is not a Conation shell', () => {
    const docs = source('docs/unfinished-initiatives.md')
    expect(docs).toContain('crash isolation/restart UX Extension Host')
    expect(docs).not.toMatch(/unified shell complete/i)
    const rpc = source('packages/server-core/src/handlers/rpc/extensions.ts')
    expect(rpc).not.toContain('conation.dev')
    expect(rpc).not.toContain('CompleteMutationRoot')
  })
})

describe('ROX2-195 Connection fabric recovery is leftover', () => {
  test('fabric recovery stays leftover; MCP connection handlers are not Conation', () => {
    const docs = source('docs/unfinished-initiatives.md')
    expect(docs).toContain('восстановление после повреждения')
    expect(docs).toContain('Rox Connection Fabric')
    const fabric = source('packages/server-core/src/handlers/rpc/fabric.ts')
    const runtime = source('packages/server-core/src/handlers/rpc/fabric-runtime.ts')
    expect(fabric).not.toContain('conation.dev')
    expect(runtime).not.toContain('conation.dev')
    expect(fabric).not.toContain('CompleteMutationRoot')
    expect(runtime).not.toContain('CompleteMutationRoot')
  })
})

describe('ROX2-196 Native substrate remains opt-in', () => {
  test('unfinished-initiatives still names substrate as opt-in, not a ROX2 default', () => {
    const docs = source('docs/unfinished-initiatives.md')
    expect(docs).toContain('Native substrate')
    expect(docs).toContain('opt-in sidecar')
    expect(docs).not.toMatch(/native substrate is required/i)
    expect(docs).not.toMatch(/substrate is default-on/i)
  })
})

describe('ROX2-197 Identity irreversible IDs stay blocked', () => {
  test('website client-id flip stays human-blocked; protocol IDs are not rewritten here', () => {
    const decision = source('plans/next-program/decisions/005-website-client-id.md')
    expect(decision).toContain('Do not flip the default')
    expect(decision).toContain('An agent must not flip the default `clientId`')
    const docs = source('docs/unfinished-initiatives.md')
    expect(docs).toContain('irreversible identifiers')
    expect(docs).toContain('Connect `clientId` flip')
  })
})

describe('ROX2-198 Branch hygiene stays human-gated', () => {
  test('decision 006 forbids agent remote branch deletion', () => {
    const decision = source('plans/next-program/decisions/006-branch-deletion.md')
    expect(decision).toContain('An agent must not delete remote branches')
    expect(decision).toContain('Do not run §5')
    expect(decision).toContain('No `git push --delete`')
  })
})

describe('ROX2-199 Emit machine-readable registry JSON', () => {
  test('registry.json is checked in and matches buildRox2Cards()', () => {
    expect(existsSync(join(ROOT, 'plans/rox2/emit.ts'))).toBe(true)
    const cards = buildRox2Cards()
    const registry = JSON.parse(source('plans/rox2/registry.json')) as {
      cardCount: number
      cards: Array<{ id: string; title: string }>
    }
    expect(registry.cardCount).toBe(200)
    expect(registry.cards.map((card) => card.id)).toEqual(cards.map((card) => card.id))
    expect(registry.cards.map((card) => card.title)).toEqual(cards.map((card) => card.title))
    const emit = source('plans/rox2/emit.ts')
    expect(emit).toContain("join(dir, 'registry.json')")
  })
})

describe('ROX2-200 Closeout: #315 accepts inventory, not product completion', () => {
  test('README states charter closeout is inventory, not live Drive/Mail/CRM', () => {
    const readme = source('plans/rox2/README.md')
    expect(readme).toContain('issue #315')
    expect(readme).toContain('does **not** claim')
    expect(readme).toContain('Closing #315 means these artifacts exist, not that the 200 cards are implemented')
    expect(readme).toContain('Do not infer product readiness from the number of merged PRs')
    const leftover = buildRox2Cards().find((card) => card.title.startsWith('Closeout:'))
    expect(leftover?.id).toBe('ROX2-200')
    expect(leftover?.status).toBe('open')
    expect(leftover?.toBe).toContain('does not mean Drive/Mail/CRM')
  })
})
