import { describe, expect, it } from "vitest";
import {
  add,
  arrange,
  boardOf,
  type Instance,
  type Layout,
  type Span,
  loneAtTwoColumns,
  merge,
  moveBefore,
  parseLayout,
  remove,
  resetBoard,
  setSpan,
  snapSpan,
  stale,
  storedSpan,
  toggleHidden,
  withBoard,
  withPresetWidgets,
  freeId,
} from "../../src/page/layout";

const preset = (board: string): Instance[] =>
  board === "all"
    ? [
        { id: "kpis", widget: "kpis", span: 3 },
        { id: "hrv", widget: "hrv", span: 1 },
        { id: "notes", widget: "coachNotes", span: 2 },
      ]
    : [];
const layout = (over: Partial<Layout> = {}): Layout => ({
  rev: "r1",
  base: "preset",
  boards: {},
  ...over,
});
const ids = (b: Instance[]) => b.map((i) => i.id);

describe("boards", () => {
  it("uses the preset for a board the layout does not have", () => {
    expect(ids(boardOf(layout(), "all", preset))).toEqual(["kpis", "hrv", "notes"]);
  });

  it("starts empty on a blank layout", () => {
    expect(boardOf(layout({ base: "blank" }), "all", preset)).toEqual([]);
  });

  it("uses the board of the layout when it has one", () => {
    const l = layout({ boards: { all: [{ id: "x", widget: "hrv", span: 2 }] } });
    expect(ids(boardOf(l, "all", preset))).toEqual(["x"]);
  });

  it("sets one board and keeps the others", () => {
    const l = withBoard(layout({ boards: { run: [] } }), "all", [], preset);
    expect(l.boards).toEqual({ run: [], all: [] });
  });
});

describe("seen record", () => {
  const board: Instance[] = [{ id: "hrv", widget: "hrv", span: 1 }];
  const parsed = (seen: unknown, boards: unknown = { all: board }) =>
    parseLayout({ boards, seen }).seen;

  it("keeps a record of a listed board", () => {
    expect(parsed({ all: ["kpis", "hrv"] })).toEqual({ all: ["kpis", "hrv"] });
  });

  it("has no record when the input has none", () => {
    expect(parseLayout({ boards: { all: board } })).not.toHaveProperty("seen");
    expect(parseLayout({ boards: { all: board }, seen: { run: ["x"] } })).not.toHaveProperty(
      "seen",
    );
  });

  it("drops a record of a board that the layout does not list", () => {
    expect(parsed({ all: ["a"], run: ["b"] })).toEqual({ all: ["a"] });
  });

  it("drops a record of a name that is only inherited", () => {
    expect(parsed({ constructor: ["x"], all: ["a"] })).toEqual({ all: ["a"] });
  });

  it("drops a record that is not an object of arrays", () => {
    for (const bad of ["x", 3, null, ["all"], { all: "kpis" }, { all: 5 }, { all: { 0: "a" } }]) {
      expect(parseLayout({ boards: { all: board }, seen: bad })).not.toHaveProperty("seen");
    }
  });

  it("keeps only string names of 64 characters at most, once each", () => {
    const long = "a".repeat(65);
    const edge = "b".repeat(64);
    expect(parsed({ all: ["x", 1, {}, null, long, edge, "x", "y"] })).toEqual({
      all: ["x", edge, "y"],
    });
  });

  it("cuts a record at 32 names", () => {
    const names = Array.from({ length: 40 }, (_, i) => `w${i}`);
    expect(parsed({ all: names })?.all).toEqual(names.slice(0, 32));
  });

  it("reads a __proto__ key as plain data", () => {
    const text =
      '{"boards":{"__proto__":[{"id":"a","widget":"w","span":1}],"all":[]},"seen":{"__proto__":["a"],"all":["b"]}}';
    const result = parseLayout(JSON.parse(text));
    expect(Object.getPrototypeOf(result.boards)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result.seen)).toBe(Object.prototype);
    expect(Object.keys(result.boards)).toEqual(["__proto__", "all"]);
    expect(Object.keys(result.seen ?? {})).toEqual(["__proto__", "all"]);
    expect(Object.prototype).not.toHaveProperty("0");
  });

  it("stamps the preset names the first time it lists a board", () => {
    const l = withBoard(layout(), "all", board, preset);
    expect(l.seen).toEqual({ all: ["kpis", "hrv", "coachNotes"] });
  });

  it("keeps the record of a board that is listed already", () => {
    const l = withBoard(
      layout({ boards: { all: [] }, seen: { all: ["kpis"] } }),
      "all",
      board,
      preset,
    );
    expect(l.seen).toEqual({ all: ["kpis"] });
    const none = withBoard(layout({ boards: { all: [] } }), "all", board, preset);
    expect(none).not.toHaveProperty("seen");
  });

  it("keeps the other records when it stamps", () => {
    const l = withBoard(
      layout({ boards: { run: [] }, seen: { run: ["a"] } }),
      "all",
      board,
      preset,
    );
    expect(l.seen).toEqual({ run: ["a"], all: ["kpis", "hrv", "coachNotes"] });
  });

  it("sets no record on a blank layout", () => {
    expect(withBoard(layout({ base: "blank" }), "all", board, preset)).not.toHaveProperty("seen");
  });

  it("drops the record with the board when it resets the board", () => {
    const l = resetBoard(
      layout({ boards: { all: [], run: [] }, seen: { all: ["a"], run: ["b"] } }),
      "all",
      preset,
    );
    expect(l.seen).toEqual({ run: ["b"] });
  });

  it("drops an empty record when it resets the last board", () => {
    const l = resetBoard(layout({ boards: { all: [] }, seen: { all: ["a"] } }), "all", preset);
    expect(l).not.toHaveProperty("seen");
  });

  it("shows no banner when the layouts differ only in the record", () => {
    const local = layout({ boards: { all: board }, seen: { all: ["hrv"] } });
    const page = layout({ rev: "r2", boards: { all: board } });
    expect(stale(page, { baseRev: "r1", layout: local })).toBeNull();
  });
});

