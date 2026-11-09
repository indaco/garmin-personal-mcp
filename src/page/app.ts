import * as calc from "../analytics/calc";
import * as metrics from "../analytics/metrics";
import * as running from "../analytics/running";
import * as strength from "../analytics/strength";
import * as sports from "../analytics/sports";
import {
  type Activity,
  activitiesIn,
  GROUPS,
  groupOf,
  isLate,
  named,
  weeksOf,
} from "../analytics/calc";
import { Chart, chart, destroyCharts, themeCharts } from "./charts";
import { announce, h, keepFocus } from "./dom";
import { dragTile, keyMove, resizeTile } from "./edit-drag";
import { icon, logo } from "./icons";
import { screen, toggleFullscreen } from "./mcp-app";
import {
  addLanguages,
  CATALOGUES,
  formatter,
  type Key,
  LANGUAGE_NAMES,
  pickLang,
  type T,
  translator,
  languageName,
  widgetText,
} from "./i18n";
import {
  add,
  arrange,
  arrangeTip,
  better,
  boardOf,
  drawnRows,
  type Instance,
  type Layout,
  type LocalLayout,
  loneAtTwoColumns,
  merge,
  moveBefore,
  parseLayout,
  remove,
  resetBoard,
  setSpan,
  type Span,
  stale,
  storedSpan,
  toggleHidden,
  withBoard,
  withPresetWidgets,
} from "./layout";
import { type News, parseNews } from "./news";
import { baseline, preset } from "./presets";
import {
  allWidgets,
  type Ctx,
  type Data,
  registerCustom,
  widget,
  type WidgetDef,
  withheld,
  withhold,
} from "./registry";
import type { Settings } from "./settings";
import { formatHash, parseHash, type View } from "./state";
import { typeName } from "./widgets/ui";
import { DEFAULT_THEME, store, THEMES, themeKey, token } from "./theme";
import "./widgets";

declare global {
  interface Window {
    /** The page blocks, set by the inline script that the server fills. */
    GARMIN?: {
      data: Data | null;
      layout: unknown;
      widgets: unknown;
      languages?: unknown;
      i18n?: unknown;
      refresh?: unknown;
    };
    /** The page settings, set by the first script of the page. */
    GARMIN_SETTINGS?: Settings | null;
    Chart?: typeof Chart;
  }
}

/** The server writes the notes HTML-escaped (pages that Claude designs show them as HTML); widgets get plain text. */
const plain = (s: string) =>
  new DOMParser().parseFromString(s, "text/html").documentElement.textContent ?? "";
const LAYOUT_KEY = `garmin-layout:${location.pathname}`;

// read in start(): in the chat (an MCP App) the blocks arrive after the script runs
let G: NonNullable<Window["GARMIN"]>;
let S: Settings;
let langChoice: string;
let lang = "en";
let t: T = translator("en");
let fmt = formatter("en");
let pageLayout: Layout;
let layout: Layout;
// the browser's layout, kept until you choose it or the new one that Claude wrote
let mine: Layout | null;
let view: View;
let editing = false;
// edit mode works on a copy: Done saves it, Discard drops it
let draft: Layout | null = null;
/** The tip of the last Auto-arrange press, for its board; any other edit drops it. `failed`: Swap was tried and kept nothing. */
let tip: { tab: string; swap: [string, string]; board: Instance[]; failed?: true } | undefined;
// the swaps that Swap tried and kept nothing, until edit mode ends: a press does not suggest them again
let refused = new Set<string>();
const swapKey = (tab: string, a: string, b: string) => JSON.stringify([tab, a, b]);
let accountOpen = false;
// on a phone the week window folds into one control
let windowOpen = false;
/** The observer of the tab bar: a redraw makes a new bar, and the old bar must not stay in memory. */
let tabBarObserver: ResizeObserver | undefined;
/** The observer of the bar that sticks to the top: a redraw makes a new bar. */
let stickyObserver: ResizeObserver | undefined;

/** Keyboard focus scrolls below the sticky bar, whatever its height: it wraps with the language and the width. */
function watchStickyBar(bar: HTMLElement): void {
  stickyObserver?.disconnect();
  stickyObserver = new ResizeObserver(() => {
    const sticks = getComputedStyle(bar).position === "sticky";
    document.documentElement.style.setProperty(
      "--sticky-h",
      sticks ? `${bar.offsetHeight + 8}px` : "0px",
    );
  });
  stickyObserver.observe(bar);
}
let tabs: string[] = [];
let weeks: string[] = [];
// the refresh record when this browser has not closed it yet
let news: News | undefined;
// closed in this tab: storage may be blocked
let newsClosed = false;

