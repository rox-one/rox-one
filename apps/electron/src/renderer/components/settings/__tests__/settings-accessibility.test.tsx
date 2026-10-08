import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { SettingsInput, SettingsInputRow, SettingsSecretInput } from '../SettingsInput'
import { SettingsTextarea } from '../SettingsTextarea'
import { SettingsRow } from '../SettingsRow'
import { SettingsToggle } from '../SettingsToggle'
import { SettingsSelect, SettingsSelectRow } from '../SettingsSelect'
import { SettingsMenuSelect, SettingsMenuSelectRow } from '../SettingsMenuSelect'
import { SettingsSegmentedControl, SettingsSegmentedControlCard } from '../SettingsSegmentedControl'
import { SettingsRadioCard, SettingsRadioGroup, SettingsRadioOption } from '../SettingsRadioGroup'

const i18n = createInstance()
await i18n.init({
  lng: 'en', fallbackLng: 'en',
  resources: { en: { translation: { 'settings.fields.showValue': 'Show value', 'settings.fields.hideValue': 'Hide value' } } },
})

function render(content: React.ReactNode) {
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{content}</I18nextProvider>)
}

function tags(html: string, name: string) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map(([tag]) => tag)
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
}

function referencedText(html: string, tag: string, attributeName: string) {
  const ids = attribute(tag, attributeName)?.split(' ') ?? []
  return ids.map((id) => {
    const start = html.indexOf(`id="${id}"`)
    expect(start).toBeGreaterThanOrEqual(0)
    const content = html.slice(start).match(/^[^>]*>([^<]*)</)?.[1]
    return content
  })
}

const change = () => {}

describe('settings field accessible contracts', () => {
  for (const Component of [SettingsInput, SettingsSecretInput]) {
    it(`${Component.name}: reveal is named, keyboard reachable, and controls its field`, () => {
      const html = render(<Component label="API key" value="test-key" onChange={change} type="password" />)
      const input = tags(html, 'input')[0]!
      const button = tags(html, 'button')[0]!
      // Some page suites replace react-i18next globally with a key-returning mock.
      // Both harnesses must expose the same explicit, translatable action name.
      const actionLabel = attribute(button, 'aria-label')
      if (actionLabel === undefined) throw new Error('Reveal control has no accessible name')
      expect(['Show value', 'settings.fields.showValue']).toContain(actionLabel)
      expect(attribute(button, 'aria-controls')).toBe(attribute(input, 'id'))
      expect(attribute(button, 'tabindex')).not.toBe('-1')
      expect(attribute(input, 'type')).toBe('password')
    })

    it(`${Component.name}: disabled secrets cannot be revealed`, () => {
      const html = render(<Component label="API key" value="test-key" onChange={change} type="password" disabled />)
      expect(tags(html, 'input')[0]).toContain('disabled=""')
      expect(tags(html, 'button')[0]).toContain('disabled=""')
    })

    it(`${Component.name}: description and validation are announced for the field`, () => {
      const html = render(<Component label="API key" description="Stored locally" error="Invalid key" value="" onChange={change} />)
      const input = tags(html, 'input')[0]!
      expect(attribute(input, 'aria-invalid')).toBe('true')
      expect(referencedText(html, input, 'aria-describedby')).toEqual(['Stored locally', 'Invalid key'])
      expect(html).toContain('role="alert"')
    })
  }

  it('input rows associate their validation without hiding the description', () => {
    const html = render(<SettingsInputRow label="Server" description="Endpoint" error="Invalid URL" value="" onChange={change} />)
    const input = tags(html, 'input')[0]!
    expect(attribute(input, 'aria-invalid')).toBe('true')
    expect(referencedText(html, input, 'aria-describedby')).toEqual(['Endpoint', 'Invalid URL'])
  })

  it('unlabelled custom fields inherit their visible row label and description', () => {
    const html = render(<SettingsRow label="Server" description="Local address"><SettingsInput value="" onChange={change} /></SettingsRow>)
    const input = tags(html, 'input')[0]!
    expect(referencedText(html, input, 'aria-labelledby')).toEqual(['Server'])
    expect(referencedText(html, input, 'aria-describedby')).toEqual(['Local address'])
  })

  it('standalone descriptions are rendered even when the caller supplies no label', () => {
    const html = render(<SettingsInput description="Local address" value="" onChange={change} />)
    expect(referencedText(html, tags(html, 'input')[0]!, 'aria-describedby')).toEqual(['Local address'])
  })

  it('textarea exposes its soft limit, keeps over-limit drafts, and associates its error', () => {
    const html = render(<SettingsTextarea label="Instructions" description="Assistant context" value="Draft" maxLength={3} error="Too long" onChange={change} />)
    const textarea = tags(html, 'textarea')[0]!
    expect(attribute(textarea, 'aria-invalid')).toBe('true')
    expect(referencedText(html, textarea, 'aria-describedby')).toEqual(['Assistant context', '5/3', 'Too long'])
    expect(html).toContain('>Draft</textarea>')
    expect(attribute(textarea, 'maxlength')).toBeUndefined()
  })

  it('toggle name and explanation remain separate', () => {
    const html = render(<SettingsToggle label="Analytics" description="Share anonymous activity" checked={false} onCheckedChange={change} />)
    const toggle = tags(html, 'button').find((tag) => attribute(tag, 'role') === 'switch')!
    expect(referencedText(html, toggle, 'aria-labelledby')).toEqual(['Analytics'])
    expect(referencedText(html, toggle, 'aria-describedby')).toEqual(['Share anonymous activity'])
  })

  for (const Component of [SettingsSelect, SettingsSelectRow]) {
    it(`${Component.name}: field description is associated with the native select trigger`, () => {
      const html = render(<Component label="Language" description="Application language" value="en" onValueChange={change} options={[{ value: 'en', label: 'English' }]} />)
      const trigger = tags(html, 'button').find((tag) => attribute(tag, 'role') === 'combobox')!
      expect(referencedText(html, trigger, 'aria-describedby')).toEqual(['Application language'])
    })
  }
})

