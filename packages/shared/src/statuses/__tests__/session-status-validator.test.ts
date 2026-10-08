import { afterAll, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStatusValidator, validateSessionStatus } from '../validation.ts'

const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'status-validator-')))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

test('batch validator matches validateSessionStatus and reads the status config once', () => {
  const inputs = [undefined, '', 'todo', 'done', 'deleted-status', 'todo', 'cancelled']
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const expected = inputs.map(status => validateSessionStatus(root, status))
    const exists = spyOn(fs, "existsSync")
    try {
      const validate = createSessionStatusValidator(root)
      expect(inputs.map(validate)).toEqual(expected)
      const configChecks = exists.mock.calls.filter(([path]) => String(path).endsWith(join('statuses', 'config.json')))
      expect(configChecks.length).toBeLessThanOrEqual(1)
    } finally {
      exists.mockRestore()
    }
  } finally {
    warn.mockRestore()
  }
})

test('batch validator never reads the config when no session carries a status', () => {
  const missing = join(root, 'never-created')
  const validate = createSessionStatusValidator(missing)
  expect([undefined, ''].map(validate)).toEqual(['todo', 'todo'])
  expect(fs.existsSync(missing)).toBe(false)
})
