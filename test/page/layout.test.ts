import { describe, expect, it } from "vitest";
import {
  add,
  boardOf,
  type Instance,
  type Layout,
  merge,
  move,
  parseLayout,
  remove,
  resetBoard,
  setSpan,
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

  it("moves a widget to another place", () => {
    expect(ids(move(board, "notes", 0))).toEqual(["notes", "kpis", "hrv"]);
    expect(ids(move(board, "kpis", 2))).toEqual(["hrv", "notes", "kpis"]);
    // out of range stays inside the board
    expect(ids(move(board, "kpis", 9))).toEqual(["hrv", "notes", "kpis"]);
    expect(ids(move(board, "missing", 0))).toEqual(ids(board));
  });

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
    expect(add([], "weeklyVolume", { type: "run" })).toEqual([
      { id: "weeklyVolume", widget: "weeklyVolume", type: "run", span: 1 },
    ]);
  });

  it("removes a widget", () => {
    expect(ids(remove(board, "hrv"))).toEqual(["kpis", "notes"]);
  });

  it("resets a board to the preset", () => {
    const l = resetBoard(layout({ boards: { all: [], run: [] } }), "all");
    expect(l.boards).toEqual({ run: [] });
    expect(ids(boardOf(l, "all", preset))).toEqual(["kpis", "hrv", "notes"]);
  });

  it("never changes the board it gets", () => {
    const copy = structuredClone(board);
    move(board, "notes", 0);
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
