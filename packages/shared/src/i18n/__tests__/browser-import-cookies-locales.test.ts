import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setupI18n } from "../setupI18n";
import i18n from "i18next";

const localesDir = join(import.meta.dir, "../locales");
const en = JSON.parse(readFileSync(join(localesDir, "en.json"), "utf8")) as Record<string, string>;
const ru = JSON.parse(readFileSync(join(localesDir, "ru.json"), "utf8")) as Record<string, string>;

const KEYS = [
  "settings.browserImport.consentCookies",
  "settings.browserImport.description",
] as const;

describe("P35-98 settings.browserImport leftover cookies locales", () => {
  it("keeps English cookies labels unchanged", async () => {
    await setupI18n().changeLanguage("en");
    expect(i18n.t("settings.browserImport.consentCookies")).toBe("Cookies");
    expect(i18n.t("settings.browserImport.description")).toBe(
      "Discover local Safari, Chromium, and Firefox profiles. Cookies and passwords need separate consent.",
    );
    expect(en["settings.browserImport.consentCookies"]).toBe("Cookies");
  });

  it("Russian copy is distinct from English", async () => {
    await setupI18n().changeLanguage("ru");
    expect(i18n.t("settings.browserImport.consentCookies")).toBe("Файлы cookie");
    expect(i18n.t("settings.browserImport.description")).toBe(
      "Найти локальные профили Safari, Chromium и Firefox. Файлы cookie и пароли требуют отдельного согласия.",
    );
    expect(i18n.t("settings.browserImport.consentCookies")).not.toBe("Cookies");
    expect(i18n.t("settings.browserImport.description")).not.toBe(
      en["settings.browserImport.description"],
    );
    expect(ru["settings.browserImport.consentCookies"]).not.toBe(
      en["settings.browserImport.consentCookies"],
    );
    expect(ru["settings.browserImport.description"]).not.toContain("Cookies");
    expect(ru["settings.browserImport.consentCookies"]).toBe(
      ru["onboarding.environment.browserImportCookies"],
    );
  });

  it("wires the cookies keys in all 12 locales", () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith(".json")).sort();
    expect(files).toHaveLength(12);
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), "utf8")) as Record<string, string>;
      for (const key of KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0);
      }
    }
  });
});
