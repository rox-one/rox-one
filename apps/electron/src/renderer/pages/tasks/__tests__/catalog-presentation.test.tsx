import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import type { ReactNode } from 'react'
import { CatalogDisclosure, CatalogSelect } from '../CatalogPanel'
import ProposalInbox from '../../meetings/ProposalInbox'
import MeetingDetail from '../../meetings/MeetingDetail'
import type { MeetingProposalRow } from '../../meetings/proposal-rpc'

const i18n = createInstance()
await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: { 'meetings.state.capturing': 'Recording' } } } })
const render = (node: ReactNode) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)

function proposal(id: string, status: MeetingProposalRow['status'] = 'proposed'): MeetingProposalRow {
  return { id, title: `Proposal ${id}`, type: 'create_task', source: 'manual', payload: { title: `Proposal ${id}` }, status }
}

describe('catalog presentation semantics', () => {
  it('gives a custom select a visible label associated with its actual trigger', () => {
    const html = render(<CatalogSelect label="Priority" value="high" options={[{ value: 'high', label: 'High' }]} onChange={() => {}} />)
    const id = html.match(/<label[^>]*for="([^"]+)"/)?.[1]
    expect(id).toBeDefined()
    expect(html).toContain(`id="${id}"`)
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('>High<')
  })

  it('uses native closed disclosures with a named summary for secondary controls', () => {
    const html = render(<CatalogDisclosure title="Details"><button>Secondary action</button></CatalogDisclosure>)
    expect(html).toMatch(/<details\b(?![^>]*\bopen\b)/)
    expect(html).toContain('<summary>')
    expect(html).toContain('Details')
    expect(html).toContain('Secondary action')
  })

  it('disables mutations only for the proposal whose request is pending', () => {
    const html = render(<ProposalInbox proposals={[proposal('pending'), proposal('ready')]} pendingIds={new Set(['pending'])} onApprove={() => {}} onReject={() => {}} />)
    const articles = html.match(/<article\b[\s\S]*?<\/article>/g)!
    expect(articles).toHaveLength(2)
    expect(articles[0]).toContain('aria-busy="true"')
    expect(articles[0]).toMatch(/<button(?=[^>]*data-testid="proposal-approve")(?=[^>]*disabled="")[^>]*>/)
    expect(articles[1]).toContain('aria-busy="false"')
    expect(articles[1]).not.toMatch(/<button(?=[^>]*data-testid="proposal-approve")(?=[^>]*disabled="")[^>]*>/)
  })

  it('does not offer approve/reject after application and keeps unverifiable target links disabled', () => {
    const html = render(<ProposalInbox proposals={[proposal('done', 'applied')]} onApprove={() => {}} onReject={() => {}} onOpenTarget={() => {}} />)
    expect(html).not.toContain('data-testid="proposal-approve"')
    expect(html).not.toContain('data-testid="proposal-reject"')
    expect(html).toMatch(/<button(?=[^>]*data-testid="proposal-target-link")(?=[^>]*disabled="")[^>]*>/)
  })

  it('provides a programmatically focusable detail heading without exposing raw status identifiers', () => {
    const html = render(<MeetingDetail meeting={{ id: 'm', title: 'Weekly meeting', status: 'capturing' }} />)
    expect(html).toMatch(/<h2(?=[^>]*data-catalog-detail-heading)(?=[^>]*tabindex="-1")[^>]*>Weekly meeting<\/h2>/)
    expect(html).not.toContain('>capturing<')
  })
})
