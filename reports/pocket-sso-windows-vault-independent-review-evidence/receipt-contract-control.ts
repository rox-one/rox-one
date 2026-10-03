import { projectNativeVaultReceipt } from './validator-before/pocket-vault-diagnostics'

// Metadata validation control only. No native process, OAuth or secret inputs.
const cases = [
  { label: 'missing-proof-fields', input: { phase: 'write', platform: 'win32', passed: true } },
  { label: 'encryption-unavailable', input: { phase: 'write', platform: 'win32', passed: true, stage: 'complete', encryptionAvailable: false, electron: '39.2.7' } },
  { label: 'writable-flush-failed', input: { phase: 'write', platform: 'win32', passed: true, stage: 'complete', encryptionAvailable: true, electron: '39.2.7', fsync: [{ access: 'writable', opened: true, flushed: false, code: 'EPERM' }] } },
  { label: 'incomplete-stage', input: { phase: 'write', platform: 'win32', passed: true, stage: 'account_write', encryptionAvailable: true, electron: '39.2.7' } },
]
for (const {label, input} of cases) {
  const projected = projectNativeVaultReceipt(input, 'write')
  if (!projected?.passed) throw Error('control_expectation_changed')
  console.log(JSON.stringify({ label, acceptedPassed: projected.passed, projected }))
}
