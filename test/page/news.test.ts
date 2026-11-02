import { describe, expect, it } from "vitest";
import { parseNews } from "../../src/page/news";

const CODE = "bbbbbbbbbbbbbbbb";
const boards = new Set(["running", "cycling"]);
const names = new Set(["longRuns", "workoutTrend", "records"]);
const parse = (value: unknown) =>
  parseNews(
    value,
    CODE,
    (b) => boards.has(b),
    (w) => names.has(w),
  );
const record = (extra: Record<string, unknown> = {}) => ({
  from: "0.6.0",
  server: "0.7.0",
  code: CODE,
  widgets: { running: ["longRuns"] },
  ...extra,
});

describe("parseNews", () => {
  it("keeps a valid record", () => {
    expect(parse(record())).toEqual({
      code: CODE,
      server: "0.7.0",
      widgets: { running: ["longRuns"] },
    });
  });

  it.each([
    null,
    undefined,
    [],
    7,
    "x",
    {},
    record({ code: 7 }),
    record({ code: "aaaaaaaaaaaaaaaa" }),
  ])("gives nothing for %j", (value) => {
    expect(parse(value)).toBeUndefined();
  });

  it("gives nothing for a page with no page code id", () => {
    expect(
      parseNews(
        record(),
        undefined,
        () => true,
        () => true,
      ),
    ).toBeUndefined();
  });

  it.each(["v0.7.0", "0.7", "0.7.0\n", "0.7.0 <b>", 7, undefined])(
    "drops the version %j",
    (server) => {
      expect(parse(record({ server }))).not.toHaveProperty("server");
    },
  );

  it.each([[[]], "x", null, 7])("has no widget part for widgets %j", (widgets) => {
    expect(parse(record({ widgets }))?.widgets).toEqual({});
  });

  it("drops an unknown board, an unknown or non-string name, a duplicate and an empty board", () => {
    const widgets = {
      running: ["longRuns", "longRuns", "nope", 7, null, "workoutTrend"],
      swim: ["records"],
      cycling: ["nope"],
    };
    expect(parse(record({ widgets }))?.widgets).toEqual({
      running: ["longRuns", "workoutTrend"],
    });
  });

  it("keeps a __proto__ board as data, never on the prototype", () => {
    const widgets = JSON.parse('{"__proto__":["longRuns"],"running":["records"]}');
    const r = parse(record({ widgets }));
    expect(r?.widgets).toEqual({ running: ["records"] });
    expect(({} as Record<string, unknown>).longRuns).toBeUndefined();
    const all = parseNews(
      record({ widgets }),
      CODE,
      () => true,
      () => true,
    );
    expect(Object.hasOwn(all?.widgets ?? {}, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(all?.widgets)).toBe(Object.prototype);
  });

  it("keeps at most 32 names for each board", () => {
    const many = Array.from({ length: 40 }, (_, i) => `w${i}`);
    const r = parseNews(
      record({ widgets: { running: many } }),
      CODE,
      () => true,
      () => true,
    );
    expect(r?.widgets.running).toHaveLength(32);
  });
});