const boardOfIds = (...i: string[]): Instance[] => i.map((id) => ({ id, widget: "w", span: 1 }));

describe("freeId", () => {
  it("gives the widget name, or the name with a number when the id is taken", () => {
    expect(freeId(boardOfIds(), "hrv")).toBe("hrv");
    expect(freeId(boardOfIds("hrv"), "hrv")).toBe("hrv-2");
    expect(freeId(boardOfIds("hrv", "hrv-2"), "hrv")).toBe("hrv-3");
    expect(freeId(boardOfIds("hrv-2"), "hrv")).toBe("hrv");
  });
});

describe("edits", () => {
  const board = preset("all");

  it("sets the column span to 1, 2 or 3", () => {
    expect(setSpan(board, "hrv", 3)[1]).toMatchObject({ id: "hrv", span: 3 });
  });

  it("hides a widget in its place, and a second toggle shows it again", () => {
    const hidden = toggleHidden(board, "hrv");
    expect(hidden[1]).toMatchObject({ id: "hrv", hidden: true });
    expect(toggleHidden(hidden, "hrv")[1]).not.toHaveProperty("hidden");
  });

  it("adds a widget at the end with an id the board does not have", () => {
    const one = add(board, "hrv", { span: 2 });
    expect(one.at(-1)).toEqual({ id: "hrv-2", widget: "hrv", span: 2 });
    expect(add(one, "hrv", {}).at(-1)?.id).toBe("hrv-3");
    expect(add([], "weeklyVolume", { type: "running" })).toEqual([
      { id: "weeklyVolume", widget: "weeklyVolume", type: "running", span: 1 },
    ]);
  });

  it("removes a widget", () => {
    expect(ids(remove(board, "hrv"))).toEqual(["kpis", "notes"]);
  });

  it("resets a board to the preset", () => {
    const l = resetBoard(layout({ boards: { all: [], run: [] } }), "all", preset);
    expect(l.boards).toEqual({ run: [] });
    expect(ids(boardOf(l, "all", preset))).toEqual(["kpis", "hrv", "notes"]);
  });

  it("resets only that board on a blank layout", () => {
    const l = resetBoard(layout({ base: "blank", boards: { all: [] } }), "all", preset);
    expect(l.base).toBe("blank");
    expect(ids(boardOf(l, "all", preset))).toEqual(["kpis", "hrv", "notes"]);
    expect(boardOf(l, "running", (b) => (b === "running" ? board : []))).toEqual([]);
  });

  it("never changes the board it gets", () => {
    const copy = structuredClone(board);
    moveBefore(board, "notes", "kpis");
    setSpan(board, "hrv", 3);
    toggleHidden(board, "hrv");
    add(board, "hrv", {});
    remove(board, "hrv");
    expect(board).toEqual(copy);
  });
});

