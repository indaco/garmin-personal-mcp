import { describe, expect, it } from "vitest";
import {
  add,
  boardOf,
  type Instance,
  type Layout,
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
    const l = withBoard(layout({ boards: { run: [] } }), "all", []);
    expect(l.boards).toEqual({ run: [], all: [] });
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
