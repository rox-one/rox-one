/**
 * date-fns locales per UI language. These are small (a few KB each) and are
 * needed synchronously by date formatting, so they stay static; only the large
 * message bundles are loaded lazily.
 */
import type { Locale } from "date-fns";
import { ar } from "date-fns/locale/ar";
import { de } from "date-fns/locale/de";
import { enUS } from "date-fns/locale/en-US";
import { es } from "date-fns/locale/es";
import { fr } from "date-fns/locale/fr";
import { hu } from "date-fns/locale/hu";
import { ja } from "date-fns/locale/ja";
import { ko } from "date-fns/locale/ko";
import { pl } from "date-fns/locale/pl";
import { ru } from "date-fns/locale/ru";
import { zhCN } from "date-fns/locale/zh-CN";
import { zhTW } from "date-fns/locale/zh-TW";
import type { LanguageCode } from "./locale-meta";

export const DATE_LOCALES: Record<LanguageCode, Locale> = {
  en: enUS,
  ru,
  es,
  "zh-Hans": zhCN,
  "zh-Hant": zhTW,
  ja,
  de,
  hu,
  pl,
  fr,
  ko,
  ar,
};
