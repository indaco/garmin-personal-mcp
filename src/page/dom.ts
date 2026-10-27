type Child = Node | string | number | false | null | undefined;

/** An element with attributes and children. `on*` attributes that are functions become listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false || value === null) continue;
    if (name.startsWith("on") && typeof value === "function") {
      el.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
    } else if (name === "class") {
      el.className = String(value);
    } else {
      el.setAttribute(name, value === true ? "" : String(value));
    }
  }
  append(el, ...children);
  return el;
}

const FOCUSABLE = "button, select, input, textarea, a[href], summary, [tabindex]";

/** The focusable elements of a tile, or of the page part (header, main, footer) outside the tiles. */
function controls(scope: Element): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => scope.matches("[data-id]") || !el.closest("[data-id]"),
  );
}

function scopeOf(el: Element): Element | null {
  return el.closest("[data-id]") ?? el.closest("#app > * > *");
}

/**
 * Runs a redraw and puts focus back on the same control: by id, else by its place among the
 * controls of its tile or page part. A disabled control gives the nearest enabled one; a tile that
 * is gone gives the tile now in its place.
 */
export function keepFocus(redraw: () => void): void {
  const el = document.activeElement;
  const scope = el instanceof HTMLElement && el !== document.body ? scopeOf(el) : null;
  if (!el || !scope) return redraw();
  const id = el.id;
  const tileId = (scope as HTMLElement).dataset.id;
  const part = tileId === undefined ? [...scope.parentElement!.children].indexOf(scope) : -1;
  const tileAt = tileId === undefined ? -1 : [...document.querySelectorAll(".tile")].indexOf(scope);
  const index = controls(scope).indexOf(el as HTMLElement);
  redraw();
  if (index < 0) return;
  if (el.isConnected || (document.activeElement && document.activeElement !== document.body)) {
    return; // the control was not redrawn, or the redraw moved focus itself
  }
  if (id) return document.getElementById(id)?.focus();
  const now =
    tileId === undefined
      ? document.querySelector("#app > *")?.children[part]
      : (document.querySelector(`[data-id="${CSS.escape(tileId)}"]`) ??
        document.querySelectorAll(".tile")[
          Math.min(tileAt, document.querySelectorAll(".tile").length - 1)
        ]);
  if (!now) return;
  const list = controls(now);
  const usable = (n: number) => list[n] && !list[n].matches(":disabled");
  // the same place, else the nearest one before or after it
  for (let d = 0; d < list.length; d++) {
    for (const n of [index - d, index + d]) {
      if (usable(n)) return list[n].focus();
    }
  }
}

/** Says a short text to screen readers, through one polite live region outside the page. */
export function announce(text: string): void {
  let region = document.getElementById("announce");
  if (!region) {
    region = h("div", { id: "announce", class: "sr-only", "aria-live": "polite" });
    document.body.append(region);
  }
  region.textContent = text;
}

export function append(el: Element, ...children: Child[]): void {
  for (const c of children) {
    if (c === false || c === null || c === undefined) continue;
    el.append(typeof c === "number" ? String(c) : c);
  }
}
