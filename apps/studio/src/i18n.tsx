import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { en, type MessageKey } from "./i18n/en";
import { pt } from "./i18n/pt";

export type Lang = "en" | "pt";
type Params = Record<string, string | number | boolean>;

const dictionaries: Record<Lang, Record<MessageKey, string>> = { en, pt };
const STORAGE_KEY = "brad.lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "pt") return saved;
  } catch {
    // Storage may be unavailable; fall back to the browser language.
  }
  return navigator.language.toLowerCase().startsWith("pt") ? "pt" : "en";
}

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, params?: Params) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore: the choice just won't persist.
    }
  }, []);

  const t = useCallback(
    (key: MessageKey, params: Params = {}) =>
      // Unknown keys (e.g. from stored records) fall back to the key itself.
      (dictionaries[lang][key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`)),
    [lang],
  );

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
