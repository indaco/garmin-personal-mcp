import { describe, expect, it } from "vitest";
import { CATALOGUES, formatter, pickLang, translator } from "../../src/page/i18n";
import { en } from "../../src/page/i18n/en";

const names = (s: string) => (s.match(/\{\w+\}/g) ?? []).toSorted();

describe("catalogues", () => {
  it.each(Object.entries(CATALOGUES))(
    "%s has exactly the keys of en, none empty",
    (_, catalogue) => {
      expect(Object.keys(catalogue).toSorted()).toEqual(Object.keys(en).toSorted());
      expect(Object.values(catalogue).filter((v) => v.trim() === "")).toEqual([]);
    },
  );

  it.each(Object.entries(CATALOGUES))("%s keeps every {placeholder} of en", (_, catalogue) => {
    for (const [key, text] of Object.entries(en)) {
      expect([key, names(catalogue[key as keyof typeof en])]).toEqual([key, names(text)]);
    }
  });
});

describe("pickLang", () => {
  it("uses the chosen language, then the browser languages, then English", () => {
    expect(pickLang("it", ["en-US"])).toBe("it");
    expect(pickLang("auto", ["de-DE", "it-IT", "en"])).toBe("it");
    expect(pickLang("auto", ["de-DE"])).toBe("en");
    expect(pickLang("xx", [])).toBe("en");
  });
});

describe("translator", () => {
  it("fills placeholders", () => {
    expect(translator("en")("window.last", { n: 4 })).toBe("Last 4");
    expect(translator("it")("window.last", { n: 4 })).toBe("Ultime 4");
  });
});

describe("plurals", () => {
  it("picks the singular or plural form of a text with {n}", () => {
    expect(translator("en")("kpi.totals", { km: "5", time: "1h", n: 1 })).toBe(
      "5 km · 1h · 1 session",
    );
    expect(translator("en")("kpi.totals", { km: "5", time: "1h", n: 2 })).toBe(
      "5 km · 1h · 2 sessions",
    );
    expect(translator("it")("ss.count", { n: 1 })).toBe("1 esercizio");
    expect(translator("it")("ss.count", { n: 3 })).toBe("3 esercizi");
  });
});

describe("formatter", () => {
  it("formats numbers and dates in the page language", () => {
    expect(formatter("en").num(1234.5, 1)).toBe("1,234.5");
    // Italian groups thousands from 5 digits
    expect(formatter("it").num(1234.5, 1)).toBe("1234,5");
    expect(formatter("it").num(12345.5, 1)).toBe("12.345,5");
    expect(formatter("en").day("2026-10-26")).toBe("Oct 26");
    expect(formatter("it").day("2026-10-26")).toBe("26 ott");
  });

  it("writes a missing value as n/a", () => {
    expect(formatter("en").num(undefined)).toBe("n/a");
    expect(formatter("en").num(Number.NaN)).toBe("n/a");
  });

  it("writes durations and paces", () => {
    const f = formatter("en");
    expect(f.hms(3723)).toBe("1:02:03");
    expect(f.hms(307)).toBe("5:07");
    expect(f.hours(5400)).toBe("1h 30m");
    expect(f.pct(12.34)).toBe("+12%");
    expect(f.pct(-3)).toBe("-3%");
    expect(f.pct(0)).toBe("0%");
  });
});
