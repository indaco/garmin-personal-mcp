import type { Key } from "./i18n";

/** The themes of the menu, in groups. Their colours are CSS tokens in styles.css. */
export const THEMES: { id: string; group: "auto" | "dark" | "light" | "accessible" }[] = [
  { id: "system", group: "auto" },
  { id: "midnight", group: "dark" },
  { id: "graphite", group: "dark" },
  { id: "ocean", group: "dark" },
  { id: "forest", group: "dark" },
  { id: "plum", group: "dark" },
  { id: "light", group: "light" },
  { id: "paper", group: "light" },
  { id: "mist", group: "light" },
  { id: "hcDark", group: "accessible" },
  { id: "hcLight", group: "accessible" },
];
export const DEFAULT_THEME = "midnight";

export const themeKey = (id: string) => `theme.${id}` as Key;

/** Local storage that never throws: a blocked storage only loses the choice. */
export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // storage blocked: the choice lasts for this visit only
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // storage blocked: nothing was saved
    }
  },
};

/** The value of a theme token (`--text`, `--running`...) as the page shows it now. */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}
