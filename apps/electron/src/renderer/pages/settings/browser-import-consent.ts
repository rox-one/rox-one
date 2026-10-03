import type { BrowserImportCategory } from '@craft-agent/shared/environment'
import type { BrowserFamily, ImportConsent } from '@craft-agent/shared/browser/profile-import'

/** Saved preferences never stand in for a per-profile or OS permission grant. */
export function browserImportConsent(
  categories: readonly BrowserImportCategory[],
  family: BrowserFamily | undefined,
  domains: string[],
): ImportConsent {
  return {
    historyBookmarks: categories.includes('history') || categories.includes('bookmarks'),
    history: categories.includes('history'),
    bookmarks: categories.includes('bookmarks'),
    cookies: categories.includes('cookies') && family === 'chromium' && domains.length > 0,
    credentials: categories.includes('credentials'),
    // Preferences request access; the native host supplies its own grant.
    osCredentialsApproved: false,
    domains,
  }
}

/** An active workspace grant takes precedence over a previous workspace's selection. */
export function browserImportProfileSelection(
  workspaceId: string | undefined,
  currentId: string | null,
  data: { workspaceId: string | null; enabled: boolean; profileId: string | null } | null,
  cookies: { consent: boolean; profileId?: string } | null,
): string | null {
  if (data?.enabled && data.workspaceId === workspaceId) return data.profileId
  if (cookies?.consent) return cookies.profileId ?? currentId
  return currentId
}