export function start(): void {
  G = window.GARMIN ?? { data: null, layout: null, widgets: [] };
  if (G.data?.notes) G.data.notes = G.data.notes.map(plain);
  S = window.GARMIN_SETTINGS ?? {};
  langChoice = store.get("garmin-lang") ?? S.language ?? "auto";
  pageLayout = parseLayout(G.layout);
  const local = readLocal();
  // runs on load and saves nothing: the merge repeats the same way, and Done saves it with its record
  layout = withPresetWidgets(merge(pageLayout, local), preset, baseline).layout;
  const old = stale(pageLayout, local);
  mine = old && withPresetWidgets(old, preset, baseline).layout;
  screen.redraw = render;
  window.Chart = Chart; // for custom widgets and the page tests
  addLanguages(G.languages);
  addLanguages(G.i18n);
  // English stays in the script for missing texts, but a page can leave it out of the menu
  if (S.languages && !S.languages.includes("en")) delete LANGUAGE_NAMES.en;
  withhold(S);
  for (const w of Array.isArray(G.widgets) ? G.widgets : []) {
    const def = compile(w);
    if (def) registerCustom(def);
  }
  // without a choice, the page opens in the language of the Garmin profile when it has it
  const own = G.data?.locale ?? "";
  setLanguage(
    store.get("garmin-lang") ??
      S.language ??
      [own, own.slice(0, 2)].find((code) => code in LANGUAGE_NAMES) ??
      "auto",
  );
  const data = G.data;
  if (data) {
    tabs = calc.tabsFor(data.activities, S);
    weeks = weeksOf(data.start, data.end);
  }
  // after withhold, the custom widgets and the tabs: they say which widgets and boards the page shows
  news = readNews();
  view = parseHash(location.hash, tabs, weeks);
  window.addEventListener("hashchange", () => {
    view = parseHash(location.hash, tabs, weeks);
    render();
  });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => render());
  // the account menu closes on a click outside it or on Escape
  document.addEventListener("click", (e) => {
    const menu = document.querySelector<HTMLDetailsElement>(".account[open]");
    if (menu && !menu.contains(e.target as Node)) menu.open = false;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const menu = document.querySelector<HTMLDetailsElement>(".account[open]");
    if (menu) {
      menu.open = false;
      menu.querySelector("summary")!.focus();
    } else if (editing && !document.querySelector("dialog[open]")) {
      e.preventDefault(); // else the same key closes the dialog that discard opens
      discard();
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (dirty()) e.preventDefault();
  });
  // and when focus leaves it, so an open panel never covers the control that has focus
  document.addEventListener("focusin", (e) => {
    const menu = document.querySelector<HTMLDetailsElement>(".account[open]");
    if (menu && !menu.contains(e.target as Node)) menu.open = false;
  });
  announce("");
  render();
}

function setLanguage(choice: string): void {
  langChoice = choice;
  lang = pickLang(choice, navigator.languages ?? [navigator.language]);
  // a language the page does not offer (English left out) gives its first language
  if (!(lang in LANGUAGE_NAMES)) lang = Object.keys(LANGUAGE_NAMES)[0];
  t = translator(lang);
  fmt = formatter(lang, G.data?.units);
  document.documentElement.lang = lang;
}

function render(): void {
  const app = document.getElementById("app")!;
  destroyCharts();
  themeCharts(lang);
  document.title = pageTitle();
  if (!G.data) {
    app.replaceChildren(
      h("main", { class: "page" }, h("h1", {}, pageTitle()), h("p", {}, t("noData")), footer()),
    );
    return;
  }
  try {
    history.replaceState(null, "", formatHash(view));
  } catch {
    // a frame without a URL of its own (an MCP App in a srcdoc frame): the view is not in the address
  }
  // a theme or language change renders again; the account menu stays as it was
  accountOpen = document.querySelector(".account[open]") !== null;
  const data = G.data;
  const top = header(data);
  const edit = editing && editBar();
  keepFocus(() =>
    app.replaceChildren(
      h(
        "div",
        { class: "page" },
        h(
          "a",
          {
            class: "skip",
            href: "#board",
            // the hash is the view: a fragment jump would reset the tab and the window
            onclick: (e: Event) => {
              e.preventDefault();
              document.getElementById("board")?.focus();
            },
          },
          t("skip"),
        ),
        top,
        edit,
        boardView(data),
        footer(data),
      ),
    ),
  );
  watchStickyBar(edit || top);
}

// ------------------------------------------------------------------ footer

const REPO = "https://github.com/indaco/garmin-personal-mcp";
const SITE = "https://garmin-personal-mcp.indaco.dev";
// the Highlights of each release, for readers who do not use GitHub
const WHATS_NEW = `${SITE}/whats-new.html`;

/** When the server wrote the page, in the viewer's time zone; an older page has only the date. */
function writtenAt(data: Data): string | undefined {
  const at = new Date(data.updated ?? "");
  if (Number.isNaN(at.getTime())) return data.generated && fmt.longDay(data.generated);
  return new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(at);
}

/**
 * Where the data comes from and when it was written, the days that Garmin did not give (their values
 * show n/a), then the project, the server version that wrote the page, and the license.
 */
function footer(data?: Data): HTMLElement {
  const written = data && writtenAt(data);
  const failed = Number(data?.sync?.failedDays) || 0;
  // the server that wrote the page last, with its entry on What's new
  const version = /^\d+\.\d+\.\d+$/.test(data?.server ?? "") ? data!.server : undefined;
  return h(
    "footer",
    { class: "foot" },
    data &&
      h(
        "div",
        { class: "source" },
        // no date in the data, no date in the footer
        written && h("p", {}, t("footer.updated", { date: written })),
        failed > 0 && h("p", { class: "gap" }, t("footer.failed", { n: failed })),
      ),
    h(
      "p",
      { class: "made" },
      h("a", { class: "brand", href: SITE }, logo(), "garmin-personal-mcp"),
      "·",
      version &&
        h(
          "a",
          { href: `${WHATS_NEW}#v${version.replaceAll(".", "-")}`, rel: "noopener" },
          `v${version}`,
        ),
      version && "·",
      h("a", { href: `${REPO}/blob/main/LICENSE`, rel: "noopener" }, t("footer.license")),
    ),
  );
}

// ------------------------------------------------------------------ header

/** The title of the settings, else the title in the page language. */
const pageTitle = () => S.title ?? t("title");

function header(data: Data): HTMLElement {
  const inProgress = new Date(`${data.end}T00:00:00Z`).getUTCDay() !== 0;
  return h(
    "header",
    { class: "top" },
    h(
      "div",
      { class: "title-row" },
      h(
        "div",
        { class: "title" },
        logo(),
        h(
          "div",
          {},
          h("h1", {}, pageTitle()),
          h("h2", { class: "headline" }, S.headline ?? t("headline")),
          h(
            "p",
            { class: "muted" },
            t("period", { from: fmt.longDay(data.start), to: fmt.longDay(data.end) }),
          ),
        ),
      ),
      h("div", { class: "menus" }, screen.offered && screenButton(), accountMenu()),
    ),
    windowBar(inProgress),
    namesBar(data),
    tabBar(data),
  );
}

