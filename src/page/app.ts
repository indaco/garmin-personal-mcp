import * as calc from "./calc";
import * as metrics from "./metrics";
import * as running from "./running";
import * as strength from "./strength";
import * as sports from "./sports";
import { type Activity, activitiesIn, GROUPS, groupOf, weeksOf } from "./calc";
import { Chart, chart, destroyCharts, themeCharts } from "./charts";
import { announce, h, keepFocus } from "./dom";
import { icon } from "./icons";
import {
  addLanguages,
  formatter,
  type Key,
  LANGUAGE_NAMES,
  pickLang,
  type T,
  translator,
} from "./i18n";
import {
  add,
  boardOf,
  type Instance,
  type Layout,
  type LocalLayout,
  merge,
  move,
  parseLayout,
  remove,
  resetBoard,
  setSpan,
  type Span,
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
} from "./registry";
import { formatHash, parseHash, type View } from "./state";
import { typeName } from "./widgets/ui";
import { DEFAULT_THEME, store, THEMES, themeKey, token } from "./theme";
import "./widgets";

declare global {
  interface Window {
    /** The page blocks, set by the inline script that the server fills. */
    GARMIN?: { data: Data | null; layout: unknown; widgets: unknown; i18n?: unknown };
    Chart?: typeof Chart;
  }
}

const G = window.GARMIN ?? { data: null, layout: null, widgets: [] };
const LAYOUT_KEY = `garmin-layout:${location.pathname}`;
const ALWAYS: readonly string[] = ["running", "strengthTraining", "walking", "cycling", "racket"];

let langChoice = store.get("garmin-lang") ?? "auto";
let lang = "en";
let t: T = translator("en");
let fmt = formatter("en");
const pageLayout = parseLayout(G.layout);
let layout: Layout = merge(pageLayout, readLocal());
let view: View;
let editing = false;
let accountOpen = false;
let tabs: string[] = [];
let weeks: string[] = [];

export function start(): void {
  window.Chart = Chart; // for custom widgets and the page tests
  addLanguages(G.i18n);
  for (const w of Array.isArray(G.widgets) ? G.widgets : []) {
    const def = compile(w);
    if (def) registerCustom(def);
  }
  setLanguage(langChoice);
  const data = G.data;
  if (data) {
    const present = new Set(data.activities.map(groupOf));
    const others = [...present].filter((g) => !GROUPS.includes(g)).toSorted();
    tabs = [
      "all",
      "recovery",
      ...[...GROUPS.slice(0, -1), ...others, "generic"].filter(
        (g) => ALWAYS.includes(g) || present.has(g),
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
    const menu = document.querySelector<HTMLDetailsElement>(".account[open]");
    if (e.key !== "Escape" || !menu) return;
    menu.open = false;
    menu.querySelector("summary")!.focus();
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
  t = translator(lang);
  fmt = formatter(lang);
  document.documentElement.lang = lang;
}

function render(): void {
  const app = document.getElementById("app")!;
  destroyCharts();
  themeCharts();
  document.title = t("title");
  if (!G.data) {
    app.replaceChildren(
      h("main", { class: "page" }, h("h1", {}, t("title")), h("p", {}, t("noData")), footer()),
    );
    return;
  }
  history.replaceState(null, "", formatHash(view));
  // a theme or language change renders again; the account menu stays as it was
  accountOpen = document.querySelector(".account[open]") !== null;
  const data = G.data;
  keepFocus(() =>
    app.replaceChildren(h("div", { class: "page" }, header(data), boardView(data), footer())),
  );
}

// ------------------------------------------------------------------ footer

const REPO = "https://github.com/indaco/garmin-personal-mcp";

function footer(): HTMLElement {
  const links: [Key, string][] = [
    ["footer.source", REPO],
    ["footer.issues", `${REPO}/issues`],
    ["footer.releases", `${REPO}/releases`],
    ["footer.license", `${REPO}/blob/main/LICENSE`],
  ];
  return h(
    "footer",
    { class: "foot" },
    // shortcut: placeholder name; the logo is styled once in .logo
    h(
      "a",
      { class: "brand", href: REPO },
      h("span", { class: "logo", "aria-hidden": "true" }),
      "garmin-personal-mcp",
    ),
    h(
      "nav",
      { "aria-label": t("footer.links") },
      h(
        "ul",
        {},
        ...links.map(([key, href]) => h("li", {}, h("a", { href, rel: "noopener" }, t(key)))),
      ),
    ),
  );
}

// ------------------------------------------------------------------ header

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
        h("span", { class: "logo", "aria-hidden": "true" }),
        h(
          "div",
          {},
          h("h1", {}, t("title")),
          h(
            "p",
            { class: "muted" },
            t("period", { from: fmt.longDay(data.start), to: fmt.longDay(data.end) }),
          ),
        ),
      ),
      h("div", { class: "menus" }, editButton(), accountMenu()),
    ),
    windowBar(inProgress),
    tabBar(data),
    editing && editBar(),
  );
}

