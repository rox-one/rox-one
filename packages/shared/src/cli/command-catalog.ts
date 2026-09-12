/**
 * Rox CLI slash-command catalog (Issue 22).
 *
 * Terminal `/command` syntax is secondary. Each entry names the native
 * Rox surface (menu, composer, settings) and keeps the compatibility id
 * used by OMP/Craft slash parsers.
 */

import { ROX_VISIBLE_TERMS } from '../identity/terms.ts'

export const ROX_CLI_RUNTIME_LABEL = ROX_VISIBLE_TERMS.cli

export type CliNativeSurface =
  | 'composer-slash'
  | 'session-menu'
  | 'permission-badge'
  | 'settings'

export type CliCommandId =
  | 'safe'
  | 'ask'
  | 'allow-all'
  | 'compact'
  | 'undo'
  | 'share'
  | 'join'
  | 'export'
  | 'vibe'

export interface CliCommandEntry {
  /** Canonical Rox command id (also the slash token). */
  id: CliCommandId
  /** Secondary terminal syntax, including the leading slash. */
  slash: `/${CliCommandId}`
  /** Compatibility parser id (OMP/Craft). Same as `id` unless aliased. */
  compatibilityId: string
  nativeSurface: CliNativeSurface
  /** Existing i18n key for the native control, when one already exists. */
  nativeActionKey: string
  labelKey: string
  useCaseKey: string
}

export const CLI_COMMAND_CATALOG: readonly CliCommandEntry[] = [
  {
    id: 'safe',
    slash: '/safe',
    compatibilityId: 'safe',
    nativeSurface: 'permission-badge',
    nativeActionKey: 'mode.safe',
    labelKey: 'cli.command.safe.label',
    useCaseKey: 'cli.command.safe.useCase',
  },
  {
    id: 'ask',
    slash: '/ask',
    compatibilityId: 'ask',
    nativeSurface: 'permission-badge',
    nativeActionKey: 'mode.ask',
    labelKey: 'cli.command.ask.label',
    useCaseKey: 'cli.command.ask.useCase',
  },
  {
    id: 'allow-all',
    slash: '/allow-all',
    compatibilityId: 'allow-all',
    nativeSurface: 'permission-badge',
    nativeActionKey: 'mode.allow-all',
    labelKey: 'cli.command.allowAll.label',
    useCaseKey: 'cli.command.allowAll.useCase',
  },
  {
    id: 'compact',
    slash: '/compact',
    compatibilityId: 'compact',
    nativeSurface: 'composer-slash',
    nativeActionKey: 'cli.command.compact.label',
    labelKey: 'cli.command.compact.label',
    useCaseKey: 'cli.command.compact.useCase',
  },
  {
    id: 'undo',
    slash: '/undo',
    compatibilityId: 'undo',
    nativeSurface: 'composer-slash',
    nativeActionKey: 'cli.command.undo.label',
    labelKey: 'cli.command.undo.label',
    useCaseKey: 'cli.command.undo.useCase',
  },
  {
    id: 'share',
    slash: '/share',
    compatibilityId: 'share',
    nativeSurface: 'session-menu',
    nativeActionKey: 'sessionMenu.share',
    labelKey: 'cli.command.share.label',
    useCaseKey: 'cli.command.share.useCase',
  },
  {
    id: 'join',
    slash: '/join',
    compatibilityId: 'join',
    nativeSurface: 'session-menu',
    nativeActionKey: 'sessionMenu.join',
    labelKey: 'cli.command.join.label',
    useCaseKey: 'cli.command.join.useCase',
  },
  {
    id: 'export',
    slash: '/export',
    compatibilityId: 'export',
    nativeSurface: 'session-menu',
    nativeActionKey: 'sessionMenu.export',
    labelKey: 'cli.command.export.label',
    useCaseKey: 'cli.command.export.useCase',
  },
  {
    id: 'vibe',
    slash: '/vibe',
    compatibilityId: 'vibe',
    nativeSurface: 'settings',
    nativeActionKey: 'cli.command.vibe.label',
    labelKey: 'cli.command.vibe.label',
    useCaseKey: 'cli.command.vibe.useCase',
  },
]

const BY_ID = new Map(CLI_COMMAND_CATALOG.map((entry) => [entry.id, entry]))
const BY_SLASH = new Map(CLI_COMMAND_CATALOG.map((entry) => [entry.slash, entry]))

export function getCliCommand(id: string): CliCommandEntry | undefined {
  return BY_ID.get(id as CliCommandId)
}

/** Resolve `/share foo` or `share` to a catalog entry. */
export function resolveCliSlash(input: string): CliCommandEntry | undefined {
  const trimmed = input.trim()
  if (!trimmed) return undefined
  const token = (trimmed.startsWith('/') ? trimmed : `/${trimmed}`).split(/\s+/)[0]?.toLowerCase()
  if (!token) return undefined
  return BY_SLASH.get(token as `/${CliCommandId}`)
}

export function cliCommandsForSurface(surface: CliNativeSurface): CliCommandEntry[] {
  return CLI_COMMAND_CATALOG.filter((entry) => entry.nativeSurface === surface)
}
