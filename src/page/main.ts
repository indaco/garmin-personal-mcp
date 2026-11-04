import { start } from "./app";
import { h } from "./dom";
import { en } from "./i18n/en";
import { connect, inChat } from "./mcp-app";
import { DEFAULT_THEME, store } from "./theme";

if (inChat()) {
  connect(
    ({ settings, ...blocks }) => {
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
    },
    (reason) => {
      // in English: the other languages come with the data of a good result
      document
        .getElementById("app")!
        .replaceChildren(
          h("main", { class: "page" }, h("p", { class: "error" }, en["chat.failed"], " ", reason)),
        );
    },
  );
} else {
  start();
}