/** Full screen in the chat, when the host offers it; the page file never shows it. */
function screenButton(): HTMLElement {
  const label = t(screen.full ? "chat.exitFullscreen" : "chat.fullscreen");
  return h(
    "button",
    {
      type: "button",
      class: "screen-mode",
      "aria-label": label,
      title: label,
      onclick: () => void toggleFullscreen(),
    },
    icon(screen.full ? "collapse" : "expand"),
  );
}

function accountMenu(): HTMLElement {
  return h(
    "details",
    { class: "account", open: accountOpen },
    h("summary", { "aria-label": t("menu.settings"), title: t("menu.settings") }, icon("settings")),
    // the page settings: the layout first, then the choices of this browser
    h(
      "div",
      { class: "account-panel" },
      !editing && editButton(),
      !editing && h("hr", { class: "menu-sep" }),
      // one language needs no menu
      Object.keys(LANGUAGE_NAMES).length > 1 && languageMenu(),
      missingLanguage(),
      shownThemes().length > 1 && themeMenu(),
    ),
  );
}

function languageMenu(): HTMLElement {
  const select = h(
    "select",
    {
      id: "lang",
      onchange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        store.set("garmin-lang", v);
        setLanguage(v);
        render();
      },
    },
    h("option", { value: "auto", selected: langChoice === "auto" }, t("lang.auto")),
    ...Object.entries(LANGUAGE_NAMES).map(([code, name]) =>
      h("option", { value: code, lang: code, selected: langChoice === code }, name),
    ),
  );
  return h("label", { class: "menu" }, h("span", {}, t("menu.language")), select);
}

/** A note when the page has no texts in the language of the Garmin profile, by its own name. */
function missingLanguage(): HTMLElement | false {
  const own = G.data?.locale ?? "";
  if (!own || [own, own.slice(0, 2)].some((code) => code in CATALOGUES)) return false;
  return h(
    "p",
    { class: "muted small menu-note" },
    t("lang.missing", { language: languageName(own) }),
  );
}

/** The themes of the page: the ones the settings keep. */
const shownThemes = () => THEMES.filter((x) => !S.themes || S.themes.includes(x.id));

function themeMenu(): HTMLElement {
  const current = document.documentElement.dataset.theme ?? DEFAULT_THEME;
  const themes = shownThemes();
  const groups = (["auto", "dark", "light", "accessible"] as const).filter((g) =>
    themes.some((x) => x.group === g),
  );
  const select = h(
    "select",
    {
      id: "theme",
      onchange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        document.documentElement.dataset.theme = v;
        store.set("garmin-theme", v);
        render();
      },
    },
    ...groups.map((g) =>
      h(
        "optgroup",
        { label: t(`themeGroup.${g}` as Key) },
        ...themes
          .filter((x) => x.group === g)
          .map((x) => h("option", { value: x.id, selected: x.id === current }, t(themeKey(x.id)))),
      ),
    ),
  );
  return h("label", { class: "menu" }, h("span", {}, t("menu.theme")), select);
}

function editButton(): HTMLElement {
  return h("button", { class: "btn edit-start", onclick: startEdit }, t("edit.start"));
}

function startEdit(): void {
  // the settings menu closes: render keeps it as it finds it
  document.querySelector<HTMLDetailsElement>(".account[open]")?.removeAttribute("open");
  editing = true;
  draft = layout;
  render();
  document.querySelector<HTMLElement>(".edit-bar .btn")?.focus();
}

/** Edit mode has changes that Done would save. */
function dirty(): boolean {
  return draft !== null && JSON.stringify(draft) !== JSON.stringify(layout);
}

/** Leaves edit mode; focus goes back to the settings menu, where Edit layout is. */
function leaveEdit(): void {
  editing = false;
  draft = null;
  tip = undefined;
  refused = new Set();
  render();
  document.querySelector<HTMLElement>(".account summary")?.focus();
}

function done(): void {
  const changed = dirty();
  if (changed) setLayout(draft!);
  leaveEdit();
  announce(t(changed ? "said.saved" : "said.unchanged"));
}

/** Drops the changes of edit mode; asks first when there are any. */
function discard(): void {
  if (!dirty()) return leaveEdit();
  const keep = h("button", { class: "btn" }, t("discard.keep"));
  const drop = h("button", { class: "btn primary" }, t("discard.confirm"));
  const d = dialog(
    t("discard.title"),
    h("p", {}, t("discard.text")),
    h("div", { class: "dialog-actions" }, keep, drop),
  );
  keep.addEventListener("click", () => d.close());
  drop.addEventListener("click", () => {
    d.close();
    leaveEdit();
    announce(t("said.discarded"));
  });
  keep.focus();
}

