/**
 * Offline network seam for the cloud-runner suites.
 *
 * Import this module **first** in a test file. ESM evaluates imports in source
 * order, so the real `fetch` is captured and replaced before the modules under
 * test (`../daytona-client.ts`, `../daytona-provider.ts`, …) are evaluated —
 * which is the only ordering that also holds for a module-scope capture.
 *
 * Every provider in these suites is built with an injected `DaytonaClient`
 * (`MemoryDaytonaClient`); the seam exists so that a provider built *without*
 * one fails loudly and locally instead of issuing a real request — an un-mocked
 * call is what surfaced in CI as GitHub's `Resource not accessible by
 * integration`, not a deterministic test failure.
 *
 * `withLiveNetwork` is the single, explicit escape hatch, used only by the
 * attended live-sandbox leg.
 */
const realFetch = globalThis.fetch.bind(globalThis);

/** URLs a test tried to fetch for real. Empty outside a `withLiveNetwork` block. */
export const blockedFetchUrls: string[] = [];

const offlineFetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  blockedFetchUrls.push(url);
  throw new Error(
    `offline test network: blocked ${init?.method ?? 'GET'} ${url} — inject a DaytonaClient instead of using the real network`,
  );
}) as typeof fetch;

globalThis.fetch = offlineFetch;

/** The real fetch, captured before the stub was installed. */
export const liveFetch = realFetch;

/** Run `fn` against the real network (attended live runs only). */
export async function withLiveNetwork<T>(fn: () => Promise<T>): Promise<T> {
  globalThis.fetch = realFetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = offlineFetch;
  }
}
