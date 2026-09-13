import { describe, expect, it } from 'bun:test'
import {
  parseDsclRealName,
  parseWorkspaceMachineName,
} from '../user-display-name.ts'

describe('parseDsclRealName', () => {
  it('reads a single-line RealName', () => {
    expect(parseDsclRealName('RealName: Jane Doe')).toBe('Jane Doe')
  })

  it('reads a multi-line RealName', () => {
    expect(parseDsclRealName('RealName:\n Jane Doe\n')).toBe('Jane Doe')
  })

  it('rejects an empty RealName key', () => {
    expect(parseDsclRealName('RealName:')).toBeNull()
  })
})

describe('parseWorkspaceMachineName', () => {
  it('uses the computer hostname, not the macOS RealName', () => {
    expect(parseWorkspaceMachineName('Marks-MacBook-Pro.local', 'jane')).toBe('Marks-MacBook-Pro')
  })

  it('falls back to the OS username when hostname is localhost', () => {
    expect(parseWorkspaceMachineName('localhost', 'jane')).toBe('jane')
    expect(parseWorkspaceMachineName('', 'jane')).toBe('jane')
  })

  it('falls back to Workspace when both hostname and username are empty', () => {
    expect(parseWorkspaceMachineName('localhost.localdomain', '  ')).toBe('Workspace')
    expect(parseWorkspaceMachineName('', null)).toBe('Workspace')
  })
})