function windowBar(inProgress: boolean): HTMLElement {
  const setWindow = (from: string, to: string) => {
    view = { ...view, from, to };
    render();
  };
  const presets = [4, 8, 12].filter((n) => n < weeks.length);
  const isLast = (n: number) => view.to === weeks.at(-1) && view.from === weeks[weeks.length - n];
  const label = (w: string, i: number) =>
    `${fmt.day(w)}${inProgress && i === weeks.length - 1 ? " *" : ""}`;
  const select = (id: string, value: string, onChange: (v: string) => void) =>
    h(
      "select",
      { id, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
      ...weeks.map((w, i) => h("option", { value: w, selected: w === value }, label(w, i))),
    );
  const shown = presets.find(isLast);
  const current =
    shown !== undefined
      ? t("window.last", { n: shown })
      : view.from === weeks[0] && view.to === weeks.at(-1)
        ? t("window.all")
        : `${fmt.day(view.from)} – ${fmt.day(view.to)}`;
  const toggle = h(
    "button",
    {
      class: "chip window-toggle",
      "aria-expanded": String(windowOpen),
      "aria-controls": "window-bar",
      onclick: () => {
        windowOpen = !windowOpen;
        render();
      },
    },
    `${t("window.label")}: ${current}`,
    h("span", { "aria-hidden": "true" }, " ▾"),
  );
  const bar = h(
    "div",
    {
      id: "window-bar",
      class: `window-bar${windowOpen ? " open" : ""}`,
      role: "group",
      "aria-label": t("window.label"),
    },
    ...presets.map((n) =>
      h(
        "button",
        {
          class: "chip",
          "aria-pressed": String(isLast(n)),
          onclick: () => setWindow(weeks[weeks.length - n], weeks.at(-1)!),
        },
        t("window.last", { n }),
      ),
    ),
    h(
      "button",
      {
        class: "chip",
        "aria-pressed": String(view.from === weeks[0] && view.to === weeks.at(-1)),
        onclick: () => setWindow(weeks[0], weeks.at(-1)!),
      },
      t("window.all"),
    ),
    h(
      "label",
      { class: "menu" },
      h("span", {}, t("window.from")),
      select("from", view.from, (v) => setWindow(v, v > view.to ? v : view.to)),
    ),
    h(
      "label",
      { class: "menu" },
      h("span", {}, t("window.to")),
      select("to", view.to, (v) => setWindow(v < view.from ? v : view.from, v)),
    ),
    inProgress && h("span", { class: "muted small" }, t("inProgress")),
  );
  return h("div", { class: "window" }, toggle, bar);
}

/** The activity names to show, e.g. the sessions of a training plan; none shows every activity. */
function namesBar(data: Data): HTMLElement | false {
  const names = namesOf(data);
  if (names.length === 0) return false;
  const chosen = view.names ?? [];
  return h(
    "div",
    { class: "names" },
    h(
      "button",
      {
        class: "chip names-open",
        "aria-haspopup": "dialog",
        "aria-pressed": String(chosen.length > 0),
        onclick: () => namesDialog(data),
      },
      `${t("names.label")}: ${chosen.length > 0 ? t("names.count", { n: chosen.length }) : t("names.all")}`,
      h("span", { "aria-hidden": "true" }, " ▾"),
    ),
    ...chosen.map((name) =>
      h(
        "button",
        {
          class: "chip small",
          "aria-label": t("names.remove", { name }),
          onclick: () => setNames(chosen.filter((x) => x !== name)),
        },
        name,
        h("span", { "aria-hidden": "true" }, "✕"),
      ),
    ),
  );
}

function setNames(names: string[]): void {
  view = { ...view, names };
  render();
}

/** The names of the window on the current board with their counts, the most frequent first; a chosen name stays, so it can be taken off. */
function namesOf(data: Data): [string, number][] {
  const inWindow = activitiesIn(data.activities, view.from, view.to);
  const onTab =
    view.tab === "all" || view.tab === "recovery"
      ? inWindow
      : inWindow.filter((a) => groupOf(a) === view.tab);
  const counts = new Map<string, number>();
  for (const a of onTab) if (a.name) counts.set(a.name, (counts.get(a.name) ?? 0) + 1);
  for (const n of view.names ?? []) if (!counts.has(n)) counts.set(n, 0);
  return [...counts].toSorted((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], lang));
}

/** A search and a check box for each name: with many names, the list scrolls and the search finds one. */
function namesDialog(data: Data): void {
  const list = h("ul", { class: "catalogue" });
  const search = h("input", {
    type: "search",
    class: "catalogue-search",
    placeholder: t("names.search"),
    "aria-label": t("names.search"),
    autofocus: true,
    oninput: () => {
      const q = findText(search.value.trim());
      const items = [...list.querySelectorAll<HTMLElement>("li[data-find]")];
      for (const li of items) li.hidden = !li.dataset.find!.includes(q);
      noMatch.hidden = items.some((li) => !li.hidden);
    },
  });
  const boxes = namesOf(data).map(([name, n]) => {
    const box = h("input", {
      type: "checkbox",
      value: name,
      checked: view.names?.includes(name) ?? false,
      // the page behind the dialog follows each change
      onchange: () => setNames(boxes.filter((b) => b.checked).map((b) => b.value)),
    });
    list.append(
      h(
        "li",
        { "data-find": findText(name) },
        h("label", { class: "check" }, box, h("span", {}, name)),
        h("span", { class: "count" }, n),
      ),
    );
    return box;
  });
  const noMatch = h("li", { class: "muted", hidden: true }, t("names.noMatch"));
  list.append(noMatch);
  const clear = h(
    "button",
    {
      class: "btn",
      onclick: () => {
        for (const b of boxes) b.checked = false;
        setNames([]);
      },
    },
    t("names.clear"),
  );
  const finish = h("button", { class: "btn primary" }, t("edit.done"));
  const d = dialog(
    t("names.label"),
    search,
    list,
    h("div", { class: "dialog-actions" }, clear, finish),
  );
  finish.addEventListener("click", () => d.close());
}

function tabBar(data: Data): HTMLElement {
  const inWindow = named(activitiesIn(data.activities, view.from, view.to), view.names);
  const count = (tab: string) =>
    tab === "all" ? inWindow.length : inWindow.filter((a) => groupOf(a) === tab).length;
  const select = (tab: string) => {
    view = { tab, from: view.from, to: view.to, names: view.names };
    render();
    document.querySelector<HTMLElement>(`[role=tab][data-tab="${tab}"]`)?.focus();
  };
  const nav = h(
    "nav",
    {
      class: "tabs",
      role: "tablist",
      "aria-label": t("tabs.label"),
      onkeydown: (e: KeyboardEvent) => {
        const i = tabs.indexOf(view.tab);
        if (e.key === "ArrowRight") select(tabs[(i + 1) % tabs.length]);
        else if (e.key === "ArrowLeft") select(tabs[(i - 1 + tabs.length) % tabs.length]);
        else if (e.key === "Home") select(tabs[0]);
        else if (e.key === "End") select(tabs.at(-1)!);
        else return;
        e.preventDefault();
      },
    },
    ...tabs.map((tab) =>
      h(
        "button",
        {
          role: "tab",
          id: `tab-${tab}`,
          "aria-controls": "board",
          "data-tab": tab,
          "aria-selected": String(tab === view.tab),
          tabindex: tab === view.tab ? "0" : "-1",
          class: `tab tab-${tab}`,
          onclick: () => select(tab),
        },
        icon(tab),
        h("span", {}, typeName(t, tab)),
        tab !== "recovery" && h("span", { class: "count" }, count(tab)),
      ),
    ),
  );
  // the bar fades at its end while more tabs are out of view
  const more = () =>
    nav.classList.toggle("more", nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4);
  nav.addEventListener("scroll", more);
  tabBarObserver?.disconnect();
  tabBarObserver = new ResizeObserver(more);
  tabBarObserver.observe(nav);
  return nav;
}

