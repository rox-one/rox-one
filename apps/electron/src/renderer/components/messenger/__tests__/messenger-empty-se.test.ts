import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const body = readFileSync(join(import.meta.dir, '../MessengerChannels.tsx'), 'utf8')

describe('Messenger empty/zero-data (P5.2)', () => {
  it('uses EntityListEmptyScreen for channel/conversation/search empty', () => {
    expect(body).toContain('EntityListEmptyScreen')
    expect(body).toContain('messenger.channels.empty')
    expect(body).toContain('messenger.channels.noMessages')
    expect(body).toContain('messenger.channels.searchEmpty')
    expect(body).not.toMatch(/noMessages[\s\S]{0,120}icon-empty/)
    expect(body).not.toMatch(/channels\.empty[\s\S]{0,80}<p className="p-4/)
  })

  it('keeps CallStage and create/send busy (not list empty invent)', () => {
    expect(body).toContain('CallStage')
    expect(body).toMatch(/disabled=\{!\w+\.trim\(\) \|\| busy\}/)
  })
})
