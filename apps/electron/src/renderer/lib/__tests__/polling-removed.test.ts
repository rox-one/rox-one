import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

const files = {
  useInboxItems: join(import.meta.dir, '../../hooks/useInboxItems.ts'),
  FeedPage: join(import.meta.dir, '../../pages/FeedPage.tsx'),
  AgentCenter: join(import.meta.dir, '../../pages/extra-screens/agents/AgentCenterPage.tsx'),
  Dossier: join(import.meta.dir, '../../pages/extra-screens/dossier/DossierPage.tsx'),
  Radar: join(import.meta.dir, '../../pages/extra-screens/radar/RadarPage.tsx'),
  Decisions: join(import.meta.dir, '../../pages/extra-screens/decisions/DecisionsPage.tsx'),
  useMail: join(import.meta.dir, '../../pages/inbox/mail/useMail.ts'),
}

describe('#1579 data-refetch intervals', () => {
  for (const [name, path] of Object.entries(files)) {
    it(`${name} has no data-refetch setInterval`, () => {
      const src = readFileSync(path, 'utf8')
      expect(src).not.toMatch(/setInterval\([^)]*(?:load|poll|refresh|tick|refreshStatus)/)
    })
  }

  it('inbox and feed subscribe to CHANGED events', () => {
    expect(readFileSync(files.useInboxItems, 'utf8')).toMatch(/onMemoryChanged|onSkillsPendingChanged|onMessagingPendingChanged/)
    expect(readFileSync(files.FeedPage, 'utf8')).toMatch(/onFeedChanged/)
  })
})
