import { describe, expect, it } from 'bun:test'
import { shouldBrokerGatePermission } from './permission-broker-gate.ts'

describe('shouldBrokerGatePermission', () => {
  it('gates only admin_approval that has a command hash', () => {
    expect(shouldBrokerGatePermission({ type: 'admin_approval', commandHash: 'abc' })).toBe(true)
  })

  it('does not fail-close OMP host-tool prompts (admin_approval, no command)', () => {
    expect(shouldBrokerGatePermission({ type: 'admin_approval' })).toBe(false)
    expect(shouldBrokerGatePermission({ type: 'admin_approval', commandHash: '' })).toBe(false)
  })

  it('does not gate ordinary tool permission types', () => {
    expect(shouldBrokerGatePermission({ type: 'mcp_mutation' })).toBe(false)
    expect(shouldBrokerGatePermission({ type: 'bash' })).toBe(false)
    expect(shouldBrokerGatePermission(undefined)).toBe(false)
  })
})
