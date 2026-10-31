import { arrowKeys, selectTab } from "./tabs";

/** Tab lists with a pane per tab (the clients of "start", the dashboard views): one pane at a time. */
export function panes(): void {
  for (const list of document.querySelectorAll<HTMLElement>(".panes")) tabPanes(list);
}

function tabPanes(list: HTMLElement): void {
  const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
  for (const t of tabs) {
    t.tabIndex = t.getAttribute("aria-selected") === "true" ? 0 : -1;
    t.addEventListener("click", () => {
      for (const o of tabs) {
        selectTab(o, o === t);
        const pane = document.getElementById(o.getAttribute("aria-controls") ?? "");
        if (pane) pane.hidden = o !== t;
      }
    });
  }
  arrowKeys(list, (t) => t.click());
}
