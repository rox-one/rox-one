/**
 * DISPATCH C1 — import themes from an installed Zed.
 *
 * Reads the two documented locations on macOS:
 *   ~/Library/Application Support/Zed/extensions/installed/<ext>/themes/*.json
 *   ~/.config/zed/themes/*.json
 * and accepts both Zed theme file shapes: a family (`{ themes: [...] }`) and a
 * single theme (`{ name, appearance, style }`).
 *
 * Mapping follows docs/themes/zed-import.md. Transparent surface alphas are
 * resolved to a solid base (editor.background) so the glass shell has an opaque
 * tint to composite. Writes go through the existing preset-theme storage helper;
 * a provenance manifest ({sourcePath, sha256, importedAt}) is kept beside the
 * theme catalog. Everything is filesystem-local — no network.
 *
 * The three themes already imported by hand (`nordfox-opaque`,
 * `min-dark-blurred`, `siri-light`) are never overwritten: importing one of them
 * is reported as `already-imported`. Any other existing id gets a `-2`, `-3`, …
 * suffix.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  getPresetThemesDir,
  writePresetThemeFile,
} from '@rox/shared/config';
import { PresetThemeSchema } from '@rox/shared/config/validators';
import type { ThemeFile } from '@rox/shared/config/theme';
import type { ZedThemeEntry, ZedThemeImportRequest, ZedThemeImportResult } from '@rox/shared/protocol';

/** Themes imported by hand in wave 1; never overwritten by the importer. */
export const RESERVED_IMPORT_IDS: readonly string[] = ['nordfox-opaque', 'min-dark-blurred', 'siri-light'];

interface ZedTheme {
  name: string;
  appearance: 'light' | 'dark';
  style: Record<string, unknown>;
}

interface ZedScanDeps {
  homeDir?: string;
  themesDir?: string;
  /** Directory holding `theme-imports.json`; defaults to the catalog's parent. */
  provenanceDir?: string;
  /** Existing preset ids; defaults to the live catalog. */
  existingIds?: ReadonlySet<string>;
}

const ANSI_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['black', 'black'], ['red', 'red'], ['green', 'green'], ['yellow', 'yellow'],
  ['blue', 'blue'], ['magenta', 'magenta'], ['cyan', 'cyan'], ['white', 'white'],
  ['brightBlack', 'bright_black'], ['brightRed', 'bright_red'], ['brightGreen', 'bright_green'], ['brightYellow', 'bright_yellow'],
  ['brightBlue', 'bright_blue'], ['brightMagenta', 'bright_magenta'], ['brightCyan', 'bright_cyan'], ['brightWhite', 'bright_white'],
  ['dimBlack', 'dim_black'], ['dimRed', 'dim_red'], ['dimGreen', 'dim_green'], ['dimYellow', 'dim_yellow'],
  ['dimBlue', 'dim_blue'], ['dimMagenta', 'dim_magenta'], ['dimCyan', 'dim_cyan'], ['dimWhite', 'dim_white'],
];

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** `#rrggbbaa` / `#rgba` → opaque `#rrggbb`; non-hex and #rgb pass through. */
export function toSolidColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const hex = color.match(/^#([0-9a-f]{8}|[0-9a-f]{4})$/i);
  if (hex) return `#${hex[1]!.slice(0, hex[1]!.length === 8 ? 6 : 3)}`;
  return color;
}