describe('settings selection accessible contracts', () => {
  for (const Component of [SettingsSegmentedControl, SettingsSegmentedControlCard]) {
    it(`${Component.name}: native radio grouping preserves selection, labels and disabled options`, () => {
      const html = render(<SettingsRow label="Theme" description="Application colors"><Component value="light" onValueChange={change} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'custom', label: 'Custom', disabled: true }]} /></SettingsRow>)
      const radios = tags(html, 'input')
      const group = tags(html, 'div').find((tag) => attribute(tag, 'role') === 'radiogroup')!
      expect(radios).toHaveLength(3)
      expect(new Set(radios.map((radio) => attribute(radio, 'name'))).size).toBe(1)
      expect(radios.every((radio) => attribute(radio, 'type') === 'radio')).toBe(true)
      expect(radios.filter((radio) => radio.includes(' checked=""'))).toHaveLength(1)
      expect(radios[2]).toContain('disabled=""')
      expect(referencedText(html, group, 'aria-labelledby')).toEqual(['Theme'])
      expect(referencedText(html, group, 'aria-describedby')).toEqual(['Application colors'])
    })
  }

  it('independent segmented groups never share a native radio name', () => {
    const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]
    const html = render(<><SettingsSegmentedControl value="a" onValueChange={change} options={options} aria-label="First" /><SettingsSegmentedControl value="b" onValueChange={change} options={options} aria-label="Second" /></>)
    const inputs = tags(html, 'input')
    expect(attribute(inputs[0]!, 'name')).not.toBe(attribute(inputs[2]!, 'name'))
  })

  it('radio cards and inline options use the same group and associate descriptions', () => {
    const html = render(<SettingsRadioGroup value="fast" onValueChange={change} aria-label="Mode"><SettingsRadioCard value="fast" label="Fast" description="Quick response" expandedContent={<input aria-label="Tuning" />} /><SettingsRadioOption value="deep" label="Deep" description="More reasoning" /></SettingsRadioGroup>)
    const radios = tags(html, 'input').filter((tag) => attribute(tag, 'type') === 'radio')
    expect(radios).toHaveLength(2)
    expect(attribute(radios[0]!, 'name')).toBe(attribute(radios[1]!, 'name'))
    expect(referencedText(html, radios[0]!, 'aria-labelledby')).toEqual(['Fast'])
    expect(referencedText(html, radios[0]!, 'aria-describedby')).toEqual(['Quick response'])
    expect(referencedText(html, radios[1]!, 'aria-describedby')).toEqual(['· More reasoning'])
    expect(html).toContain('aria-label="Tuning"')
  })

  it('menu-select trigger announces the setting and current value in custom rows', () => {
    const html = render(<SettingsRow label="Language" description="Application language"><SettingsMenuSelect value="en" onValueChange={change} options={[{ value: 'en', label: 'English' }]} /></SettingsRow>)
    const trigger = tags(html, 'button')[0]!
    expect(attribute(trigger, 'aria-haspopup')).toBe('listbox')
    expect(attribute(trigger, 'aria-expanded')).toBe('false')
    expect(referencedText(html, trigger, 'aria-labelledby')).toEqual(['Language', 'English'])
    expect(referencedText(html, trigger, 'aria-describedby')).toEqual(['Application language'])
  })

  it('menu-select rows expose label, description, selected value, and disabled state', () => {
    const html = render(<SettingsMenuSelectRow label="Voice" description="Assistant voice" value="a" onValueChange={change} options={[{ value: 'a', label: 'Alto' }]} disabled />)
    const trigger = tags(html, 'button')[0]!
    expect(referencedText(html, trigger, 'aria-labelledby')).toEqual(['Voice', 'Alto'])
    expect(referencedText(html, trigger, 'aria-describedby')).toEqual(['Assistant voice'])
    expect(trigger).toContain('disabled=""')
  })
})
