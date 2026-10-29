import * as calc from "./calc";
import * as metrics from "./metrics";
import * as running from "./running";
import * as strength from "./strength";
import * as sports from "./sports";
import { type Activity, activitiesIn, boardOrder, GROUPS, groupOf, weeksOf } from "./calc";
import { Chart, chart, destroyCharts, themeCharts } from "./charts";
import { announce, h, keepFocus } from "./dom";
import { dragTile, keyMove, resizeTile } from "./edit-drag";
import { icon, logo } from "./icons";
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
  boardOf,
  type Instance,
  type Layout,
  type LocalLayout,
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
} from "./layout";
import { preset } from "./presets";
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
    };
    /** The page settings, set by the first script of the page. */
    GARMIN_SETTINGS?: Settings | null;
    Chart?: typeof Chart;
  }
}

const G = window.GARMIN ?? { data: null, layout: null, widgets: [] };
/** The server writes the notes HTML-escaped (pages that Claude designs show them as HTML); widgets get plain text. */
const plain = (s: string) =>
  new DOMParser().parseFromString(s, "text/html").documentElement.textContent ?? "";
if (G.data?.notes) G.data.notes = G.data.notes.map(plain);
const S: Settings = window.GARMIN_SETTINGS ?? {};
const LAYOUT_KEY = `garmin-layout:${location.pathname}`;
const ALWAYS: readonly string[] = ["running", "strengthTraining", "walking", "cycling", "racket"];

let langChoice = store.get("garmin-lang") ?? S.language ?? "auto";
let lang = "en";
let t: T = translator("en");
let fmt = formatter("en");
const pageLayout = parseLayout(G.layout);
let layout: Layout = merge(pageLayout, readLocal());
// the browser's layout, kept until you choose it or the new one that Claude wrote
let mine: Layout | null = stale(pageLayout, readLocal());
let view: View;
let editing = false;
// edit mode works on a copy: Done saves it, Discard drops it
let draft: Layout | null = null;
let accountOpen = false;
// on a phone the week window folds into one control
let windowOpen = false;
let tabs: string[] = [];
let weeks: string[] = [];

export function start(): void {
  window.Chart = Chart; // for custom widgets and the page tests
  addLanguages(G.languages);
  addLanguages(G.i18n);
  // English stays in the script for missing texts, but a page can leave it out of the menu
  if (S.languages && !S.languages.includes("en")) delete LANGUAGE_NAMES.en;
  withhold(S.exclude ?? []);
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
    const present = new Set(data.activities.map(groupOf));
    const kept = S.sports;
    tabs = [
      "all",
      ...(S.exclude?.includes("recovery") ? [] : ["recovery"]),
      ...boardOrder(present).filter((g) =>
        kept ? kept.includes(g) : ALWAYS.includes(g) || present.has(g),
      ),
    ];
    weeks = weeksOf(data.start, data.end);
  }
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
  themeCharts();
  document.title = pageTitle();
  if (!G.data) {
    app.replaceChildren(
      h("main", { class: "page" }, h("h1", {}, pageTitle()), h("p", {}, t("noData")), footer()),
    );
    return;
  }
  history.replaceState(null, "", formatHash(view));
  // a theme or language change renders again; the account menu stays as it was
  accountOpen = document.querySelector(".account[open]") !== null;
  const data = G.data;
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
        header(data),
        editing && editBar(),
        boardView(data),
        footer(data),
      ),
    ),
  );
}

// ------------------------------------------------------------------ footer

const REPO = "https://github.com/indaco/garmin-personal-mcp";

/**
 * Where the data comes from and when it was written, the days that Garmin did not give (their values
 * show n/a), then the project, the server version that wrote the page, and the license.
 */
function footer(data?: Data): HTMLElement {
  const failed = Number(data?.sync?.failedDays) || 0;
  // the server that wrote the page last, with its release notes
  const version = /^\d+\.\d+\.\d+$/.test(data?.server ?? "") ? data!.server : undefined;
  return h(
    "footer",
    { class: "foot" },
    data &&
      h(
        "div",
        { class: "source" },
        // no date in the data, no date in the footer
        data.generated && h("p", {}, t("footer.updated", { date: fmt.longDay(data.generated) })),
        failed > 0 && h("p", { class: "gap" }, t("footer.failed", { n: failed })),
      ),
    h(
      "p",
      { class: "made" },
      h("a", { class: "brand", href: REPO }, logo(), "garmin-personal-mcp"),
      "·",
      version &&
        h("a", { href: `${REPO}/releases/tag/v${version}`, rel: "noopener" }, `v${version}`),
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
      h("div", { class: "menus" }, accountMenu()),
    ),
    windowBar(inProgress),
    tabBar(data),
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

function tabBar(data: Data): HTMLElement {
  const inWindow = activitiesIn(data.activities, view.from, view.to);
  const count = (tab: string) =>
    tab === "all" ? inWindow.length : inWindow.filter((a) => groupOf(a) === tab).length;
  const select = (tab: string) => {
    view = { tab, from: view.from, to: view.to };
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
  new ResizeObserver(more).observe(nav);
  return nav;
}

// ------------------------------------------------------------------ boards

function boardView(data: Data): HTMLElement {
  const board = boardOf(draft ?? layout, view.tab, preset);
  const grid = h("div", { class: `grid${editing ? " editing" : ""}` });
  for (const inst of board) {
    const def = widget(inst.widget);
    // a hidden widget leaves the grid; Add widget lists it to show it again
    if (inst.hidden || (!def && (!editing || withheld.has(inst.widget)))) continue;
    grid.append(tile(data, inst, def));
  }
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
    mine && !editing && staleBanner(mine),
    caption,
    grid,
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

/** The type a board shows: the Recovery board shows all types, like All. */
function boardType(): string {
  return view.tab === "recovery" ? "all" : view.tab;
}

function titleOf(inst: Instance, def: WidgetDef | undefined): string {
  if (!def) return t("widget.unknown", { id: inst.widget });
  const own = inst.type && inst.type !== boardType() ? ` · ${typeName(t, inst.type)}` : "";
  return def.title(t) + own;
}

function tile(data: Data, inst: Instance, def: WidgetDef | undefined): HTMLElement {
  const title = titleOf(inst, def);
  const headingId = `h-${inst.id}`;
  const body = h("div", { class: "tile-body" });
  const el = h(
    "section",
    {
      // never narrower than the widget fits in, also for a layout that Claude wrote
      class: `tile span-${Math.max(inst.span, def?.minSpan ?? 1)}`,
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
      def.render(body, ctxFor(data, inst));
    } catch (e) {
      body.replaceChildren(
        h("p", { class: "error" }, t("widget.failed", { message: (e as Error).message })),
      );
      console.warn(`widget ${inst.widget}:`, e);
    }
  }
  return el;
}

function ctxFor(data: Data, inst: Instance): Ctx {
  const type = inst.type ?? boardType();
  const all = activitiesIn(data.activities, view.from, view.to);
  const ofType = <A extends Activity>(acts: A[]) =>
    type !== "all" ? acts.filter((a) => groupOf(a) === type) : acts;
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
function saveBoard(board: Instance[]): void {
  setDraft(withBoard(draft ?? layout, view.tab, board));
}

function setDraft(next: Layout): void {
  draft = next;
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
    h("button", { class: "btn", onclick: copyDialog }, t("edit.copy")),
    h("button", { class: "btn", onclick: discard }, t("edit.discard")),
    h("button", { class: "btn primary", onclick: done }, t("edit.done")),
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
  const text = JSON.stringify({ base: shown.base, boards: shown.boards });
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
