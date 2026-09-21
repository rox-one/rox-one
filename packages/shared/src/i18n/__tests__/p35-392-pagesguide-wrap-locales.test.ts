import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'pages.designWithAgentPrompt'
const RU_WRAPPED =
  'Сверстай страницу «{{name}}» (slug: {{slug}}). Она есть в рабочем пространстве, но пока без содержимого — напиши index.html через update_page по гайду страниц.'
const EN_VALUE =
  'Design the page "{{name}}" (slug: {{slug}}). It exists in my workspace but has no content yet — author its index.html with update_page, following the Pages authoring guide.'

describe('P35-392 leftover English Pages wrapping on pages.designWithAgentPrompt', () => {
  it('wraps leftover Pages as sibling страниц, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('по гайду страниц')
    expect(ru).toContain('index.html')
    expect(ru).toContain('update_page')
    expect(ru).not.toContain('Pages')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
