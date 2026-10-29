/** The view in the URL hash, e.g. `#running@2026-09-07_2026-10-26~Tempo%205k` or `#strengthTraining/back-squat`, so a link opens it again. */
export interface View {
  tab: string;
  /** Monday of the first and of the last week of the window. */
  from: string;
  to: string;
  /** The activity names that the boards show; none shows all. */
  names?: string[];
  /** An item the tab opens, such as a strength exercise. */
  item?: string;
}

/** The decoded item; undefined for text that is not valid URI encoding, such as a cut link. */
function itemOf(item: string | undefined): string | undefined {
  try {
    return item ? decodeURIComponent(item) : undefined;
  } catch {
    return undefined;
  }
}

export function parseHash(hash: string, tabs: string[], weeks: string[]): View {
  const m =
    /^#?([a-zA-Z]+)?(?:@(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2}))?(?:~([^/]*))?(?:\/(.+))?$/.exec(
      hash,
    ) ?? [];
  const [, tab, from, to, list, item] = m;
  const decoded = itemOf(item);
  const names = (list ?? "").split(",").flatMap((n) => itemOf(n) ?? []);
  const window =
    from && to && from <= to && weeks.includes(from) && weeks.includes(to)
      ? { from, to }
      : { from: weeks[0], to: weeks.at(-1)! };
  return {
    tab: tab && tabs.includes(tab) ? tab : "all",
    ...window,
    ...(names.length > 0 ? { names } : {}),
    ...(decoded !== undefined ? { item: decoded } : {}),
  };
}

export function formatHash(v: View): string {
  const names = v.names?.length ? `~${v.names.map(encodeURIComponent).join(",")}` : "";
  return `#${v.tab}@${v.from}_${v.to}${names}${v.item ? `/${encodeURIComponent(v.item)}` : ""}`;
}
