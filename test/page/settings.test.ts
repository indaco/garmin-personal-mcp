import { describe, expect, it } from "vitest";
import { readSettings } from "../../src/page/settings";
import { openingTheme } from "../../src/page/theme";

/** Each setting with a value that the tools save. */
const SAVED = {
  title: "My page",
  headline: "Marathon",
  sports: ["running"],
  exclude: ["recovery", "notes"],
  languages: ["en", "it"],
  language: "it",
  themes: ["paper", "mist"],
  theme: "mist",
  workouts: true,
  recoveryHistory: true,
  yearReview: false,
  since: "2026-01-01",
  shared: true,
};
const TEXTS = ["title", "headline", "language", "theme", "since"];
const FLAGS = ["workouts", "recoveryHistory", "yearReview", "shared"];
const LISTS = ["sports", "languages", "themes"];
const rows = (keys: string[], values: unknown[]) =>
  keys.flatMap((key) => values.map((value): [string, unknown] => [key, value]));

describe("readSettings", () => {
  it("reads each setting that the tools save", () => {
    expect(readSettings(SAVED)).toEqual(SAVED);
  });

  it.each<[unknown]>([[undefined], [null], [{}], [5], [true], ["themes"], [[]], [["themes"]]])(
    "has no setting for the block %j",
    (block) => {
      // strict: no key without a value
      expect(readSettings(block)).toStrictEqual({});
    },
  );

  it.each([
    ...rows(TEXTS, [5, true, null, "", [], ["a"], { a: 1 }]),
    ...rows(FLAGS, [0, 1, null, "", "true", [], { a: 1 }]),
    ...rows(LISTS, [5, true, null, "", "paper", { a: 1 }, [5], ["paper", 5], ["paper", null]]),
    ...rows(["exclude"], [5, true, null, "", "recovery", { a: 1 }]),
    // an empty list of these would leave a page with nothing
    ...rows(["languages", "themes"], [[]]),
  ])("has no %s for %j, and keeps the other settings", (key, value) => {
    const { [key]: _, ...others } = { ...SAVED } as Record<string, unknown>;
    expect(readSettings({ ...SAVED, [key]: value })).toStrictEqual(others);
  });

  it("keeps both values of a flag", () => {
    for (const key of FLAGS) {
      expect(readSettings({ [key]: true })).toEqual({ [key]: true });
      expect(readSettings({ [key]: false })).toEqual({ [key]: false });
    }
  });

  it("keeps an empty list of sports, which shows no board, and of data to leave out", () => {
    expect(readSettings({ sports: [], exclude: [] })).toEqual({ sports: [], exclude: [] });
  });

  it("leaves out the data that it knows, also next to a name that it does not know", () => {
    expect(readSettings({ exclude: ["notes", "sleep", "recovery", 5] })).toEqual({
      exclude: ["notes", "recovery"],
    });
  });

  it("drops a setting that it does not know", () => {
    expect(readSettings({ colour: "red", title: "T" })).toEqual({ title: "T" });
  });
});

describe("openingTheme", () => {
  it.each<[object, string | null, string]>([
    [{}, null, "midnight"],
    [{}, "paper", "paper"],
    [{ theme: "ocean" }, null, "ocean"],
    [{ theme: "ocean" }, "paper", "paper"],
    [{ themes: ["paper", "mist"] }, null, "paper"],
    [{ themes: ["paper", "midnight"] }, null, "midnight"],
    [{ themes: ["paper", "mist"] }, "mist", "mist"],
    [{ themes: ["paper", "mist"] }, "ocean", "paper"],
    [{ themes: ["paper", "mist"], theme: "mist" }, "ocean", "mist"],
  ])("with the settings %j and the saved %j, it is %s", (settings, saved, theme) => {
    expect(openingTheme(readSettings(settings), saved)).toBe(theme);
  });
});
