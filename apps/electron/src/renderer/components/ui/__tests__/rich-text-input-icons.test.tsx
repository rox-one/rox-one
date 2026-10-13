/**
 * The composer requests skill icons only for skills rendered as mention
 * badges, not for every skill in the catalog (ADR-0023 §7, #1578).
 */
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import type { LoadedSkill } from '../../../../shared/types'
import type { RichTextInputProps } from '../rich-text-input'

useDomForFile()

const loadSkillIcon = mock(async (_skill: LoadedSkill, _workspaceId: string) => null as string | null)
mock.module('@/lib/icon-cache', () => ({
  loadSkillIcon,
  loadSourceIcon: async () => null,
  getSkillIconSync: () => null,
  getSourceIconSync: () => null,
  EMOJI_ICON_PREFIX: 'emoji:',
}))

let RichTextInput: React.ComponentType<RichTextInputProps>
let i18n: I18n

beforeAll(async () => {
  i18n = createInstance()
  await i18n.init({ lng: 'en', fallbackLng: 'en', keySeparator: false, resources: { en: { translation: {} } } })
  RichTextInput = (await import('../rich-text-input')).RichTextInput as unknown as React.ComponentType<RichTextInputProps>
})

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
  loadSkillIcon.mockClear()
})

const skills = Array.from({ length: 10_000 }, (_, index) => ({
  slug: `skill-${index}`,
  metadata: { name: `Skill ${index}`, description: '' },
  source: 'workspace',
})) as unknown as LoadedSkill[]

async function renderInput(value: string): Promise<void> {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  await act(async () => {
    root!.render(
      React.createElement(
        I18nextProvider,
        { i18n },
        React.createElement(RichTextInput, { value, onChange: () => {}, skills, workspaceId: 'ws1' }),
      ),
    )
  })
}

const requestedSlugs = (): string[] => loadSkillIcon.mock.calls.map(([skill]) => skill.slug)

describe('RichTextInput skill icons', () => {
  it('requests no skill icons when the text has no mentions', async () => {
    await renderInput('plain text')
    expect(loadSkillIcon).toHaveBeenCalledTimes(0)
  })

  it('requests icons only for mentioned skills, once each', async () => {
    await renderInput('use [skill:ws1:skill-7] now')
    expect(requestedSlugs()).toEqual(['skill-7'])
    expect(loadSkillIcon.mock.calls[0]![1]).toBe('ws1')

    await renderInput('use [skill:ws1:skill-7] and [skill:ws1:skill-42]')
    expect(requestedSlugs()).toEqual(['skill-7', 'skill-42'])

    await renderInput('use [skill:ws1:skill-7] and [skill:ws1:skill-42] again')
    expect(requestedSlugs()).toEqual(['skill-7', 'skill-42'])
  })
})
