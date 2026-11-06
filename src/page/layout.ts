/**
 * The widget layout: one board per tab, each an ordered list of widget instances. Pure functions only;
 * each edit returns a new board, so the page can save, compare and undo layouts.
 */

export type Span = 1 | 2 | 3;

export interface Instance {
  id: string;
  widget: string;
  /** The activity type the widget shows; without it, the type of its board. */
  type?: string;
  span: Span;
  hidden?: boolean;
}

export interface Layout {
  /** Changes each time the server writes a layout; a browser edit applies only to the rev it started from. */
  rev: string;
  /** What a board that the layout does not list shows: the preset widgets, or nothing. */
  base: "preset" | "blank";
  boards: Record<string, Instance[]>;
  /** For each listed board, the preset widgets it has met: the merge never adds them again. */
  seen?: Record<string, readonly string[]>;
}

/** Longest `seen` record of one board; the largest preset is smaller. */
const MAX_SEEN = 32;
const MAX_NAME = 64;

/** A layout edited in this browser, with the rev of the page layout it started from. */
export interface LocalLayout {
  baseRev: string;
  layout: unknown;
}

export function boardOf(
  layout: Layout,
  board: string,
  preset: (board: string) => Instance[],
): Instance[] {
  return layout.boards[board] ?? (layout.base === "blank" ? [] : preset(board));
}

/**
 * Sets one board. The first time a board of a preset layout is listed, it has met every preset
 * widget, so a widget that the user removes in this edit is not added back later.
 */
export function withBoard(
  layout: Layout,
  board: string,
  instances: Instance[],
  preset: (board: string) => Instance[],
): Layout {
  const next = { ...layout, boards: { ...layout.boards, [board]: instances } };
  if (layout.base === "blank" || Object.hasOwn(layout.boards, board)) return next;
  return { ...next, seen: { ...layout.seen, [board]: presetNames(preset, board) } };
}

/** The board shows its preset again; the other boards keep what they show. */
export function resetBoard(
  layout: Layout,
  board: string,
  preset: (board: string) => Instance[],
): Layout {
  // a blank layout shows an unlisted board empty, so the preset is stored for this board only
  if (layout.base === "blank") return withBoard(layout, board, preset(board), preset);
  const { [board]: _, ...boards } = layout.boards;
  const { [board]: __, ...seen } = layout.seen ?? {};
  const { seen: ___, ...rest } = layout;
  return { ...rest, boards, ...(Object.keys(seen).length > 0 ? { seen } : {}) };
}

/**
 * Moves a widget before another one, or to the end with null. The page moves widgets among the
 * shown ones; a hidden widget keeps its place between them.
 */
export function moveBefore(board: Instance[], id: string, before: string | null): Instance[] {
  const item = board.find((i) => i.id === id);
  if (!item || before === id) return board;
  const next = board.filter((i) => i.id !== id);
  const at = before === null ? -1 : next.findIndex((i) => i.id === before);
  next.splice(at < 0 ? next.length : at, 0, item);
  return next;
}

/** The columns a tile spans when its right edge is `width` px from its left edge, snapped. */
export function snapSpan(
  width: number,
  cols: number,
  colWidth: number,
  gap: number,
  min = 1,
): number {
  const n = Math.round((width + gap) / (colWidth + gap));
  return Math.max(1, Math.min(cols, Math.max(min, n)));
}

/**
 * The span to save for a resize to `target` on a grid of `cols` columns. Full width on a narrower
 * grid keeps a wider saved span, so a resize on a tablet does not shrink the desktop layout.
 */
export function storedSpan(target: number, old: Span, cols: number): Span {
  return (target === cols ? Math.max(old, target) : target) as Span;
}

/**
 * The places in this list of tile widths whose tile has no neighbour on a grid of 2 columns: it leaves
 * a gap beside it, so the page shows it wider there.
 */
export function loneAtTwoColumns(spans: Span[]): number[] {
  const lone: number[] = [];
  let open = -1;
  for (const [at, span] of spans.entries()) {
    if (span > 1) {
      if (open >= 0) lone.push(open);
      open = -1;
    } else if (open >= 0) {
      open = -1;
    } else {
      open = at;
    }
  }
  if (open >= 0) lone.push(open);
  return lone;
}

interface Tile {
  item: Instance;
  span: Span;
  height: number;
  /** The place among the shown tiles of the board. */
  at: number;
}
type Pair = [wide: Tile, narrow: Tile];

const gapOf = (pairs: Pair[]) =>
  pairs.reduce((sum, [a, b]) => sum + Math.abs(a.height - b.height), 0);
const tallestFirst = (list: Tile[]) => list.toSorted((a, b) => b.height - a.height);

