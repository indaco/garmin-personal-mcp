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
}

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

export function withBoard(layout: Layout, board: string, instances: Instance[]): Layout {
  return { ...layout, boards: { ...layout.boards, [board]: instances } };
}

/** The board shows its preset again; the other boards keep what they show. */
export function resetBoard(
  layout: Layout,
  board: string,
  preset: (board: string) => Instance[],
): Layout {
  // a blank layout shows an unlisted board empty, so the preset is stored for this board only
  if (layout.base === "blank") return withBoard(layout, board, preset(board));
  const { [board]: _, ...boards } = layout.boards;
  return { ...layout, boards };
}

export function move(board: Instance[], id: string, to: number): Instance[] {
  const from = board.findIndex((i) => i.id === id);
  if (from < 0) return board;
  const next = board.filter((i) => i.id !== id);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, board[from]);
  return next;
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
  const taken = new Set(board.map((i) => i.id));
  let id = widget;
  for (let n = 2; taken.has(id); n++) id = `${widget}-${n}`;
  return [...board, { id, widget, ...(type ? { type } : {}), span }];
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
  return {
    rev: typeof o.rev === "string" ? o.rev : "",
    base: o.base === "blank" ? "blank" : "preset",
    boards,
  };
}

/** The browser's layout while the page still has the layout it started from; otherwise the page layout. */
export function merge(page: Layout, local: LocalLayout | null): Layout {
  if (!local || local.baseRev !== page.rev || !isObject(local.layout)) return page;
  return { ...parseLayout(local.layout), rev: page.rev };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
