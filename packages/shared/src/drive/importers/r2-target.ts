/**
 * ROX Drive (wave 4) — S3-compatible upload target for imported bytes.
 *
 * Implements AWS Signature Version 4 with `fetch` + WebCrypto only: no
 * `aws-sdk`, no new dependencies. Point it at any S3-compatible endpoint
 * (self-hosted SeaweedFS, MinIO, AWS S3) through:
 *
 *   ROX_DRIVE_S3_ENDPOINT          https://<host>          (base path, no bucket)
 *   ROX_DRIVE_S3_BUCKET            <bucket>
 *   ROX_DRIVE_S3_REGION            us-east-1              (must be explicit; `auto` is R2-only)
 *   ROX_DRIVE_S3_ACCESS_KEY_ID     …
 *   ROX_DRIVE_S3_SECRET_ACCESS_KEY …
 *
 * The production deployment is self-hosted: SeaweedFS on host `sw`, bucket
 * `rox-drive`, exposed as https://s3.rox.one (Caddy TLS) — see
 * docs/drive-object-storage.md. Path-style addressing is used
 * (`<endpoint>/<bucket>/<key>`), which SeaweedFS, R2 and MinIO all accept.
 * Streaming bodies are signed with `UNSIGNED-PAYLOAD`
 * (mandatory over TLS for unknown-length uploads); byte bodies are hashed.
 *
 * Timeouts: a streamed PUT is **stall-aware** — the connection is aborted only
 * after `DEFAULT_STALL_TIMEOUT_MS` (30s) with no byte of progress, never on
 * total duration, so a large upload is not killed mid-flight (the runner would
 * have to re-send the whole object). A byte body carries no progress signal, so
 * it gets a hard `DEFAULT_REQUEST_TIMEOUT_MS` (30s) cap instead. A timeout
 * keeps the coded `DRIVE_IMPORT_S3_PUT_FAILED` surface and adds `timeout: true`.
 */
import type { DriveUploadTarget } from './types'
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STALL_TIMEOUT_MS,
  FetchTimeoutError,
  StallTimeoutMonitor,
  guardStreamWithStall,
  isTimeoutError,
} from './timeout'

const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'
const ALGORITHM = 'AWS4-HMAC-SHA256'

export interface S3TargetOptions {
  /** Base endpoint, e.g. `https://<account>.r2.cloudflarestorage.com` (no bucket). */
  endpoint: string
  bucket: string
  region?: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  /** Fetch seam for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch
  /** Clock seam; defaults to `new Date()`. */
  now?: () => Date
  /** Hard cap for a byte-body PUT; defaults to `DEFAULT_REQUEST_TIMEOUT_MS`. */
  requestTimeoutMs?: number
  /** Max time with no upload progress before aborting; defaults to `DEFAULT_STALL_TIMEOUT_MS`. */
  stallTimeoutMs?: number
}

export interface SigV4Input {
  method: string
  url: string | URL
  /** Extra headers to sign; `host`/`x-amz-*` are added automatically. */
  headers?: Record<string, string>
  /** Hex SHA-256 of the payload, or `UNSIGNED-PAYLOAD`. */
  payloadHash: string
  region: string
  service?: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  date: Date
}

export interface SigV4Result {
  authorization: string
  /** Every header that must be sent (lower-cased names). */
  headers: Record<string, string>
  canonicalRequest: string
  stringToSign: string
  scope: string
  signature: string
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return bytesToHex(new Uint8Array(digest))
}

async function hmacSha256(key: Uint8Array<ArrayBuffer>, data: string): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
  return new Uint8Array(signature)
}

/** RFC 3986 encoding — the only characters left bare are A–Z a–z 0–9 - _ . ~. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

/**
 * Encode an object key for the URL path, preserving `/` separators.
 *
 * `.`/`..` segments are percent-encoded: URL path normalisation collapses them
 * (so `job/../x` would escape the job prefix), while `%2E` is left intact by
 * the WHATWG URL parser and by S3.
 */
