/**
 * SSRF redirect guard for remote MCP transports.
 *
 * The MCP SDK's SSEClientTransport / StreamableHTTPClientTransport call fetch
 * with the default `redirect: 'follow'`: a hostile or compromised MCP server
 * can 302 the client onto internal endpoints (cloud metadata such as
 * 169.254.169.254, intranet admin panels) from the main/desktop process.
 * Auth headers are stripped cross-origin by fetch itself, but the request
 * still happens and the response enters MCP parsing.
 *
 * `createMcpGuardedFetch` forces `redirect: 'manual'` and re-follows ONLY
 * same-origin redirects (legitimate reverse-proxy/trailing-slash hops),
 * refusing cross-origin ones with a typed {@link McpRedirectError}. The
 * cross-origin target is never requested.
 */

/**
 * Typed connection error for refused MCP redirects. Surfaced through the SDK
 * transport's error path so connection validation reports it verbatim.
 */
export class McpRedirectError extends Error {
  /** The redirect target that was refused (or the loop hop that tripped the cap). */
  readonly redirectUrl: string;

  constructor(message: string, redirectUrl: string) {
    super(message);
    this.name = 'McpRedirectError';
    this.redirectUrl = redirectUrl;
  }
}

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Cap on same-origin hops — bounds redirect loops without banning legit hops. */
const MAX_SAME_ORIGIN_REDIRECTS = 5;

/**
 * Wrap a fetch implementation (default: global fetch) so MCP endpoint
 * requests never follow cross-origin redirects. Same-origin redirects are
 * followed manually with fetch-spec semantics: 303 always becomes GET;
 * 301/302 become GET for non-GET/HEAD; 307/308 preserve method and body.
 */
export function createMcpGuardedFetch(baseFetch: FetchLike = fetch): FetchLike {
  return async (input, init) => {
    let url = new URL(typeof input === 'string' ? input : input.href);
    let method = init?.method ?? 'GET';
    let body = init?.body ?? null;
    let headers = new Headers(init?.headers);

    for (let followed = 0; ; followed++) {
      const response = await baseFetch(url, {
        ...init,
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? null : body,
        redirect: 'manual',
      });

      if (!REDIRECT_STATUSES.has(response.status)) {
        return response;
      }
      const location = response.headers.get('location');
      if (!location) {
        // 3xx without a target isn't a redirect — let the SDK handle the status.
        return response;
      }

      const next = new URL(location, url);
      // Release the redirect response body before following or throwing.
      await response.body?.cancel().catch(() => {});

      if (next.origin !== url.origin) {
        throw new McpRedirectError(
          `MCP endpoint ${url.origin} attempted a cross-origin redirect to ${next.origin}; ` +
            'redirects to a different origin are not followed for MCP endpoints',
          next.href,
        );
      }
      if (followed >= MAX_SAME_ORIGIN_REDIRECTS) {
        throw new McpRedirectError(
          `Too many redirects for MCP endpoint (>${MAX_SAME_ORIGIN_REDIRECTS} same-origin hops)`,
          next.href,
        );
      }

      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && method !== 'GET' && method !== 'HEAD')
      ) {
        method = 'GET';
        body = null;
        headers = new Headers(headers);
        headers.delete('content-type');
        headers.delete('content-length');
      }
      url = next;
    }
  };
}
