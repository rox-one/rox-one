import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setupI18n } from "../setupI18n";
import i18n from "i18next";

const localesDir = join(import.meta.dir, "../locales");
const en = JSON.parse(readFileSync(join(localesDir, "en.json"), "utf8")) as Record<string, string>;
const ru = JSON.parse(readFileSync(join(localesDir, "ru.json"), "utf8")) as Record<string, string>;

const KEY = "settings.orgs.inviteDesc";
const EN_VALUE =
  "Invite by email or username. The invite is stored on this device. Email is not sent. Redeem locally or via Rox Server URL when configured.";
const RU_VALUE =
  "Пригласите по email или имени пользователя. Приглашение хранится на этом устройстве. Письмо не отправляется. Погашение локально или через URL сервера Rox, если он задан.";

describe("P35-99 settings.orgs.inviteDesc leftover Rox Server URL", () => {
  it("keeps English invite copy unchanged", async () => {
    await setupI18n().changeLanguage("en");
    expect(i18n.t(KEY)).toBe(EN_VALUE);
    expect(en[KEY]).toBe(EN_VALUE);
    expect(en[KEY]).toContain("Rox Server URL");
  });

  it("Russian copy uses URL сервера Rox instead of leftover English", async () => {
    await setupI18n().changeLanguage("ru");
    expect(i18n.t(KEY)).toBe(RU_VALUE);
    expect(i18n.t(KEY)).not.toBe(EN_VALUE);
    expect(ru[KEY]).toBe(RU_VALUE);
    expect(ru[KEY]).not.toBe(en[KEY]);
    expect(ru[KEY]).not.toContain("Rox Server URL");
    expect(ru[KEY]).toContain("URL сервера Rox");
  });

  it("wires inviteDesc in all 12 locales", () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith(".json")).sort();
    expect(files).toHaveLength(12);
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), "utf8")) as Record<string, string>;
      expect(locale[KEY]?.length, `${file} ${KEY}`).toBeGreaterThan(0);
    }
  });
});
