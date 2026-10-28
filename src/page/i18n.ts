import { type Catalogue, en, type Key } from "./i18n/en";

/**
 * English, and the languages of the page's blocks. The other built-in languages are in i18n/built-in.ts:
 * the server writes them into the page, so a page holds only the languages it shows.
 */
export const CATALOGUES: Record<string, Catalogue> = { en };
/** Each language by its own name, for the language menu. */
export const LANGUAGE_NAMES: Record<string, string> = { en: "English" };

/**
 * The languages of a page block (the built-in ones, then the i18n block): new languages, or texts that
 * replace those it has. A missing text shows in English.
 */
export function addLanguages(extra: unknown): void {
  if (!extra || typeof extra !== "object") return;
  for (const [code, texts] of Object.entries(extra as Record<string, unknown>)) {
    if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(code) || !texts || typeof texts !== "object") continue;
    const own = Object.fromEntries(
      Object.entries(texts as Record<string, unknown>).filter(
        ([k, v]) => k in en && typeof v === "string",
      ),
    );
    CATALOGUES[code] = { ...(CATALOGUES[code] ?? en), ...own };
    LANGUAGE_NAMES[code] ??= languageName(code);
  }
}

/** A language by its own name, e.g. "Deutsch" for de. */
function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
    return name ? name[0].toUpperCase() + name.slice(1) : code;
  } catch {
    return code;
  }
}

export type T = (key: Key, params?: Record<string, string | number>) => string;

/** The chosen language when it is built in; for "auto", the first browser language that is; else English. */
export function pickLang(choice: string, browser: readonly string[]): string {
  if (choice in CATALOGUES) return choice;
  // a full tag (pt-BR) first, then its language (pt)
  const tags = browser.flatMap((l) => [l, l.slice(0, 2).toLowerCase()]);
  return tags.find((l) => l in CATALOGUES) ?? "en";
}

export function translator(lang: string): T {
  const c = CATALOGUES[lang] ?? en;
  const plural = new Intl.PluralRules(lang);
  return (key, params = {}) => {
    let text: string = c[key] ?? en[key];
    // "{n} session|{n} sessions": the singular form, then the plural one, chosen by n
    if (text.includes("|") && typeof params.n === "number") {
      const [one, other] = text.split("|");
      text = plural.select(params.n) === "one" ? one : other;
    }
    return text.replace(/\{(\w+)\}/g, (m, name: string) => String(params[name] ?? m));
  };
}

export type Fmt = ReturnType<typeof formatter>;

const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pad = (n: number) => String(n).padStart(2, "0");

/** Numbers, dates and durations in the page language. A missing value is the catalogue's "n/a". */
export function formatter(lang: string) {
  const na = (CATALOGUES[lang] ?? en).na;
  const numbers = new Map<number, Intl.NumberFormat>();
  const numberFormat = (digits: number) => {
    let f = numbers.get(digits);
    if (!f) {
      f = new Intl.NumberFormat(lang, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
      numbers.set(digits, f);
    }
    return f;
  };
  const percent = new Intl.NumberFormat(lang, {
    signDisplay: "exceptZero",
    maximumFractionDigits: 0,
  });
  const dayFormat = new Intl.DateTimeFormat(lang, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const longDay = new Intl.DateTimeFormat(lang, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return {
    na,
    num: (v: number | undefined, digits = 0) => (ok(v) ? numberFormat(digits).format(v) : na),
    /** A change in %, with its sign. */
    pct: (v: number | undefined) => (ok(v) ? `${percent.format(v)}%` : na),
    /** yyyy-MM-dd as "Oct 26" / "26 ott". */
    day: (d: string | undefined) => (d ? dayFormat.format(new Date(`${d}T00:00:00Z`)) : na),
    longDay: (d: string | undefined) => (d ? longDay.format(new Date(`${d}T00:00:00Z`)) : na),
    /** Seconds as "1:02:03" or "5:07". */
    hms: (s: number | undefined) => {
      if (!ok(s)) return na;
      const t = Math.round(s);
      const h = Math.floor(t / 3600);
      const m = Math.floor((t % 3600) / 60);
      return h > 0 ? `${h}:${pad(m)}:${pad(t % 60)}` : `${m}:${pad(t % 60)}`;
    },
    /** Seconds as "1h 30m". */
    hours: (s: number | undefined) => {
      if (!ok(s)) return na;
      const m = Math.round(s / 60);
      return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
    },
  };
}

export type { Key };
