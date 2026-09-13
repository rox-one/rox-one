import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../CompletionStep.tsx'), 'utf8')

describe('onboarding first result chrome', () => {
  it('wires Note→Outcome→Task copy and does not treat local profile as account auth', () => {
    expect(source).toContain("t(\"onboarding.completion.firstResultCreate\")")
    expect(source).toContain("t(\"onboarding.completion.firstResultSkip\")")
    expect(source).toContain("t(\"onboarding.completion.firstResultHint\")")
    expect(source).toContain("t(\"onboarding.completion.localProfileHint\")")
    expect(source).toContain('isAccountRegistered')
    expect(source).toContain('createOfflineFirstResult')
    expect(source).toContain("t(\"knowledge.migrate.failed\")")
    expect(source).toContain("t(\"common.retry\")")
    expect(source).toContain("t(\"knowledge.migrate.success\"")
    expect(source).toContain("t(\"onboarding.welcome.getStarted\")")
    expect(source).toContain('createDefaultFirstResultPorts')
    expect(source).toContain('isFirstResultImportSkipped')
    expect(source).not.toContain('evaluateReleaseGate')
    expect(source).not.toContain('sendMessage(')
    expect(source).not.toContain('createTask(')
    expect(source).not.toMatch(/createNote\(workspaceId,\s*note\.title\)/)
  })
})
