/** The view in the URL hash, e.g. `#running@2026-09-07_2026-10-26` or `#strengthTraining/back-squat`, so a link opens it again. */
export interface View {
  tab: string;
  /** Monday of the first and of the last week of the window. */
  from: string;
  to: string;
  /** An item the tab opens, such as a strength exercise. */
  item?: string;
}

export function parseHash(hash: string, tabs: string[], weeks: string[]): View {
  const m =
    /^#?([a-zA-Z]+)?(?:@(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2}))?(?:\/(.+))?$/.exec(hash) ?? [];
  const [, tab, from, to, item] = m;
  const window =
    from && to && from <= to && weeks.includes(from) && weeks.includes(to)
      ? { from, to }
      : { from: weeks[0], to: weeks.at(-1)! };
  return {
    tab: tab && tabs.includes(tab) ? tab : "all",
    ...window,
    ...(item ? { item: decodeURIComponent(item) } : {}),
  };
}

export function formatHash(v: View): string {
  return `#${v.tab}@${v.from}_${v.to}${v.item ? `/${encodeURIComponent(v.item)}` : ""}`;
}
