import { canonicalUrl } from './rank.ts'
import type { CitationSpan, RankedSource } from './types.ts'

export interface SourceCitationView {
  url: string
  title: string
  reliability: RankedSource['reliability']
  publishedAt: string | null
  contradiction: boolean
  primary: boolean
  provenance: readonly string[]
}

export function toCitationView(source: RankedSource): SourceCitationView {
  return {
    url: source.url,
    title: source.title,
    reliability: source.reliability,
    publishedAt: source.publishedAt,
    contradiction: source.contradiction,
    primary: source.primary,
    provenance: source.queryIds,
  }
}

export function citationMap(sources: readonly RankedSource[]): Map<string, SourceCitationView> {
  return indexCitationViews(sources.map(toCitationView))
}

export function indexCitationViews(sources: readonly SourceCitationView[]): Map<string, SourceCitationView> {
  const map = new Map<string, SourceCitationView>()
  for (const view of sources) {
    map.set(view.url, view)
    map.set(canonicalUrl(view.url), view)
  }
  return map
}

export function lookupCitation(
  url: string | undefined,
  sources: ReadonlyMap<string, SourceCitationView>,
): SourceCitationView | undefined {
  if (!url) return undefined
  return sources.get(url) ?? sources.get(canonicalUrl(url))
}

/** Mark answer spans that literally cite a ranked source title or URL. */
export function findCitationSpans(text: string, sources: readonly RankedSource[]): CitationSpan[] {
  const spans: CitationSpan[] = []
  const lower = text.toLowerCase()
  for (const source of sources) {
    const needles = [source.title, source.url, source.canonicalUrl].filter((n) => n.length >= 8)
    for (const needle of needles) {
      const idx = lower.indexOf(needle.toLowerCase())
      if (idx < 0) continue
      spans.push({
        start: idx,
        end: idx + needle.length,
        sourceUrl: source.url,
        text: text.slice(idx, idx + needle.length),
      })
      break
    }
  }
  return spans.sort((a, b) => a.start - b.start)
}
