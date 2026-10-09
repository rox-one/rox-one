/**
 * Board widget document wrapper (Wave 3 row b2.5 prerequisite — canvas
 * document wrap).
 *
 * Ported contract (not code) from OpenClaw's canvas document shell
 * (`src/canvas/wrap.ts`): agent-authored widget source is embedded in a
 * self-contained, network-isolated document whose bridge bootstrap bytes are
 * emitted STRICTLY BEFORE the widget code, so widget code can never observe,
 * patch or pre-empt the host bridge primitives.
 *
 * Deliberate ROX contract, not drift from upstream:
 *
 * - the meta CSP declares `default-src 'none'` with `sandbox allow-scripts`,
 *   so the frame is isolated and scripts run without gaining same-origin
 *   access to the embedding application;
 * - `connect-src` is `'none'` unless the widget was granted origins, and it is
 *   the only thing that ever widens network reach;
 * - granted origins are emitted verbatim (each must be a bare origin, never a
 *   bare scheme such as `https:` or `wss:`, which would open that whole scheme
 *   to the widget);
 * - the document carries no baked theme or widget-facing style system: ROX has
 *   no canvas theme bridge yet, and inventing one here would fix a palette the
 *   host cannot revoke.
 *
 * `script-src 'unsafe-inline'` is required, not incidental: the bridge
 * bootstrap and the size reporter are inline scripts, and `default-src 'none'`
 * would otherwise block every script in the document, leaving the frame inert.
 * The `sandbox` directive is ignored inside a `meta` CSP by the CSP3
 * specification; the frame's sandbox attribute is set by the mounting host and
 * this declaration documents the intended policy in one place.
 */

/** Message the size reporter posts to the embedding parent. */
export const WIDGET_SIZE_MESSAGE_TYPE = 'rox:widget-size'
/** Message carrying the parent-side MessagePort of the bridge channel. */
export const WIDGET_BOOTSTRAP_MESSAGE_TYPE = 'rox:widget-bootstrap'
/** Message signalling that the bridge is installed, sent after the port offer. */
export const WIDGET_READY_MESSAGE_TYPE = 'rox:widget-ready'
/** Global the bootstrap installs inside the widget frame. */
export const WIDGET_BRIDGE_GLOBAL = 'roxWidgetBridge'

export interface WidgetDocumentOptions {
  /**
   * Exact outbound origins the widget may connect to, emitted verbatim into
   * `connect-src`. Absent or empty means no network access at all.
   */
  connectOrigins?: readonly string[]
}

const WIDGET_CONNECT_SCHEMES: Record<string, true> = {
  'http:': true,
  'https:': true,
  'ws:': true,
  'wss:': true,
}

/**
 * Validate one granted widget connect origin and return it unchanged.
 *
 * Rejects bare schemes (`https:`, `wss:`), wildcards, non-origin URLs (path,
 * query, fragment, credentials) and non-network schemes, because a CSP source
 * expression is a capability, not a hint.
 */
export function assertWidgetConnectOrigin(origin: string): string {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    throw new Error(`Widget connect origin is not a URL: ${JSON.stringify(origin)}`)
  }
  if (WIDGET_CONNECT_SCHEMES[url.protocol] !== true) {
    throw new Error(`Widget connect origin must use http, https, ws or wss: ${JSON.stringify(origin)}`)
  }
  if (url.origin !== origin) {
    throw new Error(
      `Widget connect origin must be a bare origin with no path, query, fragment or credentials: ${JSON.stringify(origin)}`,
    )
  }
  return origin
}

/**
 * Wrap agent-authored widget code in the isolated widget document.
 *
 * @param title Operator-visible title; HTML-escaped before it reaches `<title>`.
 * @param widgetCode Authored widget source, embedded verbatim as the document body.
 * @param options Outbound grants; omitted means the document reaches no network.
 */
export function buildWidgetDocument(
  title: string,
  widgetCode: string,
  options: WidgetDocumentOptions = {},
): string {
  const connectOrigins = options.connectOrigins ?? []
  const connectSources =
    connectOrigins.length === 0
      ? "'none'"
      : connectOrigins.map((origin) => assertWidgetConnectOrigin(origin)).join(' ')
  const contentSecurityPolicy =
    "default-src 'none'; sandbox allow-scripts; script-src 'unsafe-inline'; " +
    "style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; " +
    `connect-src ${connectSources}`
  const safeTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

  // Bridge bootstrap: hands the embedding parent one end of a MessageChannel
  // and publishes the other end to the widget under `WIDGET_BRIDGE_GLOBAL`.
  // Every primitive is captured before widget code runs. The host side of the
  // channel (ticket binding, request routing) belongs to the board widget host;
  // this document only establishes the channel.
  const bridgeBootstrap =
    '<script>(()=>{if(!window.parent||window.parent===window)return;' +
    'const define=Object.defineProperty;const freeze=Object.freeze;' +
    'const post=window.parent.postMessage.bind(window.parent);' +
    'const channel=new MessageChannel();' +
    `post({type:${JSON.stringify(WIDGET_BOOTSTRAP_MESSAGE_TYPE)}},"*",[channel.port2]);` +
    `define(window,${JSON.stringify(WIDGET_BRIDGE_GLOBAL)},{value:freeze({port:channel.port1}),` +
    'writable:false,configurable:false});' +
    `post({type:${JSON.stringify(WIDGET_READY_MESSAGE_TYPE)}},"*");})();</script>`

  // The embedding parent fits the frame to the content. documentElement reports
  // the viewport for short content, so the body box is what gets measured.
  const sizeReporter =
    '<script>(()=>{if(!window.parent||window.parent===window)return;' +
    'const post=window.parent.postMessage.bind(window.parent);' +
    'let last=-1;const report=()=>{const body=document.body;if(!body)return;' +
    'const height=Math.ceil(Math.max(body.scrollHeight,body.offsetHeight,body.getBoundingClientRect().height));' +
    `if(height!==last){last=height;post({type:${JSON.stringify(WIDGET_SIZE_MESSAGE_TYPE)},height},"*");}};` +
    'window.addEventListener("load",report);new ResizeObserver(report).observe(document.body);' +
    'setTimeout(report,50);setTimeout(report,500);})();</script>'

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}"><title>${safeTitle}</title></head><body>${bridgeBootstrap}${sizeReporter}${widgetCode}</body></html>`
}