// ------------------------------------------------------------------ boards

function boardView(data: Data): HTMLElement {
  const board = boardOf(draft ?? layout, view.tab, preset);
  const grid = h("div", { class: `grid${editing ? " editing" : ""}` });
  // a hidden widget leaves the grid; Add widget lists it to show it again
  const shown = board.filter(
    (inst) => !inst.hidden && (widget(inst.widget) || (editing && !withheld.has(inst.widget))),
  );
  const tiles = shown.map((inst) => tile(data, inst, widget(inst.widget)));
  // not in edit mode, where the width slider must show the width that is saved
  if (!editing) {
    for (const at of loneAtTwoColumns(shown.map((i) => shownSpan(i, widget(i.widget))))) {
      tiles[at].classList.add("wide-tablet");
    }
  }
  grid.append(...tiles);
  if (grid.childElementCount === 0) {
    // an empty board offers edit mode itself: the menu is not the only way in
    grid.append(
      h(
        "div",
        { class: "board-empty" },
        h("p", {}, t(editing ? "board.emptyEdit" : "board.empty")),
        !editing && h("button", { class: "btn primary", onclick: startEdit }, t("edit.start")),
      ),
    );
  }
  // one caption for the board instead of the same note under each recovery widget
  const caption = view.tab === "recovery" && h("p", { class: "muted board-note" }, t("rec.board"));
  return h(
    "main",
    { id: "board", role: "tabpanel", "aria-labelledby": `tab-${view.tab}`, tabindex: "-1" },
    !editing && missedBanner(data),
    mine && !editing && staleBanner(mine),
    news && !editing && !newsClosed && newsBanner(news),
    caption,
    grid,
  );
}

/** The automatic refresh was due over an hour ago and has not written the page since. */
function missedBanner(data: Data): HTMLElement | false {
  if (!isLate(data.due, Date.now())) return false;
  return h(
    "div",
    { class: "banner", role: "region", "aria-label": t("due.label") },
    h("p", {}, t("due.text", { date: writtenAt(data) ?? "" })),
  );
}

/** Claude wrote a new layout after this browser saved one: keep yours, or use the new one. */
function staleBanner(local: Layout): HTMLElement {
  return h(
    "div",
    { class: "banner", role: "region", "aria-label": t("stale.label") },
    h("p", {}, t("stale.text")),
    h(
      "button",
      {
        class: "btn",
        onclick: () => {
          setLayout(local);
          announce(t("stale.kept"));
        },
      },
      t("stale.keep"),
    ),
    h(
      "button",
      {
        class: "btn",
        onclick: () => {
          store.remove(LAYOUT_KEY);
          mine = null;
          render();
          announce(t("stale.used"));
        },
      },
      t("stale.new"),
    ),
  );
}

const NEWS_KEY = `garmin-news:${location.pathname}`;

/** The record of the last refresh, for the page code that this page runs and that this browser has not closed. */
function readNews(): News | undefined {
  const id = document.querySelector<HTMLMetaElement>('meta[name="garmin-template"]')?.content;
  const own = id !== undefined && /^[0-9a-f]{16}$/.test(id) ? id : undefined;
  const parsed = parseNews(
    G.refresh,
    own,
    (board) => tabs.includes(board),
    (name) => widget(name) !== undefined,
  );
  return parsed && store.get(NEWS_KEY) !== parsed.code ? parsed : undefined;
}

/** What the last refresh did: the new version and the preset widgets that it added. Shows once in each browser. */
function newsBanner(note: News): HTMLElement {
  const list = new Intl.ListFormat(lang);
  const boards = Object.entries(note.widgets);
  return h(
    "div",
    { class: "banner", role: "region", "aria-label": t("news.label") },
    h(
      "p",
      {},
      note.server === undefined
        ? t("news.textNoVersion")
        : t("news.text", { version: note.server }),
    ),
    boards.length > 0 && h("p", {}, t("news.widgets")),
    boards.length > 0 &&
      h(
        "ul",
        {},
        ...boards.map(([board, names]) =>
          h(
            "li",
            {},
            `${typeName(t, board)}: ${list.format(names.map((n) => widget(n)?.title(t) ?? n))}`,
          ),
        ),
      ),
    h("p", {}, h("a", { href: WHATS_NEW, rel: "noopener" }, t("news.link"))),
    h(
      "button",
      {
        class: "btn",
        onclick: () => {
          store.set(NEWS_KEY, note.code);
          newsClosed = true;
          render();
          announce(t("news.closed"));
          document.getElementById("board")?.focus();
        },
      },
      t("news.close"),
    ),
  );
}

/** The type a board shows: the Recovery board shows all types, like All. */
function boardType(): string {
  return view.tab === "recovery" ? "all" : view.tab;
}

function titleOf(inst: Instance, def: WidgetDef | undefined): string {
  if (!def) return t("widget.unknown", { id: inst.widget });
  const own = inst.type && inst.type !== boardType() ? ` · ${typeName(t, inst.type)}` : "";
  return def.title(t) + own;
}

/** Never narrower than the widget fits in, also for a layout that Claude wrote. */
const shownSpan = (inst: Instance, def: WidgetDef | undefined) =>
  Math.max(inst.span, def?.minSpan ?? 1) as Span;