export function encodeObjectKeyPath(key: string): string {
  return key
    .split('/')
    .map(segment => (segment === '.' || segment === '..' ? segment.replace(/[.]/g, '%2E') : encodeRfc3986(segment)))
    .join('/')
}

function amzDateParts(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[-:.]/g, '')
  return { amzDate: `${iso.slice(0, 8)}T${iso.slice(9, 15)}Z`, dateStamp: iso.slice(0, 8) }
}

function canonicalQueryString(url: URL): string {
  const pairs: Array<[string, string]> = []
  for (const [name, value] of url.searchParams.entries()) {
    pairs.push([encodeRfc3986(name), encodeRfc3986(value)])
  }
  // Canonical form sorts by encoded name, then by encoded value — not by the
  // joined `name=value` string, where a separator byte can invert a prefix
  // relationship (`a-b` would sort before `a`).
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  return pairs.map(([name, value]) => `${name}=${value}`).join('&')
}

/**
 * The path exactly as it appears in the URL text, before WHATWG normalisation.
 *
 * `new URL(...).pathname` collapses `.`/`..` segments — including their
 * percent-encoded forms `%2E`/`%2E%2E` — so a key such as `job/../x` would sign
 * (and, once `fetch` normalises it, write) an object outside its prefix. SigV4
 * canonicalises the request URI as sent, so the signature must bind the path we
 * actually intend; a mismatch then fails closed at the server instead of
 * silently relocating the object.
 */
function encodedPathOf(url: string | URL): string {
  if (typeof url !== 'string') return url.pathname || '/'
  const schemeEnd = url.indexOf('://')
  const rest = schemeEnd === -1 ? url : url.slice(schemeEnd + 3)
  const pathStart = rest.indexOf('/')
  if (pathStart === -1) return '/'
  const path = rest.slice(pathStart)
  const cut = path.search(/[?#]/)
  return (cut === -1 ? path : path.slice(0, cut)) || '/'
}

/** AWS collapses runs of whitespace and trims header values before signing. */
function canonicalHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/**
 * Signs one request with AWS SigV4 and returns the headers to send.
 *
 * Exported (and unit-tested against the documented AWS example) so the exact
 * canonicalisation is pinned independently of any network behaviour.
 */
export async function signAwsV4(input: SigV4Input): Promise<SigV4Result> {
  const url = new URL(input.url)
  const service = input.service ?? 's3'
  const { amzDate, dateStamp } = amzDateParts(input.date)
  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`

  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(input.headers ?? {})) headers[name.toLowerCase()] = value
  headers.host = url.host
  headers['x-amz-content-sha256'] = input.payloadHash
  headers['x-amz-date'] = amzDate
  if (input.sessionToken) headers['x-amz-security-token'] = input.sessionToken

  const signedNames = Object.keys(headers).sort()
  let canonicalHeaders = ''
  for (const name of signedNames) canonicalHeaders += `${name}:${canonicalHeaderValue(headers[name]!)}\n`
  const signedHeaders = signedNames.join(';')

  const canonicalRequest = [
    input.method.toUpperCase(),
    encodedPathOf(input.url),
    canonicalQueryString(url),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n')

  const stringToSign = [ALGORITHM, amzDate, scope, await sha256Hex(canonicalRequest)].join('\n')

  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${input.secretAccessKey}`), dateStamp)
  const kRegion = await hmacSha256(kDate, input.region)
  const kService = await hmacSha256(kRegion, service)
  const kSigning = await hmacSha256(kService, 'aws4_request')
  const signature = bytesToHex(await hmacSha256(kSigning, stringToSign))

  const authorization = `${ALGORITHM} Credential=${input.accessKeyId}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`
  return { authorization, headers, canonicalRequest, stringToSign, scope, signature }
}

