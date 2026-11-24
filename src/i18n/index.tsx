import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { makeFmt, type Fmt } from './format.ts';
import { STRINGS, type Lang, type Strings } from './strings.ts';

export type { Lang, Strings, Fmt };

const LANG_KEY = 'chargecheck-lang-v1';

export function loadLang(storage: Pick<Storage, 'getItem'> | null): Lang {
  try {
    const v = storage?.getItem(LANG_KEY);
    if (v === 'fi' || v === 'en') return v;
  } catch {
    // Storage blocked: use the default.
  }
  return 'fi';
}

export function saveLang(storage: Pick<Storage, 'setItem'> | null, lang: Lang): void {
  try {
    storage?.setItem(LANG_KEY, lang);
  } catch {
    // The choice just won't be remembered.
  }
}

interface Ctx {
  lang: Lang;
  t: Strings;
  fmt: Fmt;
}

const I18nContext = createContext<Ctx>({ lang: 'fi', t: STRINGS.fi, fmt: makeFmt('fi', STRINGS.fi) });

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo<Ctx>(() => ({ lang, t: STRINGS[lang], fmt: makeFmt(lang, STRINGS[lang]) }), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  return useContext(I18nContext);
}
