/**
 * W1-15 (#1512) i18n completeness gate: every key the chrome, agent-panel and
 * xfn contracts use exists, non-empty, in all 12 locales; RU (default) is
 * translated, not English.
 *
 * Keys are collected from the W1-15 sources (so a new literal key fails here
 * until it is added everywhere) plus the explicit §25.9 panel list.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const LOCALES_DIR = join(import.meta.dir, "../locales");
const REPO = join(import.meta.dir, "../../../../../");

const W1_15_SOURCES = [
  "packages/core/src/platform/chrome.ts",
  "packages/core/src/platform/__tests__/fixtures/surface-chrome.ts",
  "packages/core/src/agent-panel/context.ts",
  "packages/core/src/agent-panel/session.ts",
  "packages/core/src/xfn/commands.ts",
  "packages/core/src/xfn/reminder.ts",
  "apps/electron/src/renderer/platform/right-dock.ts",
];

const NAMESPACES = ["agentPanel.", "chrome.", "xfn."];

/** UI-SPEC §25.9, verbatim. */
const PANEL_KEYS = [
  "agentPanel.title",
  "agentPanel.placeholder",
  "agentPanel.newTopic",
  "agentPanel.history",
  "agentPanel.openInChat",
  "agentPanel.context",
  "agentPanel.addContext",
  "agentPanel.privateChip",
  "agentPanel.movedTo",
  "agentPanel.noWidth",
  "agentPanel.askAbout",
  "agentPanel.privacyHint",
];

/** UI-SPEC §26.1 counters and §26.4 Settings → «Панели и боковые панели». */
const CHROME_KEYS = [
  "chrome.counter.action",
  "chrome.counter.volume",
  "chrome.counter.items_one",
  "chrome.counter.items_other",
  "chrome.settings.title",
  "chrome.settings.autoCollapse",
  "chrome.settings.showCounters",
  "chrome.settings.countersRed",
  "chrome.settings.countersAll",
  "chrome.settings.countersNone",
  "chrome.settings.showPinned",
  "chrome.settings.reset",
  "chrome.settings.agentOpenAtLaunch",
  "chrome.settings.agentAutoContext",
  "chrome.settings.agentQuickActions",
  // The section vocabulary the fixture builds with a template literal
  // (`chrome.section.${id}`), so the regex above cannot see it.
  "chrome.section.pinned",
  "chrome.section.today",
  "chrome.section.upcoming",
  "chrome.section.recent",
  "chrome.section.history",
  "chrome.section.filters",
  "chrome.section.lists",
  "chrome.section.views",
  "chrome.section.shared",
  "chrome.section.personal",
  "chrome.section.collections",
  "chrome.section.people",
  "chrome.section.sources",
  "chrome.section.trash",
  "chrome.section.recordings",
  "chrome.section.templates",
];

/** Keys whose value is a product name: identical in every locale by design. */
const PRODUCT_NAMES = new Set(["agentPanel.title", "chrome.surface.wiki", "chrome.surface.drive", "chrome.surface.base"]);