/** A fully transparent colour carries no base for the glass shell. */
function isTransparent(color: string | undefined): boolean {
  if (!color) return true;
  if (color === 'transparent') return true;
  const hex = color.match(/^#(?:[0-9a-f]{6})?([0-9a-f]{2})$/i);
  return hex ? parseInt(hex[1]!, 16) === 0 : false;
}

/** The solid base a translucent/absent surface falls back to. */
function solidBase(color: string | undefined, fallback: string | undefined): string | undefined {
  return isTransparent(color) ? fallback : toSolidColor(color);
}

/** Lowercase slug for the preset id; keeps letters/digits/`.`/`-`/`_`. */
export function slugifyThemeId(name: string): string {
  const slug = name.trim().toLowerCase()
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^\p{L}\p{N}._-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return slug || 'zed-theme';
}

/** Parse one Zed JSON file into its (possibly several) themes. */
export function parseZedThemeFile(raw: unknown): ZedTheme[] {
  if (!raw || typeof raw !== 'object') return [];
  const record = raw as Record<string, unknown>;
  const themes = Array.isArray(record.themes) ? record.themes : [record];
  const out: ZedTheme[] = [];
  for (const entry of themes) {
    if (!entry || typeof entry !== 'object') continue;
    const theme = entry as Record<string, unknown>;
    const name = asString(theme.name);
    const style = theme.style;
    if (!name || !style || typeof style !== 'object' || Array.isArray(style)) continue;
    out.push({
      name,
      appearance: theme.appearance === 'light' ? 'light' : 'dark',
      style: style as Record<string, unknown>,
    });
  }
  return out;
}

/** Map a parsed Zed theme onto the ROX preset shape (docs/themes/zed-import.md). */
export function mapZedThemeToRox(theme: ZedTheme): ThemeFile {
  const style = theme.style;
  const c = (key: string): string | undefined => asString(style[key]);
  const editorBackground = c('editor.background');
  const background = solidBase(editorBackground, editorBackground);
  const base = toSolidColor(editorBackground);

  const terminalAnsi: Record<string, string> = {};
  for (const [rox, zed] of ANSI_NAMES) {
    const color = c(`terminal.ansi.${zed}`);
    if (color) terminalAnsi[rox] = color;
  }

  const players = Array.isArray(style.players) ? style.players : [];
  const firstPlayer = players.find(p => p && typeof p === 'object') as Record<string, unknown> | undefined;
  const playerField = (field: string): string | undefined =>
    firstPlayer ? asString(firstPlayer[field]) : undefined;

  const syntaxSource = style.syntax && typeof style.syntax === 'object' ? style.syntax as Record<string, unknown> : undefined;
  const syntax = syntaxSource ? mapSyntax(syntaxSource) : undefined;

  const mapped: ThemeFile = {
    name: theme.name,
    description: `Импортирована из Zed (${theme.appearance}).`,
    supportedModes: [theme.appearance],
    mode: 'solid',
    background,
    paper: background,
    foreground: c('text') ?? c('editor.foreground'),
    accent: c('text.accent'),
    accentText: c('text.accent'),
    textSecondary: c('text.muted') ?? c('text'),
    textMuted: c('text.muted') ?? c('text'),
    textDisabled: c('text.disabled'),
    info: c('warning'),
    success: c('success') ?? c('created'),
    destructive: c('error') ?? c('deleted') ?? c('conflict'),
    focus: c('text.accent'),
    borderSubtle: c('border'),
    borderStrong: c('border.variant') ?? c('border'),
    borderFocused: c('border.focused') ?? c('border.variant') ?? c('border'),
    elementHover: c('element.hover'),
    elementSelected: c('element.selected'),
    navigator: solidBase(c('panel.background'), base),
    input: solidBase(c('element.background'), base),
    popover: solidBase(c('elevated_surface.background') ?? c('panel.overlay_background'), base),
    popoverSolid: solidBase(c('elevated_surface.background') ?? c('panel.overlay_background'), base),
    titlebar: c('titlebar.background'),
    toolbar: c('toolbar.background'),
    tabBar: c('tab_bar.background'),
    tabActive: c('tab.active_background'),
    tabInactive: c('tab.inactive_background'),
    terminalBackground: solidBase(c('terminal.background'), base),
    terminalForeground: c('terminal.foreground'),
    terminalBrightForeground: c('terminal.bright_foreground'),
    terminalDimForeground: c('terminal.dim_foreground'),
    terminalCursor: playerField('cursor') ?? c('text.accent'),
    terminalSelection: playerField('selection') ?? c('search.match_background') ?? c('text'),
    terminalAnsi: Object.keys(terminalAnsi).length > 0 ? terminalAnsi : undefined,
    syntax,
  };
  // Drop keys that resolved to undefined so the stored JSON stays clean.
  for (const key of Object.keys(mapped) as (keyof ThemeFile)[]) {
    if (mapped[key] === undefined) delete mapped[key];
  }
  return mapped;
}

function mapSyntax(source: Record<string, unknown>): ThemeFile['syntax'] {
  const out: NonNullable<ThemeFile['syntax']> = {};
  for (const [capture, value] of Object.entries(source)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    const color = asString(entry.color);
    if (!color) continue;
    out[capture] = {
      color,
      ...(asString(entry.font_style) ? { fontStyle: asString(entry.font_style)! } : {}),
      ...(typeof entry.font_weight === 'number' ? { fontWeight: entry.font_weight } : {}),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Zed install directories to scan (extension themes first, then user themes). */
function zedThemeFiles(home: string): Array<{ path: string; extensionId: string | null }> {
  const files: Array<{ path: string; extensionId: string | null }> = [];
  const installed = join(home, 'Library', 'Application Support', 'Zed', 'extensions', 'installed');
  if (existsSync(installed)) {
    try {
      for (const ext of readdirSync(installed)) {
        const themesDir = join(installed, ext, 'themes');
        if (!existsSync(themesDir) || !statSync(themesDir).isDirectory()) continue;
        for (const file of readdirSync(themesDir)) {
          if (file.endsWith('.json')) files.push({ path: join(themesDir, file), extensionId: ext });
        }
      }
    } catch {
      // A partially readable install must not abort the scan.
    }
  }
  const userThemes = join(home, '.config', 'zed', 'themes');
  if (existsSync(userThemes)) {
    try {
      for (const file of readdirSync(userThemes)) {
        if (file.endsWith('.json')) files.push({ path: join(userThemes, file), extensionId: null });
      }
    } catch {
      // Ignore unreadable user theme directories.
    }
  }
  return files;
}

function readZedThemes(path: string): ZedTheme[] {
  try {
    return parseZedThemeFile(JSON.parse(readFileSync(path, 'utf-8')));
  } catch {
    // Unreadable/corrupt files are skipped, never surfaced as an error.
    return [];
  }
}

function existingPresetIds(themesDir: string): Set<string> {
  try {
    return new Set(readdirSync(themesDir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')));
  } catch {
    return new Set();
  }
}

/** List every importable Zed theme. Never throws on a partial install. */
export function scanZedThemes(deps: ZedScanDeps = {}): ZedThemeEntry[] {
  const home = deps.homeDir ?? homedir();
  const themesDir = deps.themesDir ?? getPresetThemesDir();
  const existing = deps.existingIds ?? existingPresetIds(themesDir);
  const entries: ZedThemeEntry[] = [];
  for (const { path, extensionId } of zedThemeFiles(home)) {
    for (const theme of readZedThemes(path)) {
      const id = slugifyThemeId(theme.name);
      entries.push({
        id,
        name: theme.name,
        appearance: theme.appearance,
        sourcePath: path,
        extensionId,
        alreadyImported: existing.has(id),
      });
    }
  }
  return entries;
}

/** Choose the import id: reserved ids are left alone, others get `-N` suffixes. */
export function resolveImportId(name: string, existing: ReadonlySet<string>): string | null {
  const base = slugifyThemeId(name);
  if (RESERVED_IMPORT_IDS.includes(base) && existing.has(base)) return null;
  if (!existing.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!existing.has(candidate)) return candidate;
  }
  return base;
}

function provenancePath(themesDir: string, provenanceDir?: string): string {
  return join(provenanceDir ?? dirname(themesDir), 'theme-imports.json');
}

function appendProvenance(themesDir: string, entry: Record<string, unknown>, provenanceDir?: string): void {
  const path = provenancePath(themesDir, provenanceDir);
  let manifest: unknown[] = [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    if (Array.isArray(parsed)) manifest = parsed;
  } catch {
    manifest = [];
  }
  manifest.push(entry);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(manifest, null, 2), 'utf-8');
  } catch {
    // Provenance is advisory; a failed write must not fail a valid import.
  }
}

/**
 * Import one Zed theme into the ROX preset catalog.
 * Returns the outcome; never throws for an unreadable/invalid source.
 */
export function importZedTheme(
  request: ZedThemeImportRequest,
  deps: ZedScanDeps = {},
): ZedThemeImportResult {
  const themesDir = deps.themesDir ?? getPresetThemesDir();
  if (!request || typeof request.sourcePath !== 'string' || typeof request.name !== 'string') {
    return { status: 'error', reason: 'invalid-request' };
  }
  const themes = readZedThemes(request.sourcePath);
  const theme = themes.find(t => t.name === request.name);
  if (!theme) return { status: 'skipped', reason: 'not-found' };

  const existing = deps.existingIds ?? existingPresetIds(themesDir);
  const id = resolveImportId(theme.name, existing);
  if (id === null) return { status: 'skipped', reason: 'already-imported' };

  const mapped = mapZedThemeToRox(theme);
  if (!PresetThemeSchema.safeParse(mapped).success) return { status: 'skipped', reason: 'invalid' };

  try {
    if (!writePresetThemeFile(id, mapped, themesDir)) return { status: 'skipped', reason: 'already-imported' };
  } catch {
    return { status: 'skipped', reason: 'unreadable' };
  }

  let sha256 = '';
  try {
    sha256 = createHash('sha256').update(readFileSync(request.sourcePath)).digest('hex');
  } catch {
    sha256 = '';
  }
  appendProvenance(themesDir, {
    id,
    sourceTheme: theme.name,
    appearance: theme.appearance,
    sourcePath: request.sourcePath,
    sha256,
    importedAt: new Date().toISOString(),
  }, deps.provenanceDir);
  return { status: 'imported', id };
}