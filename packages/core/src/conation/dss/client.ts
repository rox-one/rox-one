import {
  DSS_DEFAULT_BASE_URL,
  type DssClientOptions,
  type DssEntryMeta,
  type DssEntryPathArgs,
  type DssListEntriesArgs,
  type DssListEntriesResult,
  type DssListProjectsResult,
} from './types.ts'
import {
  dssContentPath,
  dssEntriesPath,
  dssMetaPath,
  dssProjectsPath,
} from './paths.ts'

export type DssClient = {
  readonly baseUrl: string
  listProjects: () => Promise<DssListProjectsResult>
  listEntries: (args: DssListEntriesArgs) => Promise<DssListEntriesResult>
  getEntryMeta: (args: DssEntryPathArgs) => Promise<DssEntryMeta>
  getEntryContent: (args: DssEntryPathArgs) => Promise<Uint8Array>
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/$/, '')
  return path.startsWith('http') ? path : `${b}${path.startsWith('/') ? path : `/${path}`}`
}

async function mergeHeaders(
  getHeaders: DssClientOptions['getHeaders'],
  signRequest: DssClientOptions['signRequest'],
  signInput: { method: string; path: string; body?: string | Uint8Array | null },
): Promise<Headers> {
  const headers = new Headers()
  if (getHeaders) {
    const extra = await getHeaders()
    new Headers(extra).forEach((v, k) => headers.set(k, v))
  }
  if (signRequest) {
    const signed = await signRequest(signInput)
    new Headers(signed).forEach((v, k) => headers.set(k, v))
  }
  return headers
}

async function dssGetJson<T>(
  baseUrl: string,
  path: string,
  options: Pick<DssClientOptions, 'getHeaders' | 'signRequest' | 'fetch'>,
): Promise<T> {
  const fetchImpl = options.fetch ?? fetch
  const headers = await mergeHeaders(options.getHeaders, options.signRequest, {
    method: 'GET',
    path,
    body: null,
  })
  if (!headers.has('accept')) headers.set('accept', 'application/json')
  const res = await fetchImpl(joinUrl(baseUrl, path), { method: 'GET', headers })
  if (!res.ok) {
    throw new Error(`DSS HTTP ${res.status} GET ${path}`)
  }
  return (await res.json()) as T
}

async function dssGetBytes(
  baseUrl: string,
  path: string,
  options: Pick<DssClientOptions, 'getHeaders' | 'signRequest' | 'fetch'>,
): Promise<Uint8Array> {
  const fetchImpl = options.fetch ?? fetch
  const headers = await mergeHeaders(options.getHeaders, options.signRequest, {
    method: 'GET',
    path,
    body: null,
  })
  const res = await fetchImpl(joinUrl(baseUrl, path), { method: 'GET', headers })
  if (!res.ok) {
    throw new Error(`DSS HTTP ${res.status} GET ${path}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Flag-gated factory. Returns null when `enabled` is false (default flag path).
 * Read-only: no upload/delete/move helpers.
 */
export function createDssClient(options: DssClientOptions): DssClient | null {
  if (!options.enabled) return null
  const baseUrl = options.baseUrl ?? DSS_DEFAULT_BASE_URL
  const hooks = {
    getHeaders: options.getHeaders,
    signRequest: options.signRequest,
    fetch: options.fetch,
  }

  return {
    baseUrl,
    listProjects() {
      return dssGetJson<DssListProjectsResult>(baseUrl, dssProjectsPath(), hooks).then((body) => ({
        projects: Array.isArray((body as DssListProjectsResult).projects)
          ? (body as DssListProjectsResult).projects
          : Array.isArray(body)
            ? (body as unknown as DssListProjectsResult['projects'])
            : [],
      }))
    },
    listEntries(args) {
      return dssGetJson<DssListEntriesResult>(
        baseUrl,
        dssEntriesPath(args.projectId, args.path, args.cursor),
        hooks,
      ).then((body) => ({
        entries: Array.isArray(body.entries) ? body.entries : [],
        nextCursor: body.nextCursor ?? null,
      }))
    },
    getEntryMeta(args) {
      return dssGetJson<DssEntryMeta>(baseUrl, dssMetaPath(args.projectId, args.path), hooks)
    },
    getEntryContent(args) {
      return dssGetBytes(baseUrl, dssContentPath(args.projectId, args.path), hooks)
    },
  }
}