function accountMenu(): HTMLElement {
  return h(
    "details",
    { class: "account", open: accountOpen },
    h("summary", { "aria-label": t("menu.settings"), title: t("menu.settings") }, icon("user")),
    h("div", { class: "account-panel" }, languageMenu(), themeMenu()),
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
      h("option", { value: code, selected: langChoice === code }, name),
    ),
  );
  return h("label", { class: "menu" }, h("span", {}, t("menu.language")), select);
}

function themeMenu(): HTMLElement {
  const current = document.documentElement.dataset.theme ?? DEFAULT_THEME;
  const groups = ["auto", "dark", "light", "accessible"] as const;
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
        ...THEMES.filter((x) => x.group === g).map((x) =>
          h("option", { value: x.id, selected: x.id === current }, t(themeKey(x.id))),
        ),
      ),
    ),
  );
  return h("label", { class: "menu" }, h("span", {}, t("menu.theme")), select);
}

function editButton(): HTMLElement {
  return h(
    "button",
    {
      class: "btn",
      "aria-pressed": String(editing),
      onclick: () => {
        editing = !editing;
        render();
      },
    },
    editing ? t("edit.done") : t("edit.start"),
  );
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
  return h(
    "div",
    { class: "window-bar", role: "group", "aria-label": t("window.label") },
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
  return h(
    "nav",
    {
      class: "tabs",
      role: "tablist",
      "aria-label": t("tabs.label"),
      onkeydown: (e: KeyboardEvent) => {
        const i = tabs.indexOf(view.tab);
        if (e.key === "ArrowRight") select(tabs[(i + 1) % tabs.length]);
        else if (e.key === "ArrowLeft") select(tabs[(i - 1 + tabs.length) % tabs.length]);
      },
    },
    ...tabs.map((tab) =>
      h(
        "button",
        {
          role: "tab",
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
}

// ------------------------------------------------------------------ boards

function boardView(data: Data): HTMLElement {
  const board = boardOf(layout, view.tab, preset);
  const grid = h("div", { class: `grid${editing ? " editing" : ""}` });
  for (const inst of board) {
    const def = widget(inst.widget);
    if (!editing && (inst.hidden || !def)) continue;
    grid.append(tile(data, inst, def));
  }
  if (grid.childElementCount === 0) {
    grid.append(h("p", { class: "board-empty" }, t("board.empty")));
  }
  // one caption for the board instead of the same note under each recovery widget
  const caption = view.tab === "recovery" && h("p", { class: "muted board-note" }, t("rec.board"));
  return h("main", {}, caption, grid);
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
      class: `tile span-${inst.span}${inst.hidden ? " is-hidden" : ""}`,
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
  return boardOf(layout, view.tab, preset);
}

function saveBoard(board: Instance[]): void {
  setLayout(withBoard(layout, view.tab, board));
}

function setLayout(next: Layout): void {
  layout = next;
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

/** A small edit button; its label is also its tooltip. */
function btn(
  label: string,
  text: string,
  onclick: () => void,
  attrs: Record<string, unknown> = {},
) {
  return h("button", { class: "tool", "aria-label": label, title: label, onclick, ...attrs }, text);
}

function tools(inst: Instance, title: string): HTMLElement {
  const board = currentBoard();
  const i = board.findIndex((x) => x.id === inst.id);
  const moveTo = (to: number) => {
    const next = move(board, inst.id, to);
    saveBoard(next);
    const n = next.findIndex((x) => x.id === inst.id) + 1;
    announce(t("said.moved", { title, n, count: next.length }));
  };
  const handle = btn(t("edit.drag", { title }), "⠿", () => {}, { class: "tool handle" });
  handle.addEventListener("pointerdown", (e) => drag(e, inst.id, handle));
  return h(
    "div",
    { class: "tools" },
    handle,
    btn(t("edit.earlier", { title }), "←", () => moveTo(i - 1), {
      disabled: i === 0,
    }),
    btn(t("edit.later", { title }), "→", () => moveTo(i + 1), {
      disabled: i === board.length - 1,
    }),
    ...([1, 2, 3] as Span[]).map((n) =>
      btn(
        t("edit.span", { n, title }),
        String(n),
        () => {
          saveBoard(setSpan(board, inst.id, n));
          announce(t("said.width", { title, n }));
        },
        { "aria-pressed": String(inst.span === n) },
      ),
    ),
    btn(
      t(inst.hidden ? "edit.show" : "edit.hide", { title }),
      inst.hidden ? "◌" : "◉",
      () => {
        saveBoard(toggleHidden(board, inst.id));
        announce(t(inst.hidden ? "said.shown" : "said.hidden", { title }));
      },
      { "aria-pressed": String(!!inst.hidden) },
    ),
    btn(t("edit.remove", { title }), "✕", () => {
      saveBoard(remove(board, inst.id));
      announce(t("said.removed", { title }));
    }),
  );
}

/** Drag with pointer events, so mouse, pen and touch all work; the arrow buttons do the same from the keyboard. */
function drag(e: PointerEvent, id: string, handle: HTMLElement): void {
  e.preventDefault();
  handle.setPointerCapture(e.pointerId);
  const source = handle.closest(".tile");
  source?.classList.add("dragging");
  let target: string | undefined;
  const over = (ev: PointerEvent) => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>(".tile");
    document.querySelectorAll(".drop-target").forEach((x) => x.classList.remove("drop-target"));
    target = el?.dataset.id;
    if (target && target !== id) el!.classList.add("drop-target");
  };
  const end = () => {
    handle.removeEventListener("pointermove", over);
    source?.classList.remove("dragging");
    document.querySelectorAll(".drop-target").forEach((x) => x.classList.remove("drop-target"));
    if (target && target !== id) {
      const board = currentBoard();
      saveBoard(
        move(
          board,
          id,
          board.findIndex((x) => x.id === target),
        ),
      );
    }
  };
  handle.addEventListener("pointermove", over);
  handle.addEventListener("pointerup", end, { once: true });
  handle.addEventListener("pointercancel", end, { once: true });
}

function editBar(): HTMLElement {
  return h(
    "div",
    { class: "edit-bar" },
    h("button", { class: "btn", onclick: addDialog }, t("edit.add")),
    h(
      "button",
      { class: "btn", onclick: () => setLayout(resetBoard(layout, view.tab, preset)) },
      t("edit.reset"),
    ),
    h("button", { class: "btn", onclick: copyDialog }, t("edit.copy")),
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

function addDialog(): void {
  const board = currentBoard();
  const own = boardType();
  const list = h("ul", { class: "catalogue" });
  const d = dialog(t("add.title"), list);
  const addOne = (def: WidgetDef, type: string | undefined) => {
    d.close();
    saveBoard(add(board, def.id, { type: type === own ? undefined : type, span: def.span ?? 1 }));
    announce(t("said.added", { title: def.title(t) }));
  };
  const defs = allWidgets()
    .filter((def) => def.types !== undefined || !board.some((x) => x.widget === def.id))
    .toSorted((a, b) => a.title(t).localeCompare(b.title(t), lang));
  for (const def of defs) {
    const types = def.types?.filter((x) => x === "all" || tabs.includes(x));
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
        {},
        h("span", {}, def.title(t)),
        pick,
        h("button", { class: "btn", onclick: () => addOne(def, pick?.value) }, t("add.add")),
      ),
    );
  }
  const hidden = board.filter((x) => x.hidden);
  if (hidden.length > 0) {
    list.append(h("li", { class: "group" }, t("add.hiddenGroup")));
    for (const inst of hidden) {
      const title = titleOf(inst, widget(inst.widget));
      list.append(
        h(
          "li",
          {},
          h("span", {}, title),
          h(
            "button",
            {
              class: "btn",
              onclick: () => {
                d.close();
                saveBoard(toggleHidden(board, inst.id));
              },
            },
            t("edit.show", { title }),
          ),
        ),
      );
    }
  }
  if (list.childElementCount === 0) list.append(h("li", {}, t("add.none")));
}

function copyDialog(): void {
  const text = JSON.stringify({ base: layout.base, boards: layout.boards });
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
  const { id, title, code, span, types } = w as Record<string, unknown>;
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
  return {
    id,
    title: () => (typeof title === "string" ? title : id),
    span: Math.min(3, Math.max(1, Math.round(Number(span) || 1))) as Span,
    types: Array.isArray(types) ? (types as WidgetDef["types"]) : undefined,
    render: draw,
  };
}
