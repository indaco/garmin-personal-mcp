import { arrowKeys, selectTab } from "./tabs";

/** The client tabs of "start in three steps": one pane at a time. */
export function clients(): void {
  const list = document.querySelector<HTMLElement>(".clients");
  if (!list) return;
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
