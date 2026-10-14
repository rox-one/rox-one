import { HOME_FETCH_CHANNELS, type HomeFetchApi, type HomeFetchRequest, type HomeSearchRequest } from '../shared/home-fetch'

/** Narrow bridge: URL + format only; headers, methods and keys stay in main. */
export function createHomeFetchBridge(invoke: (channel: string, ...args: unknown[]) => Promise<unknown>): HomeFetchApi {
  return Object.freeze({
    fetch: (request: HomeFetchRequest) =>
      invoke(HOME_FETCH_CHANNELS.FETCH, {
        url: String(request.url),
        as: request.as === 'json' ? 'json' : 'text',
        ...(typeof request.maxAgeMs === 'number' ? { maxAgeMs: request.maxAgeMs } : {}),
        ...(request.force === true ? { force: true } : {}),
      }) as ReturnType<HomeFetchApi['fetch']>,
    search: (request: HomeSearchRequest) =>
      invoke(HOME_FETCH_CHANNELS.SEARCH, {
        query: String(request.query),
        ...(typeof request.numResults === 'number' ? { numResults: request.numResults } : {}),
      }) as ReturnType<HomeFetchApi['search']>,
    status: () => invoke(HOME_FETCH_CHANNELS.STATUS) as ReturnType<HomeFetchApi['status']>,
  }) as HomeFetchApi
}
