/** What the last refresh changed, as far as the page can trust it. */
export interface News {
  readonly code: string;
  readonly server?: string;
  readonly widgets: Readonly<Record<string, readonly string[]>>;
}

const MAX_NAMES = 32;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The refresh record of the page file, which anyone can edit: a field of the wrong type is dropped.
 * The record counts only for the page code that it names. The predicates keep this module free of
 * the DOM and the widget registry.
 */
export function parseNews(
  value: unknown,
  code: string | undefined,
  isBoard: (board: string) => boolean,
  isWidget: (name: string) => boolean,
): News | undefined {
  if (!isObject(value) || code === undefined || value.code !== code) return undefined;
  const { server, widgets } = value;
  const boards = isObject(widgets)
    ? Object.entries(widgets).flatMap(([board, list]) => {
        if (!isBoard(board) || !Array.isArray(list)) return [];
        const kept = [
          ...new Set(list.filter((n): n is string => typeof n === "string" && isWidget(n))),
        ].slice(0, MAX_NAMES);
        return kept.length > 0 ? [[board, kept] as const] : [];
      })
    : [];
  return {
    code,
    ...(typeof server === "string" && /^\d+\.\d+\.\d+$/.test(server) ? { server } : {}),
    // fromEntries defines own keys, so a board called __proto__ stays data
    widgets: Object.fromEntries(boards),
  };
}
