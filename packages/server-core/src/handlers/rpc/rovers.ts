/**
 * Rovers service catalog RPC (info-only Slice A, binding cross-slice contract §4).
 *
 * Serves the validated bundled `catalog.json` v1 to the renderer's read-only
 * Rovers section, and publishes the same catalog as the process-wide rovers tool
 * runtime so the rovers_list / rovers_search / rovers_show session tools read
 * one source of truth.
 *
 * Loading is signature-gated exactly like the marketplace catalog: the bundled
 * resource must carry a valid ed25519 `catalog.json.sig` (checked with the
 * shared marketplace verification code) and a matching `.sha256`; the
 * `ROX_ROVERS_CATALOG_PATH` dev override deliberately skips both. The catalog is
 * a bundled local resource, so this channel is LOCAL_ONLY and read-only — there
 * is no deploy engine on this slice.
 */

import { existsSync, readFileSync } from 'node:fs'

import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import { sha256HexOfString, verifyCatalogEd25519Signature } from '@rox/shared/marketplace'
import { getBundledAssetsDir } from '@rox/shared/utils'
import { registerRoversToolRuntime } from '@rox/session-tools-core'
import {
  createRoversCatalogQuery,
  loadRoversCatalog,
  resolveRoversCatalogLocation,
  RoversCatalogError,
  type RoversCatalog,
  type RoversCatalogIntegrity,
  type RoversCatalogLocation,
  type RoversCatalogProvider,
} from '@rox/rovers-core-lite'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const ROVERS_HANDLED_CHANNELS = [RPC_CHANNELS.rovers.LIST] as const

/** Reuses the marketplace catalog verification primitives (never duplicated). */
const marketplaceIntegrity: RoversCatalogIntegrity = {
  verifySignature: (body, signatureBase64) => verifyCatalogEd25519Signature(body, signatureBase64),
  sha256Hex: (body) => sha256HexOfString(body),
}

function fileProvider(location: RoversCatalogLocation): RoversCatalogProvider {
  return {
    origin: location.origin,
    readCatalog: () => readFileSync(location.catalogPath, 'utf8'),
    readSignature: () => (existsSync(location.signaturePath) ? readFileSync(location.signaturePath, 'utf8') : null),
    readDigest: () => (existsSync(location.digestPath) ? readFileSync(location.digestPath, 'utf8') : null),
  }
}

/** Resolve (bundled resources dir or the `ROX_ROVERS_CATALOG_PATH` override) and load + verify. */
export function loadRoversCatalogFromResources(): RoversCatalog {
  const location = resolveRoversCatalogLocation({
    bundledDir: getBundledAssetsDir('rovers') ?? null,
    env: process.env,
  })
  if (!location) {
    throw new RoversCatalogError(
      'NO_BUNDLED_CATALOG',
      'Rovers catalog is not available: no bundled resources/rovers/catalog.json and no ROX_ROVERS_CATALOG_PATH override',
    )
  }
  return loadRoversCatalog({ provider: fileProvider(location), integrity: marketplaceIntegrity })
}

export function registerRoversHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // Signature parity with sibling registrars (rpc/index.ts passes deps to all);
  // the read-only rovers channel needs no handler deps.
  void _deps

  let loaded: RoversCatalog | null = null
  let loadFailure: RoversCatalogError | null = null

  const load = (): RoversCatalog => {
    if (loaded) return loaded
    if (loadFailure) throw loadFailure
    try {
      loaded = loadRoversCatalogFromResources()
      return loaded
    } catch (error) {
      loadFailure =
        error instanceof RoversCatalogError
          ? error
          : new RoversCatalogError('INVALID_CATALOG', error instanceof Error ? error.message : String(error))
      throw loadFailure
    }
  }

  // Publish the catalog to the rovers_* session tools running in this process.
  // A missing/invalid catalog leaves the runtime unregistered, so those tools
  // answer a typed ROVERS_UNAVAILABLE instead of throwing.
  try {
    registerRoversToolRuntime(createRoversCatalogQuery(load()))
  } catch {
    // no catalog available in this environment
  }

  server.handle(
    RPC_CHANNELS.rovers.LIST,
    async (): Promise<{ entries: RoversCatalog['entries'] }> => {
      try {
        return { entries: load().entries }
      } catch (error) {
        if (error instanceof RoversCatalogError) {
          throw new CodedError('ROVERS_CATALOG_UNAVAILABLE', `ROVERS_${error.code}: ${error.message}`)
        }
        throw error
      }
    },
    { access: 'nativeOrLocalElectron', nativeAction: 'read' },
  )
}