import { h } from "./dom";
import { snapSpan } from "./layout";

/**
 * Edit mode on the grid: drag a tile by its grip (mouse, pen or touch), move it with the keyboard, and
 * resize it by its right edge. These functions change only the page; the callbacks save the result.
 */

const isTile = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLElement && el.classList.contains("tile") && !el.classList.contains("lifted");

const tilesOf = (grid: Element) => [...grid.children].filter(isTile);

export const spanOf = (tile: HTMLElement) => Number(/span-(\d)/.exec(tile.className)?.[1] ?? 1);

const setSpanClass = (tile: HTMLElement, span: number) => {
  tile.className = tile.className.replace(/span-\d/, `span-${span}`);
};

/** The id of the first tile after `el`, or null at the end of the grid. */
function nextId(el: Element): string | null {
  let n = el.nextElementSibling;
  while (n && !isTile(n)) n = n.nextElementSibling;
  return n?.dataset.id ?? null;
}

/** Runs a change of the grid and slides each tile from its old place to its new one. */
function flip(grid: Element, change: () => void): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return change();
  const els = [...grid.children].filter(
    (c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains("lifted"),
  );
  const before = new Map(els.map((el) => [el, el.getBoundingClientRect()]));
  change();
  for (const el of els) {
    const a = before.get(el)!;
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (dx || dy) {
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: 150,
        easing: "ease-out",
      });
    }
  }
}

/**
 * Drags a tile by its grip. The tile follows the pointer, a slot shows where it lands, the other tiles
 * move aside, and the page scrolls near the top or the bottom. Escape puts it back.
 */
export function dragTile(
  e: PointerEvent,
  grip: HTMLElement,
  drop: (before: string | null) => void,
): void {
  const tile = grip.closest<HTMLElement>(".tile");
  const grid = tile?.parentElement;
  if (e.button !== 0 || !tile || !grid) return;
  e.preventDefault();
  grip.setPointerCapture(e.pointerId);
  const r = tile.getBoundingClientRect();
  const dx = e.clientX - r.left;
  const dy = e.clientY - r.top;
  const start = nextId(tile);
  const slot = h("div", {
    class: `tile-slot span-${spanOf(tile)}`,
    "aria-hidden": "true",
    style: `height:${r.height}px`,
  });
  tile.before(slot);
  tile.style.width = `${r.width}px`;
  tile.style.height = `${r.height}px`;
  tile.classList.add("lifted");
  document.documentElement.classList.add("dragging");
  let x = e.clientX;
  let y = e.clientY;

  const place = () => {
    tile.style.transform = `translate(${x - dx}px, ${y - dy}px) scale(1.02)`;
    const over = document.elementFromPoint(x, y)?.closest<HTMLElement>(".tile");
    if (!over || over === tile || over.parentElement !== grid) return;
    const o = over.getBoundingClientRect();
    // a tile that fills the row: its top half is before it; otherwise its left half
    const after =
      o.width > grid.clientWidth * 0.9 ? y > o.top + o.height / 2 : x > o.left + o.width / 2;
    const ref = after ? over.nextElementSibling : over;
    if (ref === slot || slot.nextElementSibling === ref) return;
    flip(grid, () => grid.insertBefore(slot, ref));
  };
  // near an edge of the window the page scrolls, faster closer to the edge
  let frame = 0;
  const scroll = () => {
    const top = (document.querySelector(".edit-bar")?.getBoundingClientRect().bottom ?? 0) + 60;
    const bottom = innerHeight - 60;
    const step = y < top ? -(top - y) / 3 : y > bottom ? (y - bottom) / 3 : 0;
    if (step) {
      scrollBy(0, Math.max(-20, Math.min(20, step)));
      place();
    }
    frame = requestAnimationFrame(scroll);
  };
  frame = requestAnimationFrame(scroll);

  const move = (ev: PointerEvent) => {
    x = ev.clientX;
    y = ev.clientY;
    place();
  };
  const finish = (ok: boolean) => {
    cancelAnimationFrame(frame);
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", up);
    grip.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", esc, true);
    const before = nextId(slot);
    slot.remove();
    tile.classList.remove("lifted");
    tile.style.removeProperty("width");
    tile.style.removeProperty("height");
    tile.style.removeProperty("transform");
    document.documentElement.classList.remove("dragging");
    if (ok && before !== start) drop(before);
  };
  const up = () => finish(true);
  const cancel = () => finish(false);
  const esc = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopImmediatePropagation(); // Escape here cancels the drag, not edit mode
    finish(false);
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", up);
  grip.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", esc, true);
  place();
}

