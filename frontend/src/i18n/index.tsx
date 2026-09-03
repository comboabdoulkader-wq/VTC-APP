import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { I18nManager, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";

import { fr } from "./fr";
import { en } from "./en";
import { es } from "./es";
import { ar } from "./ar";
import { zh } from "./zh";
import { pt } from "./pt";

export type Lang = "fr" | "en" | "es" | "ar" | "zh" | "pt";
export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: "fr", label: "Français", flag: "🇫🇷" }, { code: "en", label: "English", flag: "🇬🇧" }, { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "ar", label: "العربية", flag: "🇸🇦" }, { code: "zh", label: "中文", flag: "🇨🇳" }, { code: "pt", label: "Português", flag: "🇵🇹" },
];
export type Dict = typeof fr;
const DICTS: Record<Lang, Partial<Dict>> = { fr, en, es, ar, zh, pt };
const KEY = "ridego_lang";

/** Device language → supported language (fallback en for unknown, fr for French locales). */
export function detectLang(): Lang {
  const code = (getLocales()[0]?.languageCode || "fr").toLowerCase();
  return (LANGS.some((l) => l.code === code) ? code : "en") as Lang;
}

type Ctx = { lang: Lang; isRTL: boolean; t: (key: keyof Dict, params?: Record<string, string | number>) => string; setLang: (l: Lang) => Promise<void> };
const I18nCtx = createContext<Ctx>({ lang: "fr", isRTL: false, t: (k) => String(fr[k] ?? k), setLang: async () => {} });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("fr");
  useEffect(() => { AsyncStorage.getItem(KEY).then((v) => setLangState((v as Lang) || detectLang())).catch(() => setLangState(detectLang())); }, []);
  const applyDirection = useCallback((l: Lang) => {
    const rtl = l === "ar";
    if (Platform.OS === "web") {
      if (typeof document !== "undefined") { document.documentElement.dir = rtl ? "rtl" : "ltr"; document.documentElement.lang = l; }
      return;
    }
    // Native: layout direction is applied at next app start (React Native limitation)
    I18nManager.allowRTL(rtl);
    if (I18nManager.isRTL !== rtl) I18nManager.forceRTL(rtl);
  }, []);
  useEffect(() => { applyDirection(lang); }, [lang, applyDirection]);
  const setLang = useCallback(async (l: Lang) => {
    setLangState(l);
    await AsyncStorage.setItem(KEY, l);
  }, []);
  const t = useCallback((key: keyof Dict, params?: Record<string, string | number>) => {
    let s = String(DICTS[lang][key] ?? fr[key] ?? key);
    if (params) Object.entries(params).forEach(([k, v]) => { s = s.replace(`{${k}}`, String(v)); });
    return s;
  }, [lang]);
  const value = useMemo(() => ({ lang, isRTL: lang === "ar", t, setLang }), [lang, t, setLang]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export const useI18n = () => useContext(I18nCtx);
