import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The host side of the frame: what the page posts to it, and how the host answers. */
interface Frame {
  parent: { postMessage: ReturnType<typeof vi.fn> };
  onMessage?: (e: { source: unknown; data: unknown }) => void;
  onClick?: (e: { target: unknown; preventDefault: () => void }) => void;
  resize?: () => void;
  height: number;
  root: { style: { height: string } };
}

let frame: Frame;

/** A fresh copy of the module: its request ids, replies and screen state start over. */
async function load() {
  vi.resetModules();
  return import("../../src/page/mcp-app");
}

/** The messages that the page posted to the host, without the jsonrpc field. */
const sent = () =>
  frame.parent.postMessage.mock.calls.map(([m]) => {
    const { jsonrpc: _, ...rest } = m as Record<string, unknown>;
    return rest;
  });

/** A message from the host, as postMessage delivers it. */
const fromHost = (m: object) =>
  frame.onMessage!({ source: frame.parent, data: { jsonrpc: "2.0", ...m } });

/** Lets the promise callbacks of the module run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const blocks = { data: { weeks: 4 }, layout: null, widgets: [], languages: {}, i18n: {} };

/** connect, then the host answers ui/initialize with this context. */
async function connected(hostContext: object = {}) {
  const m = await load();
  const show = vi.fn();
  m.connect(show);
  fromHost({ id: 1, result: { protocolVersion: "2026-01-26", hostContext } });
  await settle();
  frame.parent.postMessage.mockClear();
  return { ...m, show };
}

