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

export function append(el: Element, ...children: Child[]): void {
  for (const c of children) {
    if (c === false || c === null || c === undefined) continue;
    el.append(typeof c === "number" ? String(c) : c);
  }
}