describe("parseLayout", () => {
  it("keeps a type that is a string, and reads a span that is no number as 1", () => {
    const l = parseLayout({
      boards: { run: [{ id: "a", widget: "kpis", type: "cycling", span: "wide" }] },
    });
    expect(l.boards.run).toEqual([{ id: "a", widget: "kpis", type: "cycling", span: 1 }]);
  });

  it("accepts a valid layout", () => {
    const l = layout({ boards: { all: [{ id: "a", widget: "hrv", span: 2, hidden: true }] } });
    expect(parseLayout(l)).toEqual(l);
  });

  it("gives the preset layout for null, the page default", () => {
    expect(parseLayout(null)).toEqual({ rev: "", base: "preset", boards: {} });
  });

  it("drops entries it cannot use and fixes the span", () => {
    const l = parseLayout({
      rev: 7,
      base: "odd",
      boards: {
        all: [
          { id: "a", widget: "hrv", span: 5 },
          { id: "a", widget: "hrv", span: 1 },
          { widget: "kpis" },
          "text",
          { id: "b", widget: "kpis", type: 3, span: 2 },
        ],
        run: "nope",
      },
    });
    expect(l).toEqual({
      rev: "",
      base: "preset",
      boards: {
        all: [
          { id: "a", widget: "hrv", span: 3 },
          { id: "b", widget: "kpis", span: 2 },
        ],
      },
    });
  });
});

describe("merge", () => {
  const page = layout({ rev: "r1" });
  const mine = layout({ rev: "r1", boards: { all: [] } });

  it("uses the browser's layout while the page layout is the one it started from", () => {
    expect(merge(page, { baseRev: "r1", layout: mine })).toEqual(mine);
  });

  it("uses the page layout when Claude wrote a new one", () => {
    expect(merge(layout({ rev: "r2" }), { baseRev: "r1", layout: mine })).toEqual(
      layout({ rev: "r2" }),
    );
  });

  it("uses the page layout when the browser has none or a broken one", () => {
    expect(merge(page, null)).toEqual(page);
    expect(merge(page, { baseRev: "r1", layout: "broken" })).toEqual(page);
  });
});

describe("stale", () => {
  const mine = layout({ rev: "r1", boards: { all: [{ id: "hrv", widget: "hrv", span: 1 }] } });

  it("gives the browser's layout when Claude wrote a new one that differs", () => {
    expect(stale(layout({ rev: "r2" }), { baseRev: "r1", layout: mine })).toEqual({
      ...mine,
      rev: "r2",
    });
  });

  it("gives nothing while the page layout is the one the browser started from", () => {
    expect(stale(layout({ rev: "r1" }), { baseRev: "r1", layout: mine })).toBeNull();
  });

  it("gives nothing when the new page layout is the same, or the browser has none", () => {
    expect(stale({ ...mine, rev: "r2" }, { baseRev: "r1", layout: mine })).toBeNull();
    expect(stale(layout({ rev: "r2" }), null)).toBeNull();
    expect(stale(layout({ rev: "r2" }), { baseRev: "r1", layout: "broken" })).toBeNull();
  });
});

describe("moveBefore", () => {
  const b: Instance[] = [
    { id: "a", widget: "a", span: 1 },
    { id: "h", widget: "h", span: 1, hidden: true },
    { id: "c", widget: "c", span: 1 },
    { id: "d", widget: "d", span: 1 },
  ];

  it("moves a widget before another, and a hidden one keeps its place", () => {
    expect(ids(moveBefore(b, "d", "c"))).toEqual(["a", "h", "d", "c"]);
    expect(ids(moveBefore(b, "a", "d"))).toEqual(["h", "c", "a", "d"]);
  });

  it("moves to the end with null or an unknown widget, and keeps the board for itself", () => {
    expect(ids(moveBefore(b, "a", null))).toEqual(["h", "c", "d", "a"]);
    expect(ids(moveBefore(b, "a", "nope"))).toEqual(["h", "c", "d", "a"]);
    expect(moveBefore(b, "a", "a")).toBe(b);
    expect(moveBefore(b, "nope", "a")).toBe(b);
  });
});

describe("resize", () => {
  // 3 columns of 400 px with 16 px gaps
  it("snaps a width to the nearest number of columns", () => {
    expect(snapSpan(400, 3, 400, 16)).toBe(1);
    expect(snapSpan(600, 3, 400, 16)).toBe(1);
    expect(snapSpan(640, 3, 400, 16)).toBe(2);
    expect(snapSpan(1232, 3, 400, 16)).toBe(3);
  });

  it("keeps the span inside the minimum and the columns", () => {
    expect(snapSpan(10, 3, 400, 16)).toBe(1);
    expect(snapSpan(10, 3, 400, 16, 2)).toBe(2);
    expect(snapSpan(5000, 2, 400, 16)).toBe(2);
    expect(snapSpan(10, 1, 400, 16, 2)).toBe(1);
  });

  it("keeps a wider saved span for full width on a narrower grid", () => {
    expect(storedSpan(2, 3, 2)).toBe(3);
    expect(storedSpan(2, 1, 2)).toBe(2);
    expect(storedSpan(1, 3, 2)).toBe(1);
    expect(storedSpan(2, 3, 3)).toBe(2);
  });
});