/** The tiles of one zone in full rows; each row is in the board order of its earliest tile. */
function fullRows(tiles: Tile[]): Tile[][] {
  const wide = tiles.filter((x) => x.span === 2);
  const narrow = tiles.filter((x) => x.span === 1);
  const tallNarrow = tallestFirst(narrow);
  const best = tallestFirst(wide)
    .slice(0, narrow.length)
    .map((x, n): Pair => [x, tallNarrow[n]]);
  const neighbours = wide.flatMap((x): Pair[] => {
    const next = narrow.find((y) => y.at === x.at + 1);
    return next ? [[x, next]] : [];
  });
  // pairs as close as the best ones stay: tiles of one height would swap on each press otherwise
  const pairs =
    neighbours.length === best.length && gapOf(neighbours) <= gapOf(best) ? neighbours : best;
  const paired = new Set(pairs.flat());
  const rest = narrow.filter((x) => !paired.has(x));
  if (rest.length % 3 === 2) {
    const [a, b] = rest.slice(-2);
    const [tall, low] = b.height > a.height ? [b, a] : [a, b];
    // the new pair can change the best pairs, and the next press would see it
    return fullRows(
      tiles.map((x) => {
        if (x === a) return { ...tall, span: 2, at: a.at };
        return x === b ? { ...low, at: b.at } : x;
      }),
    );
  }
  const threes = Array.from({ length: Math.floor(rest.length / 3) }, (_, n) =>
    rest.slice(n * 3, n * 3 + 3),
  );
  const alone = [
    ...wide.filter((x) => !paired.has(x)),
    ...(rest.length % 3 === 1 ? rest.slice(-1) : []),
    ...tiles.filter((x) => x.span === 3),
  ];
  const first = (row: Tile[]) => Math.min(...row.map((x) => x.at));
  return [...pairs, ...threes, ...alone.map((x): Tile[] => [{ ...x, span: 3 }])].toSorted(
    (a, b) => first(a) - first(b),
  );
}

/**
 * The board in full rows: by zone first, so zones never share a row, and with the closest heights
 * side by side. A width only grows, so a widget stays as wide as it needs. Hidden widgets go last.
 */
export function arrange(
  board: Instance[],
  info: (i: Instance) => { zone: number; height: number; min: Span },
): Instance[] {
  const shown = board
    .filter((i) => !i.hidden)
    .map((item, at) => {
      const { zone, height, min } = info(item);
      return { item, zone, height, at, span: Math.max(item.span, min) as Span };
    });
  const zones = [...new Set(shown.map((x) => x.zone))].toSorted((a, b) => a - b);
  return [
    ...zones.flatMap((zone) =>
      fullRows(shown.filter((x) => x.zone === zone))
        .flat()
        .map((x) => ({ ...x.item, span: x.span })),
    ),
    ...board.filter((i) => i.hidden),
  ];
}

export function setSpan(board: Instance[], id: string, span: Span): Instance[] {
  return board.map((i) => (i.id === id ? { ...i, span } : i));
}

export function toggleHidden(board: Instance[], id: string): Instance[] {
  return board.map((i) => {
    if (i.id !== id) return i;
    const { hidden, ...shown } = i;
    return hidden ? shown : { ...i, hidden: true };
  });
}

/** A new instance at the end. Its id is the widget name, with a number when the board has it already. */
export function add(
  board: Instance[],
  widget: string,
  { type, span = 1 }: { type?: string; span?: Span },
): Instance[] {
  return [...board, { id: freeId(board, widget), widget, ...(type ? { type } : {}), span }];
}

/** The widget name as an id, with a number when the board has that id already. */
export function freeId(board: Instance[], widget: string): string {
  const taken = new Set(board.map((i) => i.id));
  let id = widget;
  for (let n = 2; taken.has(id); n++) id = `${widget}-${n}`;
  return id;
}

export function remove(board: Instance[], id: string): Instance[] {
  return board.filter((i) => i.id !== id);
}

/** A layout from untrusted JSON (the page block, local storage, a pasted text): what cannot be used is dropped. */
export function parseLayout(v: unknown): Layout {
  const o = isObject(v) ? v : {};
  // fromEntries defines own keys, so a __proto__ board is data and never sets a prototype
  const boards: Record<string, Instance[]> = Object.fromEntries(
    Object.entries(isObject(o.boards) ? o.boards : {}).flatMap(([name, list]) =>
      Array.isArray(list) ? [[name, parseBoard(list)] as const] : [],
    ),
  );
  const seen = parseSeen(o.seen, boards);
  return {
    rev: typeof o.rev === "string" ? o.rev : "",
    base: o.base === "blank" ? "blank" : "preset",
    boards,
    ...(seen ? { seen } : {}),
  };
}

function parseBoard(list: unknown[]): Instance[] {
  const ids = new Set<string>();
  const board: Instance[] = [];
  for (const item of list) {
    if (!isObject(item) || typeof item.id !== "string" || typeof item.widget !== "string") continue;
    if (ids.has(item.id)) continue;
    ids.add(item.id);
    const span = Math.min(3, Math.max(1, Math.round(Number(item.span) || 1))) as Span;
    board.push({
      id: item.id,
      widget: item.widget,
      ...(typeof item.type === "string" ? { type: item.type } : {}),
      span,
      ...(item.hidden === true ? { hidden: true } : {}),
    });
  }
  return board;
}