function tile(data: Data, inst: Instance, def: WidgetDef | undefined): HTMLElement {
  const title = titleOf(inst, def);
  const headingId = `h-${inst.id}`;
  const body = h("div", { class: "tile-body" });
  const el = h(
    "section",
    {
      class: `tile span-${shownSpan(inst, def)}`,
      "data-id": inst.id,
      "data-widget": inst.widget,
      "aria-labelledby": headingId,
    },
    h(
      "header",
      { class: "tile-head" },
      h("h2", { id: headingId }, title),
      editing && tools(inst, title),
    ),
    body,
    editing && resizer(inst, title, def),
  );
  if (def) {
    try {
      // a custom widget gets its own arrays: sorting them must not reorder the other tiles.
      // shortcut: the activity objects are still shared, so a widget that changes a field changes it for all; deep-copy if that is ever seen
      def.render(body, ctxFor(def.custom ? ownArrays(data) : data, inst));
    } catch (e) {
      body.replaceChildren(
        h("p", { class: "error" }, t("widget.failed", { message: errorText(e) })),
      );
      console.warn(`widget ${inst.widget}:`, e);
    }
  }
  return el;
}

/** The text of a thrown value: its message (an Error has one), else a short JSON or String(). */
function errorText(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const { message } = e as { message?: unknown };
    if (typeof message === "string") return message;
    // the values from the root to the current one: an object met again on it is a cycle
    const path: unknown[] = [];
    try {
      const json = JSON.stringify(e, function (this: unknown, key: string, value: unknown) {
        while (path.length > 0 && path.at(-1) !== this) path.pop();
        if (path.includes(value)) return "[Circular]";
        path.push(value);
        return value;
      });
      return json.length > 100 ? `${json.slice(0, 99)}…` : json;
    } catch {
      // a value JSON cannot write, such as a BigInt
    }
  }
  return String(e);
}

/** The data with a copy of each top-level array; the items are the same objects. */
function ownArrays(data: Data): Data {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]),
  ) as unknown as Data;
}

function ctxFor(data: Data, inst: Instance): Ctx {
  const type = inst.type ?? boardType();
  const all = activitiesIn(data.activities, view.from, view.to);
  // the name filter too, so a comparison with the weeks before compares the same sessions
  const ofType = <A extends Activity>(acts: A[]) =>
    named(type !== "all" ? acts.filter((a) => groupOf(a) === type) : acts, view.names);
  return {
    data,
    id: inst.id,
    board: view.tab,
    type,
    from: view.from,
    to: view.to,
    weeks: weeks.filter((w) => w >= view.from && w <= view.to),
    activities: ofType(all),
    ofType,
    // every activity, also outside the chosen names: the body counts the load of all of them
    allActivities: all,
    lang,
    t,
    fmt,
    calc: { ...calc, ...metrics, ...running, ...strength, ...sports },
    chart,
    color: (name: string) => token(name) || token("generic"),
    text: (key, params = {}) =>
      (widgetText(widget(inst.widget)?.texts, lang, key) ?? key).replace(
        /\{(\w+)\}/g,
        (m, name: string) => String(params[name] ?? m),
      ),
    empty: (el, message) =>
      el.replaceChildren(h("p", { class: "muted empty" }, message ?? t("empty.window"))),
    item: view.item,
    setItem: (item) => {
      view = { ...view, item };
      render();
    },
    refresh: render,
  };
}

// ------------------------------------------------------------------ edit mode

function currentBoard(): Instance[] {
  return boardOf(draft ?? layout, view.tab, preset);
}

/** An edit changes the draft only; Done saves it. */
function saveBoard(board: Instance[], nextTip?: typeof tip): void {
  setDraft(withBoard(draft ?? layout, view.tab, board, preset), nextTip);
}

/** The current board in full rows, in its own order, and a tip when a swap would do better. A draft like every other edit. */
function autoArrange(): void {
  const board = currentBoard();
  const saved = draft;
  // heights are measured at the user's widths, so a tile that a press made wider is drawn at its own width first
  const own = board.map(({ baseSpan, ...i }) => (baseSpan ? { ...i, span: baseSpan } : i));
  const drawnOwn = own.some((i, n) => i.span !== board[n].span);
  if (drawnOwn) {
    draft = withBoard(draft ?? layout, view.tab, own, preset);
    render();
  }
  const next = arrange(board, tileInfo);
  const found = arrangeTip(board, tileInfo, (a, b) => refused.has(swapKey(view.tab, a, b)));
  const nextTip = found && { tab: view.tab, ...found };
  // a save lists a preset board, and the bar would show unsaved changes with nothing changed
  if (JSON.stringify(next) !== JSON.stringify(board)) saveBoard(next, nextTip);
  else if (drawnOwn || tip || nextTip) {
    draft = saved;
    tip = nextTip;
    render();
  }
  announce(nextTip ? `${t("said.arranged")}. ${tipText(nextTip.swap)}` : t("said.arranged"));
}

/** What Auto-arrange needs of a tile. */
const tileInfo = (i: Instance) =>
  // a withheld widget has no tile, so it takes no column; it stays on the board
  withheld.has(i.widget)
    ? undefined
    : // shortcut: heights are measured at the current window width, measure at 3 columns if phone results are poor
      { height: contentHeight(i.id), min: widget(i.widget)?.minSpan ?? 1 };

const titleOfId = (id: string) => {
  const inst = currentBoard().find((i) => i.id === id)!;
  return titleOf(inst, widget(inst.widget));
};
const swapNames = ([a, b]: [string, string]) => ({ a: titleOfId(a), b: titleOfId(b) });
const tipText = (swap: [string, string]) => t("edit.tip", swapNames(swap));

function applyTip(): void {
  const { swap, board } = tip!;
  const names = swapNames(swap);
  const before = drawnRows(currentBoard(), tileInfo);
  const saved = draft;
  // the tip counted the heights at the old widths, and a chart's height follows its width: measure the swap drawn
  draft = withBoard(draft ?? layout, view.tab, board, preset);
  render();
  if (better(drawnRows(board, tileInfo), before)) {
    saveBoard(board);
    announce(t("said.swapped", names));
  } else {
    draft = saved;
    refused.add(swapKey(tip!.tab, ...swap));
    tip = { ...tip!, failed: true };
    render();
    announce(t("edit.tipFailed", names));
  }
}

