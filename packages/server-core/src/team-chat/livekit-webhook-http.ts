/**
 * HTTP ingress for LiveKit server webhooks on the local RPC port.
 *
 * POST /livekit/webhook — Content-Type application/webhook+json, Authorization JWT.
 * Auth boundary is LiveKit's signed JWT (api key/secret); bind is whatever hosts
 * the WsRpcServer (typically 127.0.0.1). No route when LiveKit creds are empty.
 *
 * On room_finished / emptying participant_left, ends the matching team-chat call
 * (call.ended + transcript) and optionally runs the AI summary path.
 */
import {
  applyLiveKitWebhookEvent,
  resolveCallCredentials,
  verifyLiveKitWebhook,
  LiveKitWebhookError,
  type TeamChannelCall,
  type TeamChatStore,
} from '@rox/shared/team-chat'

export const LIVEKIT_WEBHOOK_PATH = '/livekit/webhook'
const DEFAULT_BODY_LIMIT_BYTES = 256 * 1024

export interface LiveKitWebhookHttpLogger {
  warn: (message: string) => void
}

export interface LiveKitWebhookHttpIngressOptions {
  /** Resolve the team-chat store (org directory already wired). */
  getStore: () => TeamChatStore
  /**
   * After a call is ended by webhook and has transcript segments, summarize
   * (same path as CALL_LEAVE). Best-effort; must not throw into the HTTP path.
   */
  onCallEnded?: (info: { orgId: string; channelId: string; call: TeamChannelCall }) => void | Promise<void>
  /** Notify windows that channel state changed. */
  onChanged?: (orgId: string, channelId: string) => void
  bodyLimitBytes?: number
  logger?: LiveKitWebhookHttpLogger
}

export interface LiveKitWebhookHttpIngress {
  readonly basePath: string
  matches(pathname: string): boolean
  handle(req: Request): Promise<Response | null>
  snapshot(): { bodyLimitBytes: number; accepted: number; rejected: number; ended: number }
}

async function readBoundedBody(req: Request, limitBytes: number): Promise<{ ok: true; text: string } | { ok: false; status: number }> {
  const declared = req.headers.get('content-length')
  const declaredBytes = declared ? Number(declared) : Number.NaN
  if (Number.isFinite(declaredBytes) && declaredBytes > limitBytes) return { ok: false, status: 413 }
  const buf = Buffer.from(await req.arrayBuffer())
  if (buf.byteLength > limitBytes) return { ok: false, status: 413 }
  return { ok: true, text: buf.toString('utf8') }
}

export function createLiveKitWebhookHttpIngress(options: LiveKitWebhookHttpIngressOptions): LiveKitWebhookHttpIngress {
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES
  let accepted = 0
  let rejected = 0
  let ended = 0

  return {
    basePath: LIVEKIT_WEBHOOK_PATH,
    matches(pathname: string): boolean {
      const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
      return path === LIVEKIT_WEBHOOK_PATH
    },
    async handle(req: Request): Promise<Response | null> {
      const path = new URL(req.url).pathname
      const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path
      if (normalized !== LIVEKIT_WEBHOOK_PATH) return null

      if (req.method !== 'POST') {
        rejected++
        return Response.json({ error: 'method not allowed' }, { status: 405 })
      }

      const creds = resolveCallCredentials()
      if (!creds.livekitApiKey || !creds.livekitApiSecret) {
        rejected++
        return Response.json({ error: 'calls not configured' }, { status: 503 })
      }

      const body = await readBoundedBody(req, bodyLimitBytes)
      if (!body.ok) {
        rejected++
        return Response.json({ error: 'payload too large' }, { status: body.status })
      }

      let event
      try {
        event = verifyLiveKitWebhook(body.text, req.headers.get('authorization') ?? undefined, creds.livekitApiKey, creds.livekitApiSecret)
      } catch (error) {
        rejected++
        const status = error instanceof LiveKitWebhookError && error.code === 'UNAUTHORIZED' ? 401 : 400
        options.logger?.warn(`[livekit-webhook] rejected: ${error instanceof Error ? error.message : 'error'}`)
        return Response.json({ error: 'unauthorized' }, { status })
      }

      const result = applyLiveKitWebhookEvent(options.getStore(), event)
      accepted++
      if (result.applied && result.orgId && result.channelId) {
        try { options.onChanged?.(result.orgId, result.channelId) } catch { /* never break webhook ack */ }
      }
      if (result.ended && result.call && result.orgId && result.channelId) {
        ended++
        // Same as CALL_LEAVE: always notify; the summary helper no-ops on empty transcripts.
        if (options.onCallEnded) {
          void Promise.resolve(options.onCallEnded({ orgId: result.orgId, channelId: result.channelId, call: result.call })).catch(() => {})
        }
      }
      // Always 200 after verify so LiveKit does not retry forever on ignored events.
      return Response.json({ ok: true, event: result.event, ended: result.ended, applied: result.applied })
    },
    snapshot() {
      return { bodyLimitBytes, accepted, rejected, ended }
    },
  }
}
