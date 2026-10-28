import { Profile } from "@garmin/fitsdk";
import { describe, expect, it, vi } from "vitest";
import { addLanguages, formatter, pickLang, translator } from "../../src/page/i18n";
import { BUILT_IN } from "../../src/page/i18n/built-in";
import { en } from "../../src/page/i18n/en";
import { typeName } from "../../src/page/widgets/ui";

const names = (s: string) => (s.match(/\{\w+\}/g) ?? []).toSorted();
const ALL = { en, ...BUILT_IN };
// the built-in languages come from the page's languages block, as the server writes it
addLanguages(BUILT_IN);

describe("catalogues", () => {
  it("has only English in the page script", async () => {
    vi.resetModules();
    const fresh = await import("../../src/page/i18n");
    expect(Object.keys(fresh.CATALOGUES)).toEqual(["en"]);
  });

  it("names a language of a block by its own name, and keeps a block's texts over the built-in ones", () => {
    addLanguages({ it: { title: "Il mio allenamento" } });
    expect(translator("it")("title")).toBe("Il mio allenamento");
    expect(translator("it")("na")).toBe("n/d");
    addLanguages(BUILT_IN);
  });

  it.each(Object.entries(ALL))("%s has exactly the keys of en, none empty", (_, catalogue) => {
    expect(Object.keys(catalogue).toSorted()).toEqual(Object.keys(en).toSorted());
    expect(Object.values(catalogue).filter((v) => v.trim() === "")).toEqual([]);
  });

  it.each(Object.entries(ALL))("%s keeps every {placeholder} of en", (_, catalogue) => {
    for (const [key, text] of Object.entries(en)) {
      expect([key, names(catalogue[key as keyof typeof en])]).toEqual([key, names(text)]);
    }
  });
});

describe("sport names", () => {
  it("has a text for every sport of the FIT SDK, the name of its board", () => {
    const sports = Object.values(Profile.types.sport).filter((s) => s !== "all");
    expect(sports.filter((s) => !(`type.${s}` in en))).toEqual([]);
  });

  it("names a board in the page language, or by its key when it has no text", () => {
    expect(typeName(translator("it"), "alpineSkiing")).toBe("Sci alpino");
    expect(typeName(translator("en"), "hiit")).toBe("HIIT");
    expect(typeName(translator("en"), "newSport")).toBe("newSport");
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
    expect(translator("en")("kpi.totals", { distance: "5 km", time: "1h", n: 1 })).toBe(
      "5 km · 1h · 1 session",
    );
    expect(translator("en")("kpi.totals", { distance: "5 km", time: "1h", n: 2 })).toBe(
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

  it("shows metric data in the units of the Garmin profile", () => {
    const m = formatter("en");
    const us = formatter("en", "statute_us");
    const uk = formatter("en", "statute_uk");
    expect([m.dist(5), us.dist(5), uk.dist(5)]).toEqual(["5.0 km", "3.1 mi", "3.1 mi"]);
    expect([m.pace(300), us.pace(300), uk.pace(300)]).toEqual(["5:00/km", "8:03/mi", "8:03/mi"]);
    expect([m.speed(30), us.speed(30)]).toEqual(["30.0 km/h", "18.6 mph"]);
    expect([m.elev(100), us.elev(100), uk.elev(100)]).toEqual(["100 m", "328 ft", "100 m"]);
    expect([m.mass(100), us.mass(100), uk.mass(100)]).toEqual(["100.0 kg", "220.5 lb", "220.5 lb"]);
    expect([m.swimPace(110), us.swimPace(110), uk.swimPace(110)]).toEqual([
      "1:50/100 m",
      "1:41/100 yd",
      "1:50/100 m",
    ]);
    expect(us.to.dist(1.609344)).toBeCloseTo(1);
    expect(us.unit).toMatchObject({ dist: "mi", pace: "/mi", mass: "lb", elev: "ft" });
  });

  it("shows metric for a measurement system it does not know", () => {
    expect(formatter("en", "nautical" as never).dist(5)).toBe("5.0 km");
  });

  it("writes a missing value as n/a", () => {
    expect(formatter("en", "statute_us").dist(undefined)).toBe("n/a");
    expect(formatter("en", "statute_us").pace(Number.NaN)).toBe("n/a");
    expect(formatter("en", "statute_us").swimPace(undefined)).toBe("n/a");
    expect(formatter("en").hms(undefined)).toBe("n/a");
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
