/**
 * W1-08 (#1505) review 8: every entity-UI plural key has every CLDR plural
 * category of each locale. i18next resolves the suffix per language, so a
 * missing `_two` in ar (or `_many` in fr/es) makes that count fall through to
 * the fallback language (ru → en) instead of rendering in the UI language.
 */
import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import i18next from "i18next";

const LOCALES_DIR = join(import.meta.dir, "../locales");
const locales: Record<string, Record<string, string>> = {};
for (const file of readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"))) {
  locales[file.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(LOCALES_DIR, file), "utf-8"));
}

const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/;
const en = locales["en"]!;
/** Plural base keys owned by #1505 (entity UI primitives). */
const ENTITY_PLURAL_BASES = [
  ...new Set(Object.keys(en).filter((k) => k.startsWith("entities.ui.") && PLURAL_SUFFIX.test(k)).map((k) => k.replace(PLURAL_SUFFIX, ""))),
].sort();

describe("#1505 entity UI plural keys cover every CLDR category", () => {
  it("finds the known plural keys", () => {
    expect(ENTITY_PLURAL_BASES).toEqual(expect.arrayContaining([
      "entities.ui.backlinks.count",
      "entities.ui.comments.replies",
      "entities.ui.subscribers.count",
    ]));
  });

  for (const [lang, messages] of Object.entries(locales)) {
    it(`${lang} has ${new Intl.PluralRules(lang).resolvedOptions().pluralCategories.join("/")} for each key`, () => {
      const categories = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
      const missing: string[] = [];
      for (const base of ENTITY_PLURAL_BASES) {
        for (const category of categories) {
          const value = messages[`${base}_${category}`];
          if (typeof value !== "string" || value.trim() === "") missing.push(`${base}_${category}`);
          else if (!value.includes("{{count}}")) missing.push(`${base}_${category} (no {{count}})`);
        }
      }
      expect(missing).toEqual([]);
    });
  }

  it("ar renders 0/1/2/3/11/100 in Arabic, never via the ru/en fallback", async () => {
    const instance = i18next.createInstance();
    await instance.init({
      lng: "ar",
      fallbackLng: ["ru", "en"],
      resources: Object.fromEntries(Object.entries(locales).map(([code, messages]) => [code, { translation: messages }])),
      initImmediate: false,
      interpolation: { escapeValue: false },
    });
    const ar = locales["ar"]!;
    const arValues = new Set(Object.values(ar));
    for (const base of ENTITY_PLURAL_BASES) {
      for (const count of [0, 1, 2, 3, 11, 100]) {
        const category = new Intl.PluralRules("ar").select(count);
        const out = instance.t(base, { count });
        expect(out).toBe(ar[`${base}_${category}`]!.replace("{{count}}", String(count)));
        expect(arValues.has(ar[`${base}_${category}`]!)).toBe(true);
      }
    }
  });
});
