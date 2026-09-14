import { afterAll, describe, expect, it } from "bun:test";
import { i18n, setupI18n } from "../setupI18n";

const KEYS = [
  "settings.privacy.cloudInferenceDesc",
  "settings.privacy.excludedHint",
  "settings.privacy.productImprovementDesc",
] as const;

/** Bare leftover English token: `, cookie ` / start-of-string `cookie `, not `файлы cookie`. */
const BARE_COOKIE_LEFTOVER = /(?:^|,\s)cookie(?:\s|,|$)/;

const ENGLISH = {
  "settings.privacy.cloudInferenceDesc":
    "Send prompts to a cloud model. Credentials, cookies, and passkeys never leave this device.",
  "settings.privacy.excludedHint":
    "Export never includes credentials, cookies, or passkeys.",
  "settings.privacy.productImprovementDesc":
    "Optional usage signals. Never includes credentials, cookies, or passkeys.",
} as const;

describe("settings.privacy leftover cookie wrapping", () => {
  const instance = setupI18n();

  afterAll(async () => {
    await instance.changeLanguage("ru");
  });

  it("Russian uses файлы cookie wrapping, not a bare English leftover", async () => {
    await instance.changeLanguage("ru");
    expect(i18n.resolvedLanguage).toBe("ru");

    for (const key of KEYS) {
      const value = instance.t(key);
      expect(value, key).toContain("файлы cookie");
      expect(value, key).not.toMatch(BARE_COOKIE_LEFTOVER);
      expect(value, key).not.toMatch(/\bcookies\b/i);
      expect(value, key).not.toBe(ENGLISH[key]);
    }

    expect(instance.t("settings.privacy.deletionNotLive")).toBe(
      "Удалённое удаление в очереди, не завершено",
    );
  });

  it("English still uses cookies", async () => {
    await instance.changeLanguage("en");
    expect(i18n.resolvedLanguage).toBe("en");

    for (const key of KEYS) {
      expect(instance.t(key), key).toBe(ENGLISH[key]);
      expect(instance.t(key), key).toMatch(/\bcookies\b/);
    }
  });
});
