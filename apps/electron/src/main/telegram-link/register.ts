/**
 * Main-process wiring for Telegram account linking (owner spec R4).
 *
 * The `tg-link:*` RPC handlers live in
 * `@rox/server-core/handlers/rpc/tg-link` and are registered by the core RPC
 * layer. This module is the host side of that contract: the Electron main
 * process is the only place that knows the deployment's environment, so it
 * injects the local daemon endpoint (`ROX_TG_LINK_URL`, `ROX_TG_LINK_TOKEN`)
 * into the shared handler before any renderer can call it — the same
 * injection pattern as `setSessionPlatform` / `setGithubUserToolHost`.
 */
import { DEFAULT_TG_LINK_URL, configureTelegramLinkService } from '@rox/server-core/handlers/rpc/tg-link'

export interface TelegramLinkRegistration {
  baseUrl: string
  /** True when a bearer token was provided; the value itself is never returned. */
  authTokenConfigured: boolean
}

export function registerTelegramLink(env: Record<string, string | undefined> = process.env): TelegramLinkRegistration {
  const baseUrl = (env.ROX_TG_LINK_URL ?? '').trim() || DEFAULT_TG_LINK_URL
  const authToken = (env.ROX_TG_LINK_TOKEN ?? env.LINK_AUTH_TOKEN ?? '').trim()
  configureTelegramLinkService({ baseUrl, authToken })
  return { baseUrl, authTokenConfigured: authToken !== '' }
}