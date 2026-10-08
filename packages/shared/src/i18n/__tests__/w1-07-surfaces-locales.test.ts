/**
 * W1-07 (#1504) i18n completeness gate: every key the shell contracts use
 * (`surfaces.*`, the unified mode titles and the new shortcut labels) exists,
 * non-empty, in all 12 locales; RU (default) is translated, not English.
 *
 * Keys are collected from the W1-07 sources so a new literal key fails here
 * until it is added everywhere.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const LOCALES_DIR = join(import.meta.dir, "../locales");
const ELECTRON_SRC = join(import.meta.dir, "../../../../../apps/electron/src");

const W1_07_SOURCES = [
  "shared/surface-routes.ts",
  "renderer/platform/global-create.ts",
  "renderer/platform/GlobalCreateMenu.tsx",
  "renderer/platform/InspectorActionRail.tsx",
  "renderer/platform/omnibox-entities.ts",
  "renderer/platform/omnibox-bootstrap.ts",
  "renderer/platform/SurfaceHost.tsx",
];

const UNIFIED_SURFACES = ["messenger", "calendar", "goals", "contacts"];

const EXPLICIT_KEYS = [
  ...UNIFIED_SURFACES.map((surface) => `workbench.mode.${surface}`),
  "workbench.mode.docs",
  // `surfaces.${surface}.emptyTitle|emptyBody` (template literal in SurfaceHost).
  ...UNIFIED_SURFACES.flatMap((surface) => [`surfaces.${surface}.emptyTitle`, `surfaces.${surface}.emptyBody`]),
  "shortcuts.action.agentAskAboutSelection",
  "shortcuts.action.agentTogglePanel",
  "shortcuts.action.findInDoc",
  "shortcuts.action.quickPanelCalendar",
  "shortcuts.action.quickPanelContacts",
  "shortcuts.action.quickPanelDocs",
  "shortcuts.action.quickPanelTasks",
];

function sourceKeys(): string[] {
  const keys = new Set<string>();
  for (const rel of W1_07_SOURCES) {
    const text = readFileSync(join(ELECTRON_SRC, rel), "utf-8");
    for (const match of text.matchAll(/['"`](surfaces\.[A-Za-z0-9.-]+)['"`]/g)) keys.add(match[1]!);
  }
  return [...keys].sort();
}

const locales = Object.fromEntries(
  readdirSync(LOCALES_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => [file.replace(".json", ""), JSON.parse(readFileSync(join(LOCALES_DIR, file), "utf-8")) as Record<string, string>]),
);

describe("W1-07 i18n completeness", () => {
  const keys = [...new Set([...sourceKeys(), ...EXPLICIT_KEYS])].sort();

  it("finds the W1-07 keys in source (sanity)", () => {
    expect(sourceKeys().length).toBeGreaterThan(50);
    expect(Object.keys(locales).sort()).toEqual(["ar", "de", "en", "es", "fr", "hu", "ja", "ko", "pl", "ru", "zh-Hans", "zh-Hant"]);
  });

  for (const lang of Object.keys(locales).sort()) {
    it(`${lang} defines every W1-07 key`, () => {
      const missing = keys.filter((key) => !(locales[lang]![key]?.trim().length));
      expect(missing).toEqual([]);
    });
  }

  it("every locale carries the same surfaces.* key set as EN", () => {
    const enSurfaces = Object.keys(locales.en!).filter((key) => key.startsWith("surfaces.")).sort();
    for (const [lang, locale] of Object.entries(locales)) {
      expect({ lang, keys: Object.keys(locale).filter((key) => key.startsWith("surfaces.")).sort() }).toEqual({ lang, keys: enSurfaces });
    }
  });

  it("RU (default) copy is translated, not English", () => {
    const ru = locales.ru!;
    const en = locales.en!;
    expect(ru["workbench.mode.messenger"]).toBe("Мессенджер");
    expect(ru["workbench.mode.goals"]).toBe("Цели и проекты");
    expect(ru["workbench.mode.docs"]).toBe("Документы");
    const same = keys.filter((key) => ru[key] === en[key]);
    expect(same).toEqual([]);
  });

  it("negative: no W1-07 key leaks interpolation variables or empty strings", () => {
    for (const locale of Object.values(locales)) {
      for (const key of keys) expect(/\{\{|\}\}/.test(locale[key] ?? "")).toBe(false);
    }
  });
});
