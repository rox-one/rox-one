/**
 * ⌘K extra sections (top-50 #6): «Recent» routes and «Themes». Pure model so
 * it is testable without the dialog.
 */
import { scoreMatch } from './omnibox-helpers'

export interface RecentRow { route: string; title: string; subtitle?: string }
export interface ThemeRow { id: string; title: string; active: boolean }

export const RECENT_LIMIT = 5
export const THEMES_LIMIT = 8
/** Words that list every theme ("theme", "тема", …). */
export const THEME_KEYWORDS = ['theme', 'themes', 'тема', 'темы', 'thema', 'tema', 'thème', 'motyw', 'téma', 'テーマ', '테마', '主题', '主題', 'سمة']

export function filterRecent(rows: readonly RecentRow[], query: string, activeRoute: string | null): RecentRow[] {
  const q = query.trim()
  const pool = rows.filter((row) => row.route !== activeRoute)
  if (!q) return pool.slice(0, RECENT_LIMIT)
  return pool
    .map((row) => ({ row, s: Math.max(scoreMatch(row.title, q), scoreMatch(row.subtitle ?? '', q), scoreMatch(row.route, q)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, RECENT_LIMIT)
    .map((x) => x.row)
}

/** Themes appear only when asked: a theme keyword lists all, otherwise name matches. */
export function filterThemes(rows: readonly ThemeRow[], query: string): ThemeRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  if (THEME_KEYWORDS.some((k) => (q.length >= 3 && k.startsWith(q)) || q.startsWith(k))) {
    const rest = q.replace(new RegExp(`^(${THEME_KEYWORDS.join('|')})\\s*`), '')
    if (!rest) return rows.slice(0, THEMES_LIMIT * 4)
    return rows.filter((row) => scoreMatch(row.title, rest) > 0 || scoreMatch(row.id, rest) > 0)
  }
  return rows.filter((row) => scoreMatch(row.title, q) > 0.5 || scoreMatch(row.id, q) > 0.5).slice(0, THEMES_LIMIT)
}