/** A tile is as tall as its row, so its content ends at the bottom of its body. Whole px, so that sums compare. */
function contentHeight(id: string): number {
  const el = [...document.querySelectorAll<HTMLElement>(".tile")].find((x) => x.dataset.id === id)!;
  const end = el.querySelector(".tile-body")!.getBoundingClientRect().bottom;
  return Math.round(end - el.getBoundingClientRect().top);
}

function setDraft(next: Layout, nextTip?: typeof tip): void {
  draft = next;
  tip = nextTip;
  render();
}

/** Saves a layout in this browser. */
function setLayout(next: Layout): void {
  layout = next;
  mine = null; // saving a layout chooses it
  store.set(LAYOUT_KEY, JSON.stringify({ baseRev: pageLayout.rev, layout } satisfies LocalLayout));
  render();
}

function readLocal(): LocalLayout | null {
  try {
    const v = JSON.parse(store.get(LAYOUT_KEY) ?? "null") as unknown;
    return v && typeof v === "object" && "baseRev" in v ? (v as LocalLayout) : null;
  } catch {
    return null;
  }
}

/** The edit tools of a tile: the grip that moves it and the button that hides it. */
function tools(inst: Instance, title: string): HTMLElement {
  const grip = h(
    "button",
    {
      class: "tool grip",
      "aria-label": t("edit.move", { title }),
      title: t("edit.moveHint"),
      "aria-pressed": "false",
    },
    "⠿",
  );
  grip.addEventListener("pointerdown", (e) =>
    dragTile(e, grip, (before) => moveTile(inst.id, title, before)),
  );
  grip.addEventListener("keydown", (e) =>
    keyMove(e, grip, {
      picked: (n, count) => announce(t("said.picked", { title, n, count })),
      moved: (n, count) => announce(t("said.position", { n, count })),
      drop: (before) => moveTile(inst.id, title, before),
      cancel: () => {
        render();
        announce(t("said.cancelled", { title }));
      },
    }),
  );
  const hide = t("edit.hide", { title });
  return h(
    "div",
    { class: "tools" },
    grip,
    h(
      "button",
      {
        class: "tool",
        "aria-label": hide,
        title: hide,
        onclick: () => {
          saveBoard(toggleHidden(currentBoard(), inst.id));
          announce(t("said.hidden", { title }));
        },
      },
      icon("eye"),
    ),
  );
}

function moveTile(id: string, title: string, before: string | null): void {
  const next = moveBefore(currentBoard(), id, before);
  saveBoard(next);
  const shown = next.filter((x) => !x.hidden);
  const n = shown.findIndex((x) => x.id === id) + 1;
  announce(t("said.moved", { title, n, count: shown.length }));
}

/** The columns of the grid at this window width: the breakpoints of .grid in styles.css. */
const columns = () =>
  matchMedia("(max-width: 700px)").matches ? 1 : matchMedia("(max-width: 1100px)").matches ? 2 : 3;

/** The resize handle on the right edge of a tile; from the keyboard it is a slider. */
function resizer(inst: Instance, title: string, def: WidgetDef | undefined): HTMLElement {
  const min = def?.minSpan ?? 1;
  const cols = columns();
  const now = Math.min(inst.span, cols);
  const setWidth = (span: number, at: number) => {
    const stored = storedSpan(span, inst.span, at);
    if (stored === inst.span) return;
    saveBoard(setSpan(currentBoard(), inst.id, stored));
    announce(t("said.width", { title, n: span, cols: at }));
  };
  const handle = h("div", {
    class: "resize",
    role: "slider",
    tabindex: "0",
    "aria-label": t("edit.width", { title }),
    "aria-valuemin": Math.min(min, cols),
    "aria-valuemax": cols,
    "aria-valuenow": now,
    "aria-valuetext": t("edit.widthValue", { n: now, cols }),
    title: t("edit.width", { title }),
    onkeydown: (e: KeyboardEvent) => {
      const steps: Record<string, number> = {
        ArrowRight: now + 1,
        ArrowUp: now + 1,
        ArrowLeft: now - 1,
        ArrowDown: now - 1,
        Home: min,
        End: cols,
      };
      if (!(e.key in steps)) return;
      e.preventDefault();
      setWidth(Math.max(Math.min(min, cols), Math.min(cols, steps[e.key])), cols);
    },
  });
  handle.addEventListener("pointerdown", (e) => resizeTile(e, handle, min, setWidth));
  return handle;
}

/** The edit bar stays at the top of the window while you scroll the board. */
function editBar(): HTMLElement {
  const hidden = currentBoard().filter((x) => x.hidden).length;
  return h(
    "div",
    { class: "edit-bar", role: "toolbar", "aria-label": t("edit.bar") },
    h("strong", {}, t("edit.editing", { board: typeName(t, view.tab) })),
    dirty() && h("span", { class: "unsaved muted small" }, t("edit.unsaved")),
    h("span", { class: "spacer" }),
    h(
      "button",
      { class: "btn", onclick: addDialog },
      hidden > 0 ? t("edit.addHidden", { n: hidden }) : t("edit.add"),
    ),
    h(
      "button",
      {
        class: "btn",
        onclick: () => setDraft(resetBoard(draft ?? layout, view.tab, preset)),
      },
      t("edit.reset"),
    ),
    h("button", { class: "btn", onclick: autoArrange }, t("edit.arrange")),
    h("button", { class: "btn", onclick: copyDialog }, t("edit.copy")),
    h("button", { class: "btn", onclick: discard }, t("edit.discard")),
    h("button", { class: "btn primary", onclick: done }, t("edit.done")),
    tip?.tab === view.tab &&
      h(
        "p",
        { class: "edit-tip small" },
        h("span", {}, tip.failed ? t("edit.tipFailed", swapNames(tip.swap)) : tipText(tip.swap)),
        !tip.failed && h("button", { class: "btn", onclick: applyTip }, t("edit.tipApply")),
      ),
  );
}

