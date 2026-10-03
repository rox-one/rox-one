import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { productTourCatalogue } from './index'

const localesPath = resolve(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')
const locales = Object.fromEntries(readdirSync(localesPath).filter(file => file.endsWith('.json')).map(file => [file, JSON.parse(readFileSync(resolve(localesPath, file), 'utf8')) as Record<string, string>]))
const en = locales['en.json']!

describe('all product tour locale copy', () => {
  const newKeys = Object.keys(en).filter(key => key.startsWith('productTour.') || key.startsWith('settings.learning.'))
  test('contains the full copy and UI keys', () => {
    expect(newKeys.length).toBeGreaterThan(280)
    for (const tour of productTourCatalogue) {
      for (const key of [tour.titleKey, tour.goalKey, tour.whyKey, ...tour.steps.flatMap(step => [step.copyKey + 'title', step.copyKey + 'body'])]) expect(en[key]).toBeTruthy()
      for (const step of tour.steps) {
        expect(en[step.copyKey + 'title']).toBe(step.copy.en.title)
        expect(en[step.copyKey + 'body']).toBe(step.copy.en.body)
        expect(locales['ru.json']![step.copyKey + 'title']).toBe(step.copy.ru.title)
        expect(locales['ru.json']![step.copyKey + 'body']).toBe(step.copy.ru.body)
      }
    }
  })
  for (const [name, locale] of Object.entries(locales)) {
    test(`${name} contains translated, sorted copy with matching placeholders`, () => {
      expect(Object.keys(locale)).toEqual(Object.keys(locale).sort())
      for (const key of newKeys) {
        expect(locale[key]).toBeTruthy()
        expect(locale[key]!.match(/{{\w+}}/g) ?? []).toEqual(en[key]!.match(/{{\w+}}/g) ?? [])
        if (name !== 'en.json') expect(locale[key]).not.toBe(en[key])
      }
    })
  }
  test('Arabic is RTL copy and long translations preserve progress interpolation', () => {
    expect(locales['ar.json']!['productTour.first-result.first.permissions.body']).toMatch(/[\u0600-\u06ff]/)
    expect(locales['de.json']!['productTour.common.stepProgress']).toContain('{{current}}')
    expect(locales['hu.json']!['productTour.common.stepProgress']).toContain('{{total}}')
  })
})