export interface KeyMove {
  /** The tile was picked up, or moved: its place among the shown tiles. */
  picked(n: number, count: number): void;
  moved(n: number, count: number): void;
  /** Space or Enter again: the tile goes before this tile, or to the end with null. */
  drop(before: string | null): void;
  /** Escape or Tab: the tile goes back. */
  cancel(): void;
}

/**
 * The keyboard way to move a tile, from its grip: Space or Enter picks it up, the arrow keys, Home and
 * End move it, Space or Enter drops it, Escape puts it back.
 */
export function keyMove(e: KeyboardEvent, grip: HTMLElement, on: KeyMove): void {
  const tile = grip.closest<HTMLElement>(".tile");
  const grid = tile?.parentElement;
  if (!tile || !grid) return;
  const list = tilesOf(grid);
  const i = list.indexOf(tile);
  const pick = e.key === " " || e.key === "Enter";
  if (!tile.classList.contains("picked")) {
    if (!pick) return;
    e.preventDefault();
    tile.classList.add("picked");
    grip.setAttribute("aria-pressed", "true");
    on.picked(i + 1, list.length);
    return;
  }
  const steps: Record<string, number> = {
    ArrowLeft: i - 1,
    ArrowUp: i - 1,
    ArrowRight: i + 1,
    ArrowDown: i + 1,
    Home: 0,
    End: list.length - 1,
  };
  if (e.key in steps) {
    e.preventDefault();
    const j = Math.max(0, Math.min(list.length - 1, steps[e.key]));
    if (j === i) return;
    flip(grid, () => grid.insertBefore(tile, j < i ? list[j] : list[j].nextElementSibling));
    grip.focus(); // moving the node takes the focus away
    on.moved(j + 1, list.length);
  } else if (pick) {
    e.preventDefault();
    on.drop(nextId(tile));
  } else if (e.key === "Escape" || e.key === "Tab") {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // Escape here puts the tile back, it does not leave edit mode
    }
    on.cancel();
  }
}

/** The columns of the grid now, the width of one, and the gap between them. */
export function gridColumns(grid: Element): { cols: number; width: number; gap: number } {
  const cs = getComputedStyle(grid);
  const cols = cs.gridTemplateColumns.split(" ").length;
  const gap = Number.parseFloat(cs.columnGap) || 0;
  return { cols, width: (grid.clientWidth - gap * (cols - 1)) / cols, gap };
}

/**
 * Resizes a tile by the handle on its right edge: the width snaps to the columns, with guides for the
 * columns and a badge for the span. Escape puts it back.
 */
export function resizeTile(
  e: PointerEvent,
  handle: HTMLElement,
  min: number,
  commit: (span: number, cols: number) => void,
): void {
  const tile = handle.closest<HTMLElement>(".tile");
  const grid = tile?.parentElement;
  if (e.button !== 0 || !tile || !grid) return;
  e.preventDefault();
  handle.setPointerCapture(e.pointerId);
  const { cols, width, gap } = gridColumns(grid);
  const left = tile.getBoundingClientRect().left;
  const old = spanOf(tile);
  const first = Math.min(old, cols);
  let span = first;
  const guides = h(
    "div",
    { class: "guides", "aria-hidden": "true" },
    ...Array.from({ length: cols }, () => h("div", {})),
  );
  guides.style.gridTemplateColumns = getComputedStyle(grid).gridTemplateColumns;
  guides.style.columnGap = `${gap}px`;
  const badge = h("span", { class: "span-badge", "aria-hidden": "true" });
  const show = () => {
    setSpanClass(tile, span);
    badge.textContent = `${span} / ${cols}`;
    guides.style.top = `${tile.offsetTop}px`;
    guides.style.height = `${tile.offsetHeight}px`;
  };
  grid.append(guides);
  tile.append(badge);
  handle.classList.add("active");
  document.documentElement.classList.add("resizing");
  show();

  const move = (ev: PointerEvent) => {
    const next = snapSpan(ev.clientX - left, cols, width, gap, min);
    if (next !== span) {
      span = next;
      show();
    }
  };
  const finish = (ok: boolean) => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", esc, true);
    guides.remove();
    badge.remove();
    handle.classList.remove("active");
    document.documentElement.classList.remove("resizing");
    if (ok && span !== first) commit(span, cols);
    else setSpanClass(tile, old);
  };
  const up = () => finish(true);
  const cancel = () => finish(false);
  const esc = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    finish(false);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", esc, true);
}