function dialog(title: string, ...content: (HTMLElement | false)[]): HTMLDialogElement {
  const d = h(
    "dialog",
    { class: "dialog", "aria-label": title, onclose: () => d.remove() },
    h(
      "header",
      { class: "dialog-head" },
      h("h2", {}, title),
      h("button", { class: "tool", "aria-label": t("add.close"), onclick: () => d.close() }, "✕"),
    ),
    ...content,
  );
  document.body.append(d);
  d.showModal();
  return d;
}

const isOtherSport = (tab: string) => tab !== "all" && tab !== "recovery" && !GROUPS.includes(tab);

function addDialog(): void {
  const board = currentBoard();
  const own = boardType();
  const list = h("ul", { class: "catalogue" });
  const search = h("input", {
    type: "search",
    class: "catalogue-search",
    placeholder: t("add.search"),
    "aria-label": t("add.search"),
    autofocus: true,
    oninput: () => filter(),
  });
  const d = dialog(t("add.title"), search, list);
  const addOne = (def: WidgetDef, type: string | undefined) => {
    d.close();
    saveBoard(add(board, def.id, { type: type === own ? undefined : type, span: def.span ?? 1 }));
    announce(t("said.added", { title: def.title(t) }));
  };
  const defs = allWidgets()
    .filter((def) => def.types !== undefined || !board.some((x) => x.widget === def.id))
    .toSorted((a, b) => a.title(t).localeCompare(b.title(t), lang));
  for (const def of defs) {
    // "generic" also stands for every other SDK sport: their boards have the widgets of the Other board
    const types = def.types
      ?.flatMap((x) => (x === "generic" ? [...tabs.filter(isOtherSport), x] : [x]))
      .filter((x) => x === "all" || tabs.includes(x));
    const pick =
      types && types.length > 0
        ? h(
            "select",
            { "aria-label": t("add.type") },
            ...types.map((x) => h("option", { value: x, selected: x === own }, typeName(t, x))),
          )
        : undefined;
    list.append(
      h(
        "li",
        { "data-find": findText(def.title(t), def.title(english)) },
        h("span", {}, def.title(t)),
        pick,
        h(
          "button",
          {
            class: "btn",
            "aria-label": t("add.addOne", { title: def.title(t) }),
            onclick: () => addOne(def, pick?.value),
          },
          t("add.add"),
        ),
      ),
    );
  }
  const hidden = board.filter((x) => x.hidden);
  const group = h("li", { class: "group" }, t("add.hiddenGroup"));
  if (hidden.length > 0) {
    list.append(group);
    for (const inst of hidden) {
      const title = titleOf(inst, widget(inst.widget));
      list.append(
        h(
          "li",
          {
            "data-find": findText(title, widget(inst.widget)?.title(english) ?? ""),
            "data-hidden": true,
          },
          h("span", {}, title),
          h(
            "button",
            {
              class: "btn",
              onclick: () => {
                d.close();
                saveBoard(toggleHidden(board, inst.id));
                announce(t("said.shown", { title }));
              },
            },
            t("edit.show", { title }),
          ),
          h(
            "button",
            {
              class: "btn",
              onclick: () => {
                d.close();
                saveBoard(remove(board, inst.id));
                announce(t("said.removed", { title }));
              },
            },
            t("edit.remove", { title }),
          ),
        ),
      );
    }
  }
  const noMatch = h("li", { class: "muted", hidden: true }, t("add.noMatch"));
  list.append(noMatch);
  // the title in the page language and in English, without case or accents: "hrv" and "Fréquence" both find
  function filter(): void {
    const q = findText(search.value.trim());
    const items = [...list.querySelectorAll<HTMLElement>("li[data-find]")];
    for (const li of items) li.hidden = !li.dataset.find!.includes(q);
    group.hidden = !items.some((li) => li.dataset.hidden !== undefined && !li.hidden);
    noMatch.hidden = items.some((li) => !li.hidden);
  }
  if (list.childElementCount === 1) {
    search.remove();
    list.replaceChildren(h("li", {}, t("add.none")));
  }
}

const english = translator("en");
const findText = (...titles: string[]) =>
  titles.join(" ").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function copyDialog(): void {
  const shown = draft ?? layout;
  const text = JSON.stringify({ base: shown.base, boards: shown.boards, seen: shown.seen });
  const area = h("textarea", { class: "layout-text", readonly: true, rows: 6 }, text);
  const copy = h("button", { class: "btn" }, t("copy.copy"));
  copy.addEventListener("click", async () => {
    area.select();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      document.execCommand("copy");
    }
    copy.textContent = t("copy.copied");
  });
  dialog(
    t("copy.title"),
    h("p", {}, t("copy.hint")),
    area,
    h("div", { class: "dialog-actions" }, copy),
  );
}

// ------------------------------------------------------------------ custom widgets

/** A custom widget from the page block. Code that does not compile gives a widget that shows the error. */
function compile(w: unknown): WidgetDef | undefined {
  if (!w || typeof w !== "object") return undefined;
  const { id, title, code, span, types, texts } = w as Record<string, unknown>;
  if (typeof id !== "string" || typeof code !== "string") return undefined;
  let draw: WidgetDef["render"];
  try {
    // the body of a function (el, ctx) that Claude wrote on the user's request; the server keeps it in this page
    draw = new Function("el", "ctx", code) as WidgetDef["render"];
  } catch (e) {
    draw = () => {
      throw new Error((e as Error).message, { cause: e });
    };
  }
  const own = texts && typeof texts === "object" ? (texts as WidgetDef["texts"]) : undefined;
  return {
    id,
    title: () => widgetText(own, lang, "title") ?? (typeof title === "string" ? title : id),
    texts: own,
    span: Math.min(3, Math.max(1, Math.round(Number(span) || 1))) as Span,
    types: Array.isArray(types) ? (types as WidgetDef["types"]) : undefined,
    render: draw,
  };
}
