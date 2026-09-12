/**
 * HTTP injectables for packages/core (lib: ESNext, no DOM HeadersInit).
 * Bun's `typeof fetch` also requires `preconnect`, which test doubles omit.
 */

export type HttpHeadersInit = Record<string, string> | [string, string][] | Headers

export type HttpFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>