const inst = (widget: string, over: Partial<Instance> = {}): Instance => ({
  id: widget,
  widget,
  span: 1,
  ...over,
});

// the widgets of a page from before the record: "b" is the one that a later release adds
const legacy = (board: string): string[] => (board === "run" ? ["a", "c", "d"] : []);

describe("withPresetWidgets", () => {
  const WANT = ["a", "b", "c", "d"];
  const SPANS: Span[] = [1, 2, 3];
  const want = (board: string): Instance[] =>
    board === "run"
      ? WANT.map((widget, i) => ({ id: widget, widget, span: SPANS[i % 3] ?? 1 }))
      : [{ id: "g", widget: "g", span: 2 }];
  const run = (boards: Record<string, Instance[]>, seen?: Record<string, string[]>) =>
    withPresetWidgets(layout({ boards, ...(seen ? { seen } : {}) }), want, legacy);
  const idsOf = (r: ReturnType<typeof run>, board = "run") => ids(r.layout.boards[board] ?? []);

  it("returns a blank layout as it is", () => {
    const l = layout({ base: "blank", boards: { run: [] } });
    const r = withPresetWidgets(l, want, legacy);
    expect(r).toEqual({ layout: l, added: {}, changed: false });
    expect(r.layout).toBe(l);
  });

  it("adds a new widget after the nearest earlier preset widget, with the preset span", () => {
    const r = run({ run: [inst("a"), inst("x"), inst("c"), inst("d")] });
    expect(idsOf(r)).toEqual(["a", "b", "x", "c", "d"]);
    expect(r.layout.boards.run?.[1]).toEqual({ id: "b", widget: "b", span: 2 });
    expect(r.added).toEqual({ run: ["b"] });
    expect(r.changed).toBe(true);
  });

  it("adds at the end when no earlier preset widget is on the board", () => {
    const r = run({ run: [inst("x"), inst("c"), inst("d")] }, { run: ["c", "d"] });
    expect(idsOf(r)).toEqual(["x", "c", "d", "a", "b"]);
  });

  it("keeps the preset order of two new neighbours", () => {
    const r = run({ run: [inst("a"), inst("x")] }, { run: ["a"] });
    expect(idsOf(r)).toEqual(["a", "b", "c", "d", "x"]);
    expect(r.added).toEqual({ run: ["b", "c", "d"] });
  });

  it("goes after the instance whose id is its widget when the earlier widget is there twice", () => {
    const r = run({ run: [inst("a", { id: "a-2" }), inst("a"), inst("c"), inst("d")] });
    expect(idsOf(r)).toEqual(["a-2", "a", "b", "c", "d"]);
  });

  it("goes after the first instance when none has the id of its widget", () => {
    const r = run({ run: [inst("a", { id: "p" }), inst("a", { id: "q" }), inst("c"), inst("d")] });
    expect(idsOf(r)).toEqual(["p", "b", "q", "c", "d"]);
  });

  it("does not add a widget that is on the board with another type or hidden", () => {
    const r = run({
      run: [inst("a"), inst("b", { type: "cycling" }), inst("c", { hidden: true }), inst("d")],
    });
    expect(r.added).toEqual({});
    expect(r.layout.boards.run?.[2]).toMatchObject({ id: "c", hidden: true });
  });

  it("does not add a widget that the board has met", () => {
    const r = run({ run: [inst("a"), inst("c"), inst("d")] }, { run: ["a", "b", "c", "d"] });
    expect(idsOf(r)).toEqual(["a", "c", "d"]);
    expect(r.added).toEqual({});
    expect(r.changed).toBe(false);
  });

  it("gives a new widget a free id when another widget has the id", () => {
    const r = run({ run: [inst("a"), inst("x", { id: "b" }), inst("c"), inst("d")] });
    expect(idsOf(r)).toEqual(["a", "b-2", "b", "c", "d"]);
    expect(r.layout.boards.run?.[1]).toMatchObject({ widget: "b", id: "b-2" });
    expect(r.layout.boards.run?.[1]).not.toHaveProperty("type");
    expect(r.layout.boards.run?.[1]).not.toHaveProperty("hidden");
  });

  it("sets the record to the preset names in order, and lists only boards with additions", () => {
    const r = run({
      run: [inst("a"), inst("b"), inst("c"), inst("d")],
      other: [inst("g")],
      cold: [inst("z")],
    });
    expect(r.layout.seen).toEqual({ run: WANT, other: ["g"], cold: ["g"] });
    expect(r.added).toEqual({ cold: ["g"] });
    expect(r.changed).toBe(true);
  });

  it("changes only boards, seen and nothing else, and not its input", () => {
    const input = layout({
      rev: "r7",
      base: "preset",
      boards: { run: [inst("a")] },
    });
    const frozen = structuredClone(input);
    Object.freeze(input.boards.run);
    Object.freeze(input.boards);
    Object.freeze(input);
    const r = withPresetWidgets(input, want, legacy);
    expect(input).toEqual(frozen);
    expect(r.layout.rev).toBe("r7");
    expect(r.layout.base).toBe("preset");
    expect(Object.keys(r.layout.boards)).toEqual(["run"]);
  });

  it("reports a changed record when it is the only difference", () => {
    const r = run({ run: [inst("a"), inst("b"), inst("c"), inst("d")] }, { run: ["a", "old"] });
    expect(r.added).toEqual({});
    expect(r.changed).toBe(true);
    expect(r.layout.seen).toEqual({ run: [...WANT, "old"] });
  });

  it("reports no change when the record is equal and nothing is new", () => {
    const l = layout({
      boards: { run: [inst("a"), inst("b"), inst("c"), inst("d")] },
      seen: { run: WANT },
    });
    const r = withPresetWidgets(l, want, legacy);
    expect(r.changed).toBe(false);
    expect(r.layout).toEqual(l);
  });

  it("gives nothing new on a second run", () => {
    const first = run({ run: [inst("a"), inst("x")], other: [] });
    const second = withPresetWidgets(first.layout, want, legacy);
    expect(second.added).toEqual({});
    expect(second.changed).toBe(false);
    expect(second.layout).toEqual(first.layout);
  });

  it("reads a board without a record as the widgets of the baseline", () => {
    // the user removed "c" before the record existed: it must stay removed, "b" is the new one
    const r = run({ run: [inst("a"), inst("d")] });
    expect(idsOf(r)).toEqual(["a", "b", "d"]);
    expect(r.added).toEqual({ run: ["b"] });
    expect(r.layout.seen).toEqual({ run: WANT });
  });

  it("adds nothing to a board without a record when the baseline is the preset", () => {
    const same = withPresetWidgets(layout({ boards: { run: [inst("a")] } }), want, (b) =>
      want(b).map((i) => i.widget),
    );
    expect(same.added).toEqual({});
    expect(same.layout.seen).toEqual({ run: WANT });
  });

  it("goes back past a missing nearest earlier widget to the next one", () => {
    const r = run({ run: [inst("a"), inst("x"), inst("d")] }, { run: ["a", "b", "d"] });
    expect(idsOf(r)).toEqual(["a", "c", "x", "d"]);
  });

  it("keeps a board called __proto__ as plain data", () => {
    const l = parseLayout(JSON.parse('{"boards":{"__proto__":[]}}'));
    const r = withPresetWidgets(l, want, legacy);
    expect(Object.keys(r.layout.boards)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(r.layout.boards)).toBe(Object.prototype);
    expect(Object.keys(r.layout.seen ?? {})).toEqual(["__proto__"]);
    expect(Object.keys(r.added)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(r.added)).toBe(Object.prototype);
  });

  it("uses the generic list for an unknown board name", () => {
    const r = run({ zzz: [] });
    expect(idsOf(r, "zzz")).toEqual(["g"]);
  });
});