beforeEach(() => {
  frame = {
    parent: { postMessage: vi.fn() },
    height: 900.2,
    root: { style: { height: "" } },
  };
  const win = {
    parent: frame.parent,
    addEventListener: (_: string, fn: Frame["onMessage"]) => {
      frame.onMessage = fn;
    },
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", {
    addEventListener: (_: string, fn: Frame["onClick"]) => {
      frame.onClick = fn;
    },
    documentElement: {
      style: frame.root.style,
      getBoundingClientRect: () => ({ height: frame.height }),
    },
    body: {},
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(fn: () => void) {
        frame.resize = fn;
      }
      observe() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("inChat", () => {
  it("waits for the host only in a frame without data", async () => {
    const { inChat } = await load();
    expect(inChat()).toBe(true);
    (window as { GARMIN?: unknown }).GARMIN = { data: { weeks: 4 } };
    expect(inChat()).toBe(false);
    // the page file opened on its own: no frame
    vi.stubGlobal("window", { parent: undefined });
    (window as { parent: unknown }).parent = window;
    expect(inChat()).toBe(false);
  });
});

describe("connect", () => {
  it("initializes, then shows the blocks of the first tool result only", async () => {
    const m = await load();
    const show = vi.fn();
    m.connect(show);
    expect(sent()).toEqual([
      {
        id: 1,
        method: "ui/initialize",
        params: {
          protocolVersion: "2026-01-26",
          appInfo: { name: "garmin-personal-dashboard", version: "1" },
          appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
        },
      },
    ]);
    fromHost({ id: 1, result: { hostContext: {} } });
    await settle();
    expect(sent().at(-1)).toEqual({ method: "ui/notifications/initialized", params: {} });

    // a result without data shows nothing; the first one with data shows; a second one is ignored
    fromHost({ method: "ui/notifications/tool-result", params: { structuredContent: {} } });
    fromHost({ method: "ui/notifications/tool-result", params: {} });
    expect(show).not.toHaveBeenCalled();
    fromHost({ method: "ui/notifications/tool-result", params: { structuredContent: blocks } });
    fromHost({
      method: "ui/notifications/tool-result",
      params: { structuredContent: { ...blocks, data: { weeks: 8 } } },
    });
    expect(show.mock.calls).toEqual([[blocks]]);
  });

  it("ignores messages that do not come from the host, or are not JSON-RPC", async () => {
    const { show } = await connected();
    const result = {
      method: "ui/notifications/tool-result",
      params: { structuredContent: blocks },
    };
    frame.onMessage!({ source: {}, data: { jsonrpc: "2.0", ...result } });
    frame.onMessage!({ source: frame.parent, data: { ...result } });
    frame.onMessage!({ source: frame.parent, data: null });
    expect(show).not.toHaveBeenCalled();
    expect(sent()).toEqual([]);
  });

  it("answers a request of the host with an empty result, and a notification with nothing", async () => {
    await connected();
    fromHost({ id: 7, method: "ping" });
    fromHost({ id: 8, method: "ui/resource-teardown", params: {} });
    fromHost({ method: "ui/notifications/tool-input", params: { arguments: {} } });
    expect(sent()).toEqual([
      { id: 7, result: {} },
      { id: 8, result: {} },
    ]);
  });

  it("drops a reply to a request that it never sent", async () => {
    await connected();
    expect(() => fromHost({ id: 99, result: {} })).not.toThrow();
    expect(sent()).toEqual([]);
  });

  it("gives the host only the links that leave the page", async () => {
    await connected();
    const click = (href: string | null) => {
      const e = {
        target: { closest: () => (href === null ? null : { getAttribute: () => href }) },
        preventDefault: vi.fn(),
      };
      frame.onClick!(e);
      return e.preventDefault;
    };
    expect(click("https://github.com/indaco/garmin-personal-mcp")).toHaveBeenCalled();
    expect(click("http://example.com/")).toHaveBeenCalled();
    // a tab or an anchor stays in the page; a click outside a link and on a text node do nothing
    expect(click("#board")).not.toHaveBeenCalled();
    expect(click("demo/index.html")).not.toHaveBeenCalled();
    expect(click(null)).not.toHaveBeenCalled();
    frame.onClick!({ target: {}, preventDefault: vi.fn() });
    expect(sent()).toEqual([
      {
        id: 2,
        method: "ui/open-link",
        params: { url: "https://github.com/indaco/garmin-personal-mcp" },
      },
      { id: 3, method: "ui/open-link", params: { url: "http://example.com/" } },
    ]);
  });

  it("sends the height of the page when it changes, and leaves the style as it was", async () => {
    await connected();
    frame.root.style.height = "100%";
    frame.resize!();
    frame.resize!();
    frame.height = 1200;
    frame.resize!();
    expect(sent()).toEqual([
      { method: "ui/notifications/size-changed", params: { height: 901 } },
      { method: "ui/notifications/size-changed", params: { height: 1200 } },
    ]);
    expect(frame.root.style.height).toBe("100%");
  });
});

describe("full screen", () => {
  it("is offered only when the host lists it, and follows the mode of the host", async () => {
    let m = await connected({ availableDisplayModes: ["inline"], displayMode: "inline" });
    expect(m.screen).toMatchObject({ offered: false, full: false });
    // before the page sets its redraw, a change of the host only updates the state
    fromHost({
      method: "ui/notifications/host-context-changed",
      params: { displayMode: "inline" },
    });
    expect(m.screen).toMatchObject({ offered: false, full: false });

    m = await connected({ availableDisplayModes: ["inline", "fullscreen"], displayMode: "inline" });
    expect(m.screen).toMatchObject({ offered: true, full: false });
    m.screen.redraw = vi.fn();
    fromHost({
      method: "ui/notifications/host-context-changed",
      params: { displayMode: "fullscreen" },
    });
    expect(m.screen).toMatchObject({ offered: true, full: true });
    expect(m.screen.redraw).toHaveBeenCalledTimes(1);
    // a change that names neither the modes nor the mode keeps both
    fromHost({ method: "ui/notifications/host-context-changed", params: { theme: "dark" } });
    expect(m.screen).toMatchObject({ offered: true, full: true });
  });

  it("asks for full screen and back, and keeps the mode that the host chose", async () => {
    const m = await connected({ availableDisplayModes: ["inline", "fullscreen"] });
    m.screen.redraw = vi.fn();

    let done = m.toggleFullscreen();
    expect(sent().at(-1)).toEqual({
      id: 2,
      method: "ui/request-display-mode",
      params: { mode: "fullscreen" },
    });
    fromHost({ id: 2, result: { mode: "fullscreen" } });
    await done;
    expect(m.screen.full).toBe(true);

    done = m.toggleFullscreen();
    expect(sent().at(-1)).toEqual({
      id: 3,
      method: "ui/request-display-mode",
      params: { mode: "inline" },
    });
    fromHost({ id: 3, result: { mode: "inline" } });
    await done;
    expect(m.screen.full).toBe(false);

    // the host refuses: it answers with the mode it keeps
    done = m.toggleFullscreen();
    fromHost({ id: 4, result: { mode: "inline" } });
    await done;
    expect(m.screen.full).toBe(false);

    // an error answer has no result: the mode stays
    done = m.toggleFullscreen();
    fromHost({ id: 5, error: { code: -32601, message: "no" } });
    await done;
    expect(m.screen.full).toBe(false);
    expect(m.screen.redraw).toHaveBeenCalledTimes(4);
  });
});
