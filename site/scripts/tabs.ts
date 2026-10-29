/** Tabs: only the selected tab is a Tab stop. */
export function selectTab(tab: HTMLElement, on: boolean): void {
  tab.setAttribute("aria-selected", String(on));
  tab.tabIndex = on ? 0 : -1;
}

/** The arrow keys, Home and End move between the tabs of a tab list and activate the new tab. */
export function arrowKeys(list: HTMLElement, activate: (tab: HTMLElement) => void): void {
  list.addEventListener("keydown", (e) => {
    const all = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = ({ ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: all.length - 1 } as const)[
      e.key as "ArrowRight" | "ArrowLeft" | "Home" | "End"
    ];
    if (at < 0 || next === undefined) return;
    e.preventDefault();
    const tab = all[(next + all.length) % all.length]!;
    tab.focus();
    activate(tab);
  });
}
