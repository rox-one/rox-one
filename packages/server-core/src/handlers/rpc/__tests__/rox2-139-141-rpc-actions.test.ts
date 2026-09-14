import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-139..141 native RPC list/read/act gates', () => {
  test('auth.ts gates list/read/act and does not claim DTO ok as live', () => {
    const auth = source('packages/server-core/src/handlers/rpc/auth.ts')
    expect(auth).toContain('rpcAuthListResult')
    expect(auth).toContain('rpcAuthReadResult')
    expect(auth).toContain('rpcAuthActResult')
    expect(auth).toContain("action: 'write'")
    expect(auth).toContain("action: 'destroy'")
    expect(auth).not.toContain('conation.dev')
    expect(auth).not.toContain('CompleteMutationRoot')
  })

  test('automations.ts gates list/read/act and does not embed Conation', () => {
    const automations = source('packages/server-core/src/handlers/rpc/automations.ts')
    expect(automations).toContain('rpcAutomationsListResult')
    expect(automations).toContain('rpcAutomationsReadResult')
    expect(automations).toContain('rpcAutomationsActResult')
    expect(automations).toContain("action: 'write'")
    expect(automations).toContain("action: 'destroy'")
    expect(automations).not.toContain('conation.dev')
    expect(automations).not.toContain('CompleteMutationRoot')
  })

  test('browser-pane.ts gates list/read/act and does not embed Conation', () => {
    const pane = source('packages/server-core/src/handlers/rpc/browser-pane.ts')
    expect(pane).toContain('rpcBrowserPaneListResult')
    expect(pane).toContain('rpcBrowserPaneReadResult')
    expect(pane).toContain('rpcBrowserPaneActResult')
    expect(pane).toContain("action: 'write'")
    expect(pane).toContain("action: 'destroy'")
    expect(pane).not.toContain('conation.dev')
    expect(pane).not.toContain('CompleteMutationRoot')
  })
})
