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
export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
    return name ? name[0].toUpperCase() + name.slice(1) : code;
  } catch {
    return code;
  }
}

/** A text of a custom widget in the language (full tag, then language), else in English. */
export function widgetText(
  texts: Record<string, Record<string, string>> | undefined,
  lang: string,
  key: string,
): string | undefined {
  return texts?.[lang]?.[key] ?? texts?.[lang.slice(0, 2)]?.[key] ?? texts?.en?.[key];
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

/** The measurement systems of a Garmin profile. */
export type Units = "metric" | "statute_us" | "statute_uk";

const MI = 1.609344;
const LB = 0.45359237;
/** The shown unit of each quantity, and how many metric units (km, m, kg, 100 m) it holds. */
const SYSTEMS = {
  metric: { dist: ["km", 1], elev: ["m", 1], mass: ["kg", 1], swim: ["100 m", 1], speed: "km/h" },
  statute_us: {
    dist: ["mi", MI],
    elev: ["ft", 0.3048],
    mass: ["lb", LB],
    swim: ["100 yd", 0.9144],
    speed: "mph",
  },
  // Garmin's UK setting: miles and pounds, but elevation and pools in metres
  statute_uk: {
    dist: ["mi", MI],
    elev: ["m", 1],
    mass: ["lb", LB],
    swim: ["100 m", 1],
    speed: "mph",
  },
} as const;

/** Numbers, dates and durations in the page language, and data values in the units of the Garmin profile. A missing value is the catalogue's "n/a". */
export function formatter(lang: string, units: Units = "metric") {
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
  const num = (v: number | undefined, digits = 0) => (ok(v) ? numberFormat(digits).format(v) : na);
  const hms = (s: number | undefined) => {
    if (!ok(s)) return na;
    const t = Math.round(s);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    return h > 0 ? `${h}:${pad(m)}:${pad(t % 60)}` : `${m}:${pad(t % 60)}`;
  };
  const u = SYSTEMS[units] ?? SYSTEMS.metric;
  // the data is metric: these give a value in the shown unit, for text, sums and charts
  const to = {
    dist: (km: number) => km / u.dist[1],
    pace: (secPerKm: number) => secPerKm * u.dist[1],
    speed: (kmh: number) => kmh / u.dist[1],
    elev: (m: number) => m / u.elev[1],
    mass: (kg: number) => kg / u.mass[1],
    swim: (secPer100m: number) => secPer100m * u.swim[1],
  };
  const unit = {
    dist: u.dist[0],
    pace: `/${u.dist[0]}`,
    speed: u.speed,
    elev: u.elev[0],
    mass: u.mass[0],
    swim: `/${u.swim[0]}`,
  };
  const value = (v: number | undefined, f: (x: number) => number, digits: number, name: string) =>
    ok(v) ? `${num(f(v), digits)} ${name}` : na;
  return {
    na,
    num,
    to,
    unit,
    /** km as "12.3 km" or "7.6 mi". */
    dist: (km: number | undefined, digits = 1) => value(km, to.dist, digits, unit.dist),
    /** Seconds per km as "5:07/km" or "8:14/mi". */
    pace: (secPerKm: number | undefined) =>
      ok(secPerKm) ? `${hms(to.pace(secPerKm))}${unit.pace}` : na,
    /** km/h as "25.0 km/h" or "15.5 mph". */
    speed: (kmh: number | undefined, digits = 1) => value(kmh, to.speed, digits, unit.speed),
    /** Metres as "120 m" or "394 ft". */
    elev: (m: number | undefined, digits = 0) => value(m, to.elev, digits, unit.elev),
    /** kg as "60.0 kg" or "132.3 lb". */
    mass: (kg: number | undefined, digits = 1) => value(kg, to.mass, digits, unit.mass),
    /** Seconds per 100 m as "1:50/100 m" or "1:41/100 yd". */
    swimPace: (secPer100m: number | undefined) =>
      ok(secPer100m) ? `${hms(to.swim(secPer100m))}${unit.swim}` : na,
    /** A change in %, with its sign. */
    pct: (v: number | undefined) => (ok(v) ? `${percent.format(v)}%` : na),
    /** yyyy-MM-dd as "Oct 26" / "26 ott". */
    day: (d: string | undefined) => (d ? dayFormat.format(new Date(`${d}T00:00:00Z`)) : na),
    longDay: (d: string | undefined) => (d ? longDay.format(new Date(`${d}T00:00:00Z`)) : na),
    /** Seconds as "1:02:03" or "5:07". */
    hms,
    /** Seconds as "1h 30m". */
    hours: (s: number | undefined) => {
      if (!ok(s)) return na;
      const m = Math.round(s / 60);
      return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
    },
  };
}

export type { Key };