const of =
  (...names: string[]) =>
  (board: string): Instance[] =>
    board === "run" ? names.map((widget) => ({ id: widget, widget, span: 1 as Span })) : [];
const none = (): string[] => [];
const P1 = of("a", "b");
const P2 = of("a", "b", "w");
const onBoard = (r: { layout: Layout }) => ids(r.layout.boards.run ?? []);

describe("withPresetWidgets across releases", () => {
  it("keeps a removed widget removed when an older server writes the page between two newer ones", () => {
    const start = layout({
      boards: { run: [inst("a"), inst("b")] },
      seen: { run: ["a", "b", "w"] },
    });
    const older = withPresetWidgets(start, P1, none);
    expect(older.changed).toBe(false);
    const newer = withPresetWidgets(older.layout, P2, none);
    expect(onBoard(newer)).toEqual(["a", "b"]);
    expect(newer.added).toEqual({});
    expect(newer.changed).toBe(false);
  });

  it("keeps a removed widget removed when a preset shrinks and grows again", () => {
    const start = layout({
      boards: { run: [inst("a"), inst("b")] },
      seen: { run: ["a", "b", "w"] },
    });
    const small = withPresetWidgets(start, of("a"), none);
    expect(small.layout.seen).toEqual({ run: ["a", "b", "w"] });
    const grown = withPresetWidgets(small.layout, P2, none);
    expect(onBoard(grown)).toEqual(["a", "b"]);
    expect(grown.added).toEqual({});
  });

  it("puts the current names first, then the earlier ones", () => {
    const r = withPresetWidgets(
      layout({ boards: { run: [inst("a")] }, seen: { run: ["z", "a"] } }),
      of("a", "b"),
      none,
    );
    expect(r.layout.seen).toEqual({ run: ["a", "b", "z"] });
  });

  it("is idempotent, also after a run with an older preset", () => {
    const first = withPresetWidgets(layout({ boards: { run: [inst("a")] } }), P2, none);
    const again = withPresetWidgets(first.layout, P2, none);
    expect(again.changed).toBe(false);
    expect(again.layout).toEqual(first.layout);
    const older = withPresetWidgets(first.layout, P1, none);
    expect(older.changed).toBe(false);
    expect(older.layout).toEqual(first.layout);
    const back = withPresetWidgets(older.layout, P2, none);
    expect(back.changed).toBe(false);
    expect(back.layout).toEqual(first.layout);
  });

  it("keeps a baseline widget of a board without a record in the record", () => {
    const r = withPresetWidgets(layout({ boards: { run: [inst("a")] } }), of("a"), () => ["x"]);
    expect(r.layout.seen).toEqual({ run: ["a", "x"] });
    const later = withPresetWidgets(r.layout, of("a", "x"), none);
    expect(onBoard(later)).toEqual(["a"]);
    expect(later.added).toEqual({});
  });

  it("cuts an old record of 40 names to 32 and keeps the current names", () => {
    const old = Array.from({ length: 40 }, (_, i) => `n${i}`);
    const r = withPresetWidgets(
      layout({ boards: { run: [] }, seen: { run: old } }),
      of("a", "b", "c"),
      none,
    );
    const rec = r.layout.seen?.run ?? [];
    expect(rec).toHaveLength(32);
    expect(rec.slice(0, 3)).toEqual(["a", "b", "c"]);
    expect(rec[3]).toBe("n0");
  });

  it("does not report a change for an older preset that is a subset of the record", () => {
    const r = withPresetWidgets(
      layout({ boards: { run: [inst("a"), inst("b")] }, seen: { run: ["a", "b", "w"] } }),
      P1,
      none,
    );
    expect(r.changed).toBe(false);
    expect(r.layout.seen).toEqual({ run: ["a", "b", "w"] });
  });

  it("is stable when the preset order changes", () => {
    const l = layout({ boards: { run: [inst("a"), inst("b")] }, seen: { run: ["a", "b"] } });
    const first = withPresetWidgets(l, of("b", "a"), none);
    expect(first.changed).toBe(false);
    expect(withPresetWidgets(first.layout, of("b", "a"), none).layout).toEqual(first.layout);
  });

  it("leaves no seen key when no board is listed, so Reset changes nothing", () => {
    const a = withPresetWidgets(
      parseLayout({ rev: "r", base: "preset", boards: {} }),
      preset,
      () => [],
    ).layout;
    expect(a).not.toHaveProperty("seen");
    expect(JSON.stringify(resetBoard(a, "running", preset))).toBe(JSON.stringify(a));
  });

  it("keeps the other boards when Reset runs on an unlisted board", () => {
    const a = withPresetWidgets(
      parseLayout({ rev: "r", base: "preset", boards: { cycling: [] }, seen: { cycling: [] } }),
      preset,
      () => [],
    ).layout;
    expect(a.seen).toHaveProperty("cycling");
    expect(JSON.stringify(resetBoard(a, "running", preset))).toBe(JSON.stringify(a));
  });
});