function sourceKeys(): string[] {
  const keys = new Set<string>();
  for (const rel of W1_15_SOURCES) {
    const text = readFileSync(join(REPO, rel), "utf-8");
    for (const match of text.matchAll(/['"`](agentPanel\.[A-Za-z0-9.-]+|chrome\.[A-Za-z0-9.-]+|xfn\.[A-Za-z0-9.-]+)['"`]/g)) {
      keys.add(match[1]!);
    }
  }
  return [...keys].filter(
    (key) => NAMESPACES.some((prefix) => key.startsWith(prefix))
      // Workbench flag ids share the `xfn.` namespace but are not strings.
      && !/\.v\d+$/.test(key),
  ).sort();
}

const locales = Object.fromEntries(
  readdirSync(LOCALES_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => [file.replace(".json", ""), JSON.parse(readFileSync(join(LOCALES_DIR, file), "utf-8")) as Record<string, string>]),
);
const en = locales.en!;

function vars(value: string): string[] {
  return (value.match(/\{\{(\w+)\}\}/g) ?? []).map((m) => m.replace(/[{}]/g, "")).sort();
}

describe("W1-15 i18n completeness", () => {
  const keys = [...new Set([...sourceKeys(), ...PANEL_KEYS, ...CHROME_KEYS])].sort();

  it("finds the W1-15 key set in source (sanity)", () => {
    expect(Object.keys(locales).sort()).toEqual(["ar", "de", "en", "es", "fr", "hu", "ja", "ko", "pl", "ru", "zh-Hans", "zh-Hant"]);
    expect(keys.length).toBeGreaterThan(75);
    expect(sourceKeys()).toContain("chrome.rowContext.pin");
    expect(sourceKeys()).toContain("agentPanel.fallbackQuick.summary");
  });

  for (const lang of Object.keys(locales).sort()) {
    it(`${lang} defines every W1-15 key`, () => {
      const missing = keys.filter((key) => !locales[lang]![key]?.trim().length);
      expect(missing).toEqual([]);
    });

    it(`${lang} matches the EN interpolation variables`, () => {
      const mismatches = keys
        .filter((key) => key in en)
        .filter((key) => vars(locales[lang]![key]!).join(",") !== vars(en[key]!).join(","))
        .map((key) => `${key}: EN ${vars(en[key]!).join("|")} vs ${vars(locales[lang]![key]!).join("|")}`);
      expect(mismatches).toEqual([]);
    });
  }

  it("carries the same chrome.* / agentPanel.* / xfn.* key set as EN", () => {
    const relevant = (locale: Record<string, string>) =>
      Object.keys(locale).filter((key) => NAMESPACES.some((prefix) => key.startsWith(prefix))).sort();
    const reference = relevant(en);
    for (const [lang, locale] of Object.entries(locales)) {
      const present = relevant(locale);
      // Non-EN locales may add plural forms (_few / _many) that EN does not need.
      const extra = present.filter((key) => !reference.includes(key));
      expect({ lang, extra: extra.filter((key) => !/_(few|many)$/.test(key)) }).toEqual({ lang, extra: [] });
      expect({ lang, missing: reference.filter((key) => !present.includes(key)) }).toEqual({ lang, missing: [] });
    }
  });

  it("RU (default) is translated, not English", () => {
    const ru = locales.ru!;
    expect(ru["agentPanel.placeholder"]).toBe("Спросите @rox или дайте поручение…");
    expect(ru["agentPanel.privateChip"]).toBe("Личная заметка — добавить?");
    expect(ru["chrome.rowContext.pin"]).toBe("Закрепить");
    expect(ru["chrome.section.pinned"]).toBe("Закреплённое");
    expect(ru["xfn.x26.title"]).toBe("Закреплённое на всех экранах");
    const identical = keys.filter((key) => !PRODUCT_NAMES.has(key) && key in en && ru[key] === en[key]);
    expect(identical).toEqual([]);
  });

  it("RU carries the plural forms the count chips need", () => {
    expect(en["chrome.counter.items_one"]).toBe("{{count}} item");
    expect(en["chrome.counter.items_other"]).toBe("{{count}} items");
    expect(locales.ru!["chrome.counter.items_one"]).toBe("{{count}} элемент");
    expect(locales.ru!["chrome.counter.items_few"]).toBe("{{count}} элемента");
    expect(locales.ru!["chrome.counter.items_many"]).toBe("{{count}} элементов");
    expect(locales.ru!["chrome.counter.items_other"]).toBe("{{count}} элементов");
  });

  it("negative: no W1-15 value is empty, leaves a raw key or drops an interpolation", () => {
    for (const [lang, locale] of Object.entries(locales)) {
      for (const key of keys) {
        const value = locale[key];
        if (value === undefined) continue;
        expect({ lang, key, empty: value.trim().length === 0 }).toEqual({ lang, key, empty: false });
        expect({ lang, key, rawKey: value === key }).toEqual({ lang, key, rawKey: false });
        expect({ lang, key, variables: vars(value).join(",") }).toEqual({ lang, key, variables: vars(en[key] ?? value).join(",") });
      }
    }
  });
});