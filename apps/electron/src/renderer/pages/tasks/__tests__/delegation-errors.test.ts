import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInstance } from 'i18next'
import { PersonalTaskLinkError } from '../../../features/product-tour/adapters/work/tasks-projects/native-commit'
import { taskDelegationErrorKey } from '../delegation-errors'

const localeDir = resolve(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')
const locales = readdirSync(localeDir).filter(file => file.endsWith('.json')).sort()
const reasons = [
  new PersonalTaskLinkError('revision-conflict'),
  new PersonalTaskLinkError('write-unconfirmed'),
  new PersonalTaskLinkError('readback-failed'),
  new Error('Private native storage failure in English'),
]

test('task delegation maps native reconciliation reasons and unknown failures without displaying raw errors', () => {
  expect(reasons.map(taskDelegationErrorKey)).toEqual([
    'tasks.delegate.error.taskChanged',
    'tasks.delegate.error.writeUnconfirmed',
    'tasks.delegate.error.readBackFailed',
    'tasks.delegate.error.unavailable',
  ])
  expect(taskDelegationErrorKey('Private RPC failure')).toBe('tasks.delegate.error.unavailable')
  expect(taskDelegationErrorKey(null)).toBe('tasks.delegate.error.unavailable')
})

test('all 12 locales translate task delegation reconciliation errors at the presentation boundary', async () => {
  expect(locales).toHaveLength(12)
  const english = JSON.parse(readFileSync(resolve(localeDir, 'en.json'), 'utf8')) as Record<string, string>
  for (const file of locales) {
    const language = file.slice(0, -5)
    const strings = JSON.parse(readFileSync(resolve(localeDir, file), 'utf8')) as Record<string, string>
    const i18n = createInstance()
    await i18n.init({ lng: language, fallbackLng: false, keySeparator: false, resources: { [language]: { translation: strings } } })
    for (const error of reasons) {
      const key = taskDelegationErrorKey(error)
      const reason = i18n.t(key)
      expect(reason).toBe(strings[key])
      expect(reason).not.toBe(key)
      expect(reason).not.toBe(error.message)
      const presented = i18n.t('tasks.delegate.failed', { error: reason })
      expect(presented).toContain(reason)
      expect(presented).not.toContain('{{error}}')
      expect(presented).not.toContain('Private native storage failure')
      if (language !== 'en') {
        expect(reason).not.toBe(english[key])
        expect(strings['tasks.delegate.failed']).not.toBe(english['tasks.delegate.failed'])
      }
    }
  }
})