describe("loneAtTwoColumns", () => {
  it.each<[string, Span[], number[]]>([
    ["no tile", [], []],
    ["one tile of width 1", [1], [0]],
    ["a pair", [1, 1], []],
    ["three of width 1: the last is alone", [1, 1, 1], [2]],
    ["four of width 1", [1, 1, 1, 1], []],
    ["2 then 1: the 2 takes the whole row", [2, 1], [1]],
    ["1 then 2: the 1 is alone before it", [1, 2], [0]],
    ["1 then 3: a 3 is 2 columns wide here", [1, 3], [0]],
    ["2 then 1 then 1: a pair after the wide tile", [2, 1, 1], []],
    ["only wide tiles", [3, 2, 3], []],
    ["the preset of a sport board", [3, 2, 1, 3, 3], [2]],
  ])("%s", (_, spans, lone) => {
    expect(loneAtTwoColumns(spans)).toEqual(lone);
  });
});

const shape = (board: Instance[]) => board.map((i) => `${i.id}:${i.span}`).join(" ");
const placed = (id: string, span: Span, extra: Partial<Instance> = {}): Instance => ({
  id,
  widget: id,
  span,
  ...extra,
});

describe("arrange", () => {
  interface Facts {
    heights?: Record<string, number>;
    zones?: Record<string, number>;
    mins?: Record<string, Span>;
  }
  const run = (board: Instance[], { heights = {}, zones = {}, mins = {} }: Facts = {}) =>
    arrange(board, (i) => ({
      zone: zones[i.id] ?? 0,
      height: heights[i.id] ?? 100,
      min: mins[i.id] ?? 1,
    }));

  it.each<[string, [string, Span][], Facts, string]>([
    ["an empty board", [], {}, ""],
    [
      "width 3 stays alone",
      [
        ["a", 3],
        ["b", 3],
      ],
      {},
      "a:3 b:3",
    ],
    [
      "the wider tile of a pair goes first",
      [
        ["a", 1],
        ["b", 2],
      ],
      {},
      "b:2 a:1",
    ],
    [
      "three narrow tiles fill a row",
      [
        ["a", 1],
        ["b", 1],
        ["c", 1],
      ],
      {},
      "a:1 b:1 c:1",
    ],
    ["a last single narrow tile takes the row", [["a", 1]], {}, "a:3"],
    [
      "a fourth narrow tile takes the next row",
      [
        ["a", 1],
        ["b", 1],
        ["c", 1],
        ["d", 1],
      ],
      {},
      "a:1 b:1 c:1 d:3",
    ],
    [
      "of a last two with one height, the first gets width 2",
      [
        ["a", 1],
        ["b", 1],
      ],
      {},
      "a:2 b:1",
    ],
    [
      "of a last two, the taller gets width 2 and goes first",
      [
        ["a", 1],
        ["b", 1],
      ],
      { heights: { a: 100, b: 200 } },
      "b:2 a:1",
    ],
    [
      "the last two stay in the last row",
      [
        ["a", 1],
        ["b", 1],
        ["c", 1],
        ["d", 1],
        ["e", 1],
      ],
      { heights: { e: 300 } },
      "a:1 b:1 c:1 e:2 d:1",
    ],
    [
      "a two without a partner takes the row, the shorter of two",
      [
        ["a", 2],
        ["b", 2],
        ["c", 1],
      ],
      { heights: { a: 300, b: 100, c: 300 } },
      "a:2 c:1 b:3",
    ],
    [
      "of two wide tiles, the one close to its neighbour keeps the pair",
      [
        ["a", 2],
        ["b", 2],
        ["c", 1],
      ],
      { heights: { a: 300, b: 100, c: 100 } },
      "a:3 b:2 c:1",
    ],
    [
      "a neighbour does not leave another wide tile without its partner",
      [
        ["a", 2],
        ["b", 1],
        ["c", 2],
        ["e", 3],
        ["d", 1],
      ],
      { heights: { a: 100, b: 100, c: 300, d: 300 } },
      "a:2 b:1 c:2 d:1 e:3",
    ],
    [
      "the pairs have the closest heights",
      [
        ["a", 2],
        ["b", 1],
        ["c", 2],
        ["d", 1],
      ],
      { heights: { a: 300, b: 100, c: 100, d: 300 } },
      "a:2 d:1 c:2 b:1",
    ],
    [
      "the tallest narrow tile pairs, the others stay in board order",
      [
        ["a", 2],
        ["b", 1],
        ["c", 1],
        ["d", 1],
        ["e", 1],
      ],
      { heights: { a: 100, b: 10, c: 90, d: 50, e: 40 } },
      "a:2 c:1 b:1 d:1 e:1",
    ],
    [
      "a pair as close as the best one stays",
      [
        ["a", 2],
        ["b", 1],
        ["c", 2],
        ["d", 1],
      ],
      { heights: { a: 10, b: 5, c: 20, d: 5 } },
      "a:2 b:1 c:2 d:1",
    ],
    [
      "a pair closer than the tallest narrow tile stays",
      [
        ["a", 2],
        ["b", 1],
        ["c", 1],
        ["d", 1],
        ["e", 1],
      ],
      { heights: { c: 500 } },
      "a:2 b:1 c:1 d:1 e:1",
    ],
    [
      "rows keep the board order of their earliest tile",
      [
        ["a", 3],
        ["b", 2],
        ["c", 3],
        ["d", 1],
      ],
      {},
      "a:3 b:2 d:1 c:3",
    ],
    [
      "zones go in order and never share a row",
      [
        ["a", 1],
        ["b", 1],
        ["c", 3],
      ],
      { zones: { a: 5, b: 0, c: 1 } },
      "b:3 c:3 a:3",
    ],
    [
      "a stored width never shrinks",
      [
        ["a", 3],
        ["b", 1],
      ],
      {},
      "a:3 b:3",
    ],
    [
      "a stored 1 with min 2 counts as 2",
      [
        ["a", 1],
        ["b", 1],
      ],
      { mins: { b: 2 } },
      "b:2 a:1",
    ],
    ["a stored 1 with min 3 counts as 3", [["a", 1]], { mins: { a: 3 } }, "a:3"],
  ])("%s", (_name, tiles, facts, want) => {
    expect(
      shape(
        run(
          tiles.map(([id, span]) => placed(id, span)),
          facts,
        ),
      ),
    ).toBe(want);
  });

  it("puts hidden widgets after the shown ones, unchanged", () => {
    const hidden = placed("h", 1, { hidden: true });
    expect(run([hidden, placed("a", 2), placed("b", 1)])).toEqual([
      placed("a", 2),
      placed("b", 1),
      hidden,
    ]);
  });

  it("sees a pair across a hidden widget", () => {
    const board = [
      placed("a", 2),
      placed("h", 1, { hidden: true }),
      placed("b", 1),
      placed("c", 2),
      placed("d", 1),
    ];
    const heights = { a: 10, b: 5, c: 20, d: 5 };
    expect(shape(run(board, { heights }))).toBe("a:2 b:1 c:2 d:1 h:1");
  });

  it("keeps the other fields and each instance of one widget", () => {
    const board: Instance[] = [
      { id: "activities", widget: "activities", type: "running", span: 3 },
      { id: "activities-2", widget: "activities", type: "cycling", span: 3 },
    ];
    expect(run(board)).toEqual(board);
  });

  it("does not change the board it gets", () => {
    const board = [placed("a", 1), placed("b", 1)];
    run(board);
    expect(board).toEqual([placed("a", 1), placed("b", 1)]);
  });

  // each of these moved a tile again on the second press of a first version of the rule
  it.each<[string, [string, Span][], Record<string, number>]>([
    [
      "narrow tiles of one height, one in a pair",
      [
        ["s", 1],
        ["x", 1],
        ["y", 1],
        ["q", 1],
        ["t", 2],
      ],
      { s: 1, x: 10, y: 10, q: 1, t: 10 },
    ],
    [
      "narrow tiles of one height in two pairs",
      [
        ["t2", 2],
        ["b", 1],
        ["a", 1],
        ["t1", 2],
      ],
      { t2: 20, b: 10, a: 10, t1: 30 },
    ],
    [
      "wide tiles of one height in two pairs",
      [
        ["p2", 1],
        ["t1", 2],
        ["p1", 1],
        ["t2", 2],
      ],
      { p2: 5, t1: 20, p1: 50, t2: 20 },
    ],
    [
      "a tile that got width 2 is taller than the first pair",
      [
        ["t", 2],
        ["x", 1],
        ["y", 1],
        ["z", 1],
      ],
      { t: 10, x: 100, y: 50, z: 5 },
    ],
    [
      "only narrow tiles",
      [
        ["a", 1],
        ["b", 1],
        ["c", 1],
        ["d", 1],
        ["e", 1],
      ],
      { e: 300 },
    ],
    [
      "two without a partner",
      [
        ["a", 2],
        ["b", 2],
        ["c", 1],
      ],
      { a: 300, b: 100, c: 300 },
    ],
  ])("gives the same board on a second press: %s", (_name, tiles, heights) => {
    const once = run(
      tiles.map(([id, span]) => placed(id, span)),
      { heights },
    );
    expect(run(once, { heights })).toEqual(once);
  });
});
