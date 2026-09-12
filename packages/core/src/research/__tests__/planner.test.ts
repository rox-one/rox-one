import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_RESEARCH_CAPS,
  RESEARCH_CAP_CEILING,
  clampResearchCaps,
  extractReferencedUrls,
  inferTopicLanguage,
  planEvidenceSearch,
} from '../index.ts'

describe('planEvidenceSearch', () => {
  it('prioritizes referenced URLs as primary sources', () => {
    const plan = planEvidenceSearch({
      message: 'Analyze https://example.com/paper and related coverage',
      referencedUrls: ['https://example.com/paper'],
      languages: ['en', 'ru'],
    })
    expect(plan.queries[0]?.kind).toBe('primary_url')
    expect(plan.queries[0]?.primary).toBe(true)
    expect(plan.queries[0]?.query).toBe('https://example.com/paper')
    expect(plan.queries.some((q) => q.kind === 'multilingual')).toBe(true)
    expect(plan.queries.length).toBeLessThanOrEqual(DEFAULT_RESEARCH_CAPS.maxQueries)
  })

  it('adds bounded multilingual, domain, and dork queries', () => {
    const plan = planEvidenceSearch({
      message: 'Rox local-first notes',
      languages: ['en', 'ru', 'zh', 'de'],
      domains: ['ietf.org', 'example.com', 'spam.test', 'extra.dev'],
      dorks: ['filetype:pdf', 'intitle:spec', 'extra'],
    })
    const langs = plan.queries.filter((q) => q.kind === 'multilingual')
    const domains = plan.queries.filter((q) => q.kind === 'domain')
    const dorks = plan.queries.filter((q) => q.kind === 'dork')
    expect(langs.length).toBeLessThanOrEqual(3)
    expect(domains.length).toBeLessThanOrEqual(3)
    expect(dorks.length).toBeLessThanOrEqual(2)
    expect(domains[0]?.query).toContain('site:ietf.org')
    expect(plan.queries.length).toBeLessThanOrEqual(DEFAULT_RESEARCH_CAPS.maxQueries)
  })

  it('never fans out to 10–15×50', () => {
    const plan = planEvidenceSearch({
      message: 'topic',
      languages: Array.from({ length: 15 }, (_, i) => `l${i}`),
      domains: Array.from({ length: 20 }, (_, i) => `d${i}.test`),
      caps: { maxQueries: 50, maxResultsPerQuery: 50, maxCostUnits: 500 },
    })
    expect(plan.caps.maxQueries).toBeLessThanOrEqual(RESEARCH_CAP_CEILING.maxQueries)
    expect(plan.caps.maxResultsPerQuery).toBeLessThanOrEqual(RESEARCH_CAP_CEILING.maxResultsPerQuery)
    expect(plan.queries.length).toBeLessThanOrEqual(plan.caps.maxQueries)
    expect(plan.queries.length).toBeLessThan(10)
  })
})

describe('clampResearchCaps', () => {
  it('uses defaults when omitted', () => {
    expect(clampResearchCaps()).toEqual({ ...DEFAULT_RESEARCH_CAPS })
  })
})

describe('extractReferencedUrls / inferTopicLanguage', () => {
  it('dedupes URLs and infers ru/zh', () => {
    expect(extractReferencedUrls('see https://a.test/x, https://a.test/x', ['https://b.test'])).toEqual([
      'https://b.test',
      'https://a.test/x',
    ])
    expect(inferTopicLanguage('Проверить источник')).toBe('ru')
    expect(inferTopicLanguage('分析这个链接')).toBe('zh')
    expect(inferTopicLanguage('plain')).toBe('en')
  })
})
