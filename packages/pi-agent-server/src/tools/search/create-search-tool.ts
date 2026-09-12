/**
 * Creates a `web_search` ToolDefinition backed by the given search provider.
 *
 * The tool name is always `web_search` regardless of the underlying provider,
 * so the model doesn't need to know which backend is used.
 */

import { Type } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { WebSearchProvider, WebSearchResult } from './types.ts';
import { DDGSearchProvider } from './providers/ddg.ts';
import { planEvidenceSearch, runBoundedResearch } from '@craft-agent/core/research';

const schema = Type.Object({
  query: Type.String({ description: 'The search query' }),
  count: Type.Optional(
    Type.Number({
      description: 'Max results (1-10, default 5)',
      minimum: 1,
      maximum: 10,
    }),
  ),
  research: Type.Optional(
    Type.Boolean({
      description:
        'Run the bounded evidence planner (primary URLs first, multilingual/domain queries with cost/time caps). Do not use for a single lookup.',
    }),
  ),
  languages: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Optional extra query languages for research mode',
    }),
  ),
});

function formatResults(
  query: string,
  providerName: string,
  results: WebSearchResult[],
  note?: string,
) {
  const formatted = results
    .map(
      (r, i) =>
        `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`,
    )
    .join('\n\n');

  const noteText = note ? `${note}\n\n` : '';

  return {
    content: [
      {
        type: 'text' as const,
        text: `${noteText}Search results for "${query}" (via ${providerName}):\n\n${formatted}`,
      },
    ],
    details: {},
  };
}

function formatErrorSnippet(message: string, max = 180): string {
  const compact = message.replace(/\s+/g, ' ').trim();
  if (!compact) return 'unknown error';
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function formatResearchResults(
  query: string,
  providerName: string,
  run: Awaited<ReturnType<typeof runBoundedResearch>>,
) {
  const sources = run.sources
    .map((source, i) => {
      const flags = [
        `reliability=${source.reliability}`,
        source.publishedAt ? `date=${source.publishedAt}` : null,
        source.contradiction ? 'contradiction' : null,
        source.primary ? 'primary' : null,
      ]
        .filter(Boolean)
        .join(', ')
      return `${i + 1}. **${source.title}**\n   ${source.url}\n   ${source.snippet}\n   ${flags}`
    })
    .join('\n\n')

  const provenance = run.provenance
    .map((p) => `- [${p.queryId}] ${p.kind} via ${p.provider}: ${p.query} (${p.hitCount} hits)`)
    .join('\n')

  return {
    content: [
      {
        type: 'text' as const,
        text: `Research results for "${query}" (via ${providerName}; cost ${run.costUnitsUsed}${run.timedOut ? '; timed out' : ''}):\n\n${sources}\n\nQuery provenance:\n${provenance}`,
      },
    ],
    details: {},
  }
}

export function createSearchTool(
  provider: WebSearchProvider,
  fallbackProvider: WebSearchProvider = new DDGSearchProvider(),
): ToolDefinition<typeof schema> {
  return {
    name: 'web_search',
    label: 'Web Search',
    description:
      'Search the web for current information. Returns titles, URLs, and snippets. Use for current information, documentation lookups, or fact-checking. Set research=true to run a bounded evidence planner with query provenance.',
    promptSnippet:
      'Use web_search for up-to-date information, documentation lookups, or fact-checking. Returns titles, URLs, and snippets. Accepts a query string and optional count (1-10). Set research=true for bounded multilingual/source analysis with explicit caps — never fan out unbounded queries.',
    parameters: schema,
    async execute(toolCallId, params) {
      const { query } = params;
      const count = Math.max(1, Math.min(10, params.count ?? 5));

      try {
        if (params.research) {
          const plan = planEvidenceSearch({
            message: query,
            languages: params.languages,
            preferredProvider: provider.name === 'Exa' ? 'exa' : 'web_search',
          })
          const run = await runBoundedResearch(plan, async (planned, n) => {
            const results = await provider.search(planned.query, n)
            return results.map((r) => ({
              title: r.title,
              url: r.url,
              snippet: r.description,
            }))
          })
          return formatResearchResults(query, provider.name, run)
        }

        const results = await provider.search(query, count);
        return formatResults(query, provider.name, results);
      } catch (err) {
        const primaryMsg = err instanceof Error ? err.message : String(err);

        const canFallback = provider.name !== fallbackProvider.name;
        if (canFallback) {
          try {
            const fallbackResults = await fallbackProvider.search(query, count);
            return formatResults(
              query,
              fallbackProvider.name,
              fallbackResults,
              `Primary search provider (${provider.name}) failed (${formatErrorSnippet(primaryMsg)}), automatically fell back to ${fallbackProvider.name}.`,
            );
          } catch (fallbackErr) {
            const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Search failed for "${query}": primary (${provider.name}) failed with "${formatErrorSnippet(primaryMsg, 400)}"; fallback (${fallbackProvider.name}) failed with "${formatErrorSnippet(fallbackMsg, 400)}"`,
                },
              ],
              details: { isError: true },
            };
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Search failed for "${query}": ${formatErrorSnippet(primaryMsg, 400)}`,
            },
          ],
          details: { isError: true },
        };
      }
    },
  };
}
