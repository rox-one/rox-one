import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SourcedStatement } from '../SourcedStatement'
import type { SourceCitationView } from '@craft-agent/core/research'

const source: SourceCitationView = {
  url: 'https://example.com/paper',
  title: 'Example Paper on Rox',
  reliability: 'high',
  publishedAt: '2026-01-02',
  contradiction: true,
  primary: true,
  provenance: ['primary-1'],
}

describe('SourcedStatement', () => {
  it('renders a dotted sourced mark and hover-card fields', () => {
    const html = renderToStaticMarkup(
      React.createElement(SourcedStatement, { source }, 'the vault stays local'),
    )
    expect(html).toContain('rox-sourced')
    expect(html).toContain('decoration-dotted')
    expect(html).toContain('data-rox-source="https://example.com/paper"')
    expect(html).toContain('data-rox-reliability="high"')
    expect(html).toContain('data-rox-contradiction="true"')
    expect(html).toContain('Example Paper on Rox')
    expect(html).toContain('the vault stays local')
    expect(html).toContain('role="tooltip"')
  })

  it('uses i18n keys for hover-card labels', () => {
    const src = readFileSync(join(__dirname, '../SourcedStatement.tsx'), 'utf8')
    expect(src).toContain("t('research.citation.published'")
    expect(src).toContain("t('research.citation.dateUnknown')")
    expect(src).toContain("t('research.citation.contradiction')")
    expect(src).toContain("t('research.citation.hoverAria'")
    expect(src).toContain('useTranslation')
  })

  it('leaves the underline and keyboard stop to a surrounding link', () => {
    const html = renderToStaticMarkup(
      React.createElement(SourcedStatement, { source, withinLink: true }, 'Example paper'),
    )
    expect(html).not.toContain('tabindex')
    expect(html).not.toContain('decoration-dotted')
    expect(html).toContain('role="tooltip"')
  })
})
