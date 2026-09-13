import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const panel = readFileSync(join(__dirname, '../SourcesListPanel.tsx'), 'utf8')
const settings = readFileSync(
  join(__dirname, '../../pages/settings/WorkspaceSettingsPage.tsx'),
  'utf8',
)
const chip = readFileSync(join(__dirname, '../../atoms/background-finished.ts'), 'utf8')

describe('P35-08 sources UI split and notification default', () => {
  it('groups microservices vs MCP in the sources list when unfiltered', () => {
    expect(panel).toContain("t('sourcesList.groupMicroservices')")
    expect(panel).toContain("t('sourcesList.groupMcp')")
    expect(panel).toContain('data-testid="sources-grouped-list"')
    expect(panel).toContain("s.config.type === 'local'")
    expect(panel).toContain("s.config.type === 'mcp'")
  })

  it('splits default-source toggles into microservices vs MCP', () => {
    expect(settings).toContain("t('sourcesList.groupMicroservices')")
    expect(settings).toContain("t('sourcesList.groupMcp')")
    expect(settings).toContain('data-testid={`default-sources-${group.key}`}')
  })

  it('defaults background-session notifications on', () => {
    expect(chip).toMatch(/atomWithStorage<boolean>\(\s*'craft-show-background-finished-chip',\s*true/)
  })
})
