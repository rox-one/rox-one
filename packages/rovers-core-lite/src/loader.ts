/**
 * Rovers catalog v1 — environment-agnostic loader.
 *
 * Everything environment-specific is injected:
 *   - the {@link RoversCatalogProvider} supplies the exact catalog body bytes
 *     plus the optional `.sig` / `.sha256` sidecars (a filesystem adapter lives
 *     in the host, not here);
 *   - the {@link RoversCatalogIntegrity} seam supplies the ed25519 verification
 *     and sha256 hashing reused from `@rox/shared/marketplace` (see
 *     server-core `handlers/rpc/rovers.ts`). This module never imports node
 *     built-ins, so it runs in any JS environment and the session-tools-core
 *     dependency cone stays free of `@rox/shared`.
 *
 * Signature policy (cross-slice contract §1):
 *   - a bundled catalog is a release artifact: it MUST carry a valid
 *     `catalog.json.sig` (and its `.sha256` when present) or loading fails closed;
 *   - the `ROX_ROVERS_CATALOG_PATH` dev override loads a local unsigned
 *     catalog.json and intentionally skips signature verification.
 */

import { parseRoversCatalog, RoversCatalogValidationError } from './schema.ts'
import { RoversCatalogError } from './query.ts'
import type { RoversCatalog } from './types.ts'

/** Where the catalog body came from — decides whether the signature is required. */
export type RoversCatalogOrigin = 'bundled' | 'override'

/** Resolved catalog + sidecar paths. */
export interface RoversCatalogLocation {
  origin: RoversCatalogOrigin
  catalogPath: string
  signaturePath: string
  digestPath: string
}

/**
 * Environment bag the resolver reads. Only `ROX_ROVERS_CATALOG_PATH` is
 * consumed; the index signature lets a host pass `process.env` directly.
 */
export type RoversCatalogEnv = Readonly<Record<string, string | undefined>>

/** Supplies the catalog body and its sidecars. */
export interface RoversCatalogProvider {
  origin: RoversCatalogOrigin
  /** Exact UTF-8 catalog body. */
  readCatalog(): string
  /** base64 ed25519 signature, or null when the sidecar is absent. */
  readSignature(): string | null
  /** GNU sha256 sidecar body (`<hex>  catalog.json`), or null when absent. */
  readDigest(): string | null
}

/** Injected crypto seam — the host supplies the marketplace primitives. */
export interface RoversCatalogIntegrity {
  /** Throws when `signatureBase64` does not verify over the exact body bytes. */
  verifySignature(body: string, signatureBase64: string): void
  /** Lowercase hex sha256 of the body. */
  sha256Hex(body: string): string
}

/** Join a directory and a leaf with the separator already used by the directory. */
export function joinRoversPath(dir: string, leaf: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return dir.endsWith(sep) ? `${dir}${leaf}` : `${dir}${sep}${leaf}`
}

/**
 * Resolve where to load the catalog from: the `ROX_ROVERS_CATALOG_PATH` override
 * wins over the bundled resources directory. Returns null when neither exists.
 */
export function resolveRoversCatalogLocation(options: {
  bundledDir?: string | null | undefined
  env?: RoversCatalogEnv | undefined
}): RoversCatalogLocation | null {
  const override = options.env?.ROX_ROVERS_CATALOG_PATH?.trim()
  if (override) {
    return {
      origin: 'override',
      catalogPath: override,
      signaturePath: `${override}.sig`,
      digestPath: `${override}.sha256`,
    }
  }
  if (!options.bundledDir) return null
  const catalogPath = joinRoversPath(options.bundledDir, 'catalog.json')
  return {
    origin: 'bundled',
    catalogPath,
    signaturePath: `${catalogPath}.sig`,
    digestPath: `${catalogPath}.sha256`,
  }
}

/** Load + validate a catalog from an injected provider. */
export function loadRoversCatalog(options: {
  provider: RoversCatalogProvider
  integrity: RoversCatalogIntegrity
}): RoversCatalog {
  const { provider, integrity } = options
  const body = provider.readCatalog()

  if (provider.origin === 'bundled') {
    const signature = provider.readSignature()
    if (signature === null || signature.trim() === '') {
      throw new RoversCatalogError(
        'UNSIGNED_BUNDLED_CATALOG',
        'bundled Rovers catalog is unsigned — a sibling catalog.json.sig is required',
      )
    }
    try {
      integrity.verifySignature(body, signature)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new RoversCatalogError('SIGNATURE_INVALID', `bundled Rovers catalog signature invalid: ${message}`)
    }

    const digest = provider.readDigest()
    if (digest !== null && digest.trim() !== '') {
      const token = (digest.trim().split(/\s+/)[0] ?? '').toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(token) || integrity.sha256Hex(body) !== token) {
        throw new RoversCatalogError('DIGEST_MISMATCH', 'bundled Rovers catalog sha256 mismatch')
      }
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new RoversCatalogError('INVALID_JSON', `Rovers catalog is not valid JSON: ${message}`)
  }

  try {
    return parseRoversCatalog(parsed)
  } catch (error) {
    if (error instanceof RoversCatalogValidationError) {
      throw new RoversCatalogError('INVALID_CATALOG', error.message, { issues: error.issues })
    }
    throw error
  }
}