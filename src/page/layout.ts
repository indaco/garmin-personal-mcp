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
  const boards: Record<string, Instance[]> = {};
  for (const [name, list] of Object.entries(isObject(o.boards) ? o.boards : {})) {
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    boards[name] = [];
    for (const item of list) {
      if (!isObject(item) || typeof item.id !== "string" || typeof item.widget !== "string")
        continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const span = Math.min(3, Math.max(1, Math.round(Number(item.span) || 1))) as Span;
      boards[name].push({
        id: item.id,
        widget: item.widget,
        ...(typeof item.type === "string" ? { type: item.type } : {}),
        span,
        ...(item.hidden === true ? { hidden: true } : {}),
      });
    }
  }
  const seen = parseSeen(o.seen, boards);
  return {
    rev: typeof o.rev === "string" ? o.rev : "",
    base: o.base === "blank" ? "blank" : "preset",
    boards,
    ...(seen ? { seen } : {}),
  };
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
 * nearest earlier preset widget on the board, with the preset width. The record then holds the
 * current preset names. Running it again changes nothing, so the page and the server can both run it.
 */
export function withPresetWidgets(
  layout: Layout,
  preset: (board: string) => Instance[],
): { layout: Layout; added: Record<string, string[]>; changed: boolean } {
  if (layout.base === "blank") return { layout, added: {}, changed: false };
  const boards: Record<string, Instance[]> = {};
  const seen: Record<string, readonly string[]> = { ...layout.seen };
  const added: Record<string, string[]> = {};
  let changed = false;
  for (const [name, list] of Object.entries(layout.boards)) {
    const want = preset(name);
    const met = new Set(Object.hasOwn(seen, name) ? seen[name] : []);
    let next = list;
    for (const [at, w] of want.entries()) {
      if (met.has(w.widget) || next.some((i) => i.widget === w.widget)) continue;
      const fresh: Instance = { id: freeId(next, w.widget), widget: w.widget, span: w.span };
      next = insertAfterPrevious(next, want.slice(0, at), fresh);
      (added[name] ??= []).push(fresh.id);
      changed = true;
    }
    boards[name] = next;
    const names = want.map((i) => i.widget);
    if (JSON.stringify(seen[name]) !== JSON.stringify(names)) changed = true;
    seen[name] = names;
  }
  return { layout: { ...layout, boards, seen }, added, changed };
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
