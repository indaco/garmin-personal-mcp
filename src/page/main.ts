import { start } from "./app";
import { connect, inChat } from "./mcp-app";
import { DEFAULT_THEME, store } from "./theme";

if (inChat()) {
  connect(({ settings, ...blocks }) => {
    window.GARMIN = blocks as NonNullable<Window["GARMIN"]>;
    window.GARMIN_SETTINGS = settings;
    // the template chose the theme before the settings came: the same choice again, with them
    const { themes, theme } = settings;
    const saved = store.get("garmin-theme");
    document.documentElement.dataset.theme =
      saved && (!themes || themes.includes(saved))
        ? saved
        : (theme ?? (themes && !themes.includes(DEFAULT_THEME) ? themes[0] : DEFAULT_THEME));
    start();
  });
} else {
  start();
}