function parseSeen(
  v: unknown,
  boards: Record<string, Instance[]>,
): Record<string, readonly string[]> | undefined {
  if (!isObject(v)) return undefined;
  const entries = Object.entries(v).flatMap(([board, names]) =>
    Object.hasOwn(boards, board) && Array.isArray(names) ? [[board, namesOf(names)] as const] : [],
  );
  // fromEntries defines own keys, so a __proto__ key is data and never sets a prototype
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function namesOf(names: unknown[]): string[] {
  const ok = names.filter((n): n is string => typeof n === "string" && n.length <= MAX_NAME);
  return [...new Set(ok)].slice(0, MAX_SEEN);
}

function presetNames(preset: (board: string) => Instance[], board: string): string[] {
  return preset(board).map((i) => i.widget);
}

/**
 * Gives each listed board of a preset layout the preset widgets that it has not met: after the
 * nearest earlier preset widget on the board, with the preset width. A board without a record has met
 * the `baseline` widgets. The record then holds the
 * current preset names first, then the earlier ones. Running it again changes nothing, so the page and the server can both run it.
 */
export function withPresetWidgets(
  layout: Layout,
  preset: (board: string) => Instance[],
  baseline: (board: string) => string[],
): { layout: Layout; added: Record<string, string[]>; changed: boolean } {
  if (layout.base === "blank") return { layout, added: {}, changed: false };
  const old = layout.seen ?? {};
  const results = Object.entries(layout.boards).map(([name, list]) => {
    const want = preset(name);
    const names = want.map((i) => i.widget);
    const had = Object.hasOwn(old, name) ? old[name] : undefined;
    // a board without a record is from before the record: it has met the baseline, not nothing
    const earlier = had ?? baseline(name);
    const met = new Set(earlier);
    const ids: string[] = [];
    let next = list;
    for (const [at, w] of want.entries()) {
      if (met.has(w.widget) || next.some((i) => i.widget === w.widget)) continue;
      const fresh: Instance = { id: freeId(next, w.widget), widget: w.widget, span: w.span };
      next = insertAfterPrevious(next, want.slice(0, at), fresh);
      ids.push(fresh.id);
    }
    // the names stay in the record when a preset drops them: an older server can write the page, and a removed widget must not come back
    const record = [...names, ...earlier.filter((n) => !names.includes(n))].slice(0, MAX_SEEN);
    const recordChanged = had === undefined || names.some((n) => !had.includes(n));
    return { name, next, record, ids, changed: ids.length > 0 || recordChanged };
  });
  // fromEntries defines own keys, so a board called __proto__ stays data
  const boards = Object.fromEntries(results.map((r) => [r.name, r.next]));
  const seen = Object.fromEntries([
    ...Object.entries(old),
    ...results.map((r) => [r.name, r.record] as const),
  ]);
  const added = Object.fromEntries(
    results.filter((r) => r.ids.length > 0).map((r) => [r.name, r.ids]),
  );
  const { seen: _, ...rest } = layout;
  return {
    layout: { ...rest, boards, ...(Object.keys(seen).length > 0 ? { seen } : {}) },
    added,
    changed: results.some((r) => r.changed),
  };
}

/** After the first instance of the nearest earlier preset widget on the board; at the end if none. */
function insertAfterPrevious(board: Instance[], earlier: Instance[], item: Instance): Instance[] {
  for (const e of earlier.toReversed()) {
    const own = board.findIndex((i) => i.id === e.widget && i.widget === e.widget);
    const at = own >= 0 ? own : board.findIndex((i) => i.widget === e.widget);
    if (at >= 0) return board.toSpliced(at + 1, 0, item);
  }
  return [...board, item];
}

/** The browser's layout while the page still has the layout it started from; otherwise the page layout. */
export function merge(page: Layout, local: LocalLayout | null): Layout {
  if (!local || local.baseRev !== page.rev || !isObject(local.layout)) return page;
  return { ...parseLayout(local.layout), rev: page.rev };
}

/**
 * The browser's layout when Claude wrote a new page layout after it, and the two differ; null
 * otherwise. The page shows the new layout and asks which one to keep.
 */
export function stale(page: Layout, local: LocalLayout | null): Layout | null {
  if (!local || local.baseRev === page.rev || !isObject(local.layout)) return null;
  const mine = { ...parseLayout(local.layout), rev: page.rev };
  // the record is no choice of the user, so a difference in it alone shows no banner
  const { seen: _, ...theirs } = page;
  const { seen: __, ...own } = mine;
  return JSON.stringify(own) === JSON.stringify(theirs) ? null : mine;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
