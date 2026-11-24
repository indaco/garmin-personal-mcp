import type { Key } from "./i18n";
import type { Settings } from "./settings";

/** The themes of the menu, in groups. Their colours are CSS tokens in styles.css. */
export const THEMES: { id: string; group: "auto" | "dark" | "light" | "accessible" }[] = [
  { id: "system", group: "auto" },
  { id: "midnight", group: "dark" },
  { id: "graphite", group: "dark" },
  { id: "ocean", group: "dark" },
  { id: "forest", group: "dark" },
  { id: "plum", group: "dark" },
  { id: "munichDark", group: "dark" },
  { id: "light", group: "light" },
  { id: "paper", group: "light" },
  { id: "mist", group: "light" },
  { id: "munich", group: "light" },
  { id: "hcDark", group: "accessible" },
  { id: "hcLight", group: "accessible" },
];
export const DEFAULT_THEME = "midnight";

/** The theme that the page opens with: the saved one when the page has it, else the one of the settings. */
export function openingTheme({ themes, theme }: Settings, saved: string | null): string {
  if (saved && (!themes || themes.includes(saved))) return saved;
  return theme ?? (themes && !themes.includes(DEFAULT_THEME) ? themes[0] : DEFAULT_THEME);
}

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