/** Reads the five `ROX_DRIVE_S3_*` variables; returns null when incomplete. */
export function s3TargetOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): S3TargetOptions | null {
  const endpoint = env.ROX_DRIVE_S3_ENDPOINT?.trim()
  const bucket = env.ROX_DRIVE_S3_BUCKET?.trim()
  const accessKeyId = env.ROX_DRIVE_S3_ACCESS_KEY_ID?.trim()
  const secretAccessKey = env.ROX_DRIVE_S3_SECRET_ACCESS_KEY?.trim()
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null
  return {
    endpoint,
    bucket,
    region: env.ROX_DRIVE_S3_REGION?.trim() || 'auto',
    accessKeyId,
    secretAccessKey,
  }
}

/** Builds the `DriveUploadTarget` for one configured bucket. */
export function createS3UploadTarget(options: S3TargetOptions): DriveUploadTarget {
  const endpoint = options.endpoint.replace(/\/+$/, '')
  const region = options.region ?? 'auto'
  const fetchImpl = options.fetch ?? globalThis.fetch
  const now = options.now ?? (() => new Date())
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS

  return {
    async put(key, body, opts = {}) {
      const url = `${endpoint}/${options.bucket}/${encodeObjectKeyPath(key)}`
      const isBytes = body instanceof Uint8Array
      const payloadHash = isBytes ? await sha256Hex(body) : UNSIGNED_PAYLOAD
      const headers: Record<string, string> = {}
      if (opts.contentType) headers['content-type'] = opts.contentType
      if (opts.sizeBytes !== undefined) headers['content-length'] = String(opts.sizeBytes)

      const signed = await signAwsV4({
        method: 'PUT',
        url,
        headers,
        payloadHash,
        region,
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        sessionToken: options.sessionToken,
        date: now(),
      })

      // Downstream tsconfigs resolve `fetch`'s body type from a lib set that
      // omits byte bodies (DOM's includes `BufferSource`, others do not), so
      // assert at this boundary to keep the same runtime value valid in both.
      const requestBody = body as unknown as RequestInit['body']
      const init: RequestInit & { duplex?: 'half' } = {
        method: 'PUT',
        headers: { ...signed.headers, authorization: signed.authorization },
        body: requestBody,
      }
      // Undici requires an explicit half-duplex marker for streamed request bodies.
      if (!isBytes) init.duplex = 'half'

      // A streamed upload is aborted only on a stall (no progress for a full
      // window); a byte body has no progress signal and gets a hard cap.
      const monitor = isBytes ? undefined : new StallTimeoutMonitor(stallTimeoutMs)
      let timer: ReturnType<typeof setTimeout> | undefined
      if (monitor) {
        monitor.arm()
        init.body = guardStreamWithStall(body as ReadableStream<Uint8Array>, monitor) as unknown as RequestInit['body']
        init.signal = monitor.signal
      } else {
        const controller = new AbortController()
        timer = setTimeout(() => controller.abort(new FetchTimeoutError(requestTimeoutMs)), requestTimeoutMs)
        init.signal = controller.signal
      }

      let response: Response
      try {
        response = await fetchImpl(url, init)
      } catch (cause) {
        if (isTimeoutError(cause) || monitor?.timedOut || init.signal?.aborted) {
          throw Object.assign(new Error(`S3 PUT ${key} failed: timed out${monitor ? ` after ${stallTimeoutMs} ms without progress` : ` after ${requestTimeoutMs} ms`}`), {
            code: 'DRIVE_IMPORT_S3_PUT_FAILED',
            key,
            timeout: true,
          })
        }
        throw cause
      } finally {
        monitor?.clear()
        clearTimeout(timer)
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw Object.assign(new Error(`S3 PUT ${key} failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ''}`), {
          code: 'DRIVE_IMPORT_S3_PUT_FAILED',
          status: response.status,
          key,
        })
      }
    },
  }
}