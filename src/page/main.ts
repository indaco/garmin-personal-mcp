import { start } from "./app";
import { h } from "./dom";
import { en } from "./i18n/en";
import { connect, inChat } from "./mcp-app";

if (inChat()) {
  connect(
    ({ settings, ...blocks }) => {
      window.GARMIN = blocks as NonNullable<Window["GARMIN"]>;
      window.GARMIN_SETTINGS = settings;
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
