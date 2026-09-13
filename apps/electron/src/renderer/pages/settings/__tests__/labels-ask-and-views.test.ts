import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const page = readFileSync(join(__dirname, '../LabelsSettingsPage.tsx'), 'utf8')
const views = readFileSync(join(__dirname, '../../../components/views/ViewPurposeList.tsx'), 'utf8')

describe('P35-10 auto-label Ask + view purposes', () => {
  it('wires Ask through EditPopover or hides it without a workspace', () => {
    expect(page).toContain('AskAiButton')
    expect(page).toContain('EditPopover')
    expect(page).toContain('rootPath ? (')
    expect(page).not.toMatch(/<AskAiButton[^>]*onClick=\{\(\) => \{\s*\}\}/)
  })

  it('lists a one-line purpose for plan, overview, and process', () => {
    expect(views).toContain('sidebar.view.planPurpose')
    expect(views).toContain('sidebar.view.overviewPurpose')
    expect(views).toContain('sidebar.view.processPurpose')
    expect(views).toContain('data-testid="view-purpose-list"')
  })
})
