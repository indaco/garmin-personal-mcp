/**
 * The dashboard in the chat (an MCP App). The host loads the page without data. It sends the blocks
 * with the showDashboard result, over postMessage (JSON-RPC 2.0). This file does not use the ext-apps
 * App client: that client adds 239 KB to every page, also to the page file.
 */
import type { ViewBlocks } from "../dashboard-page";

const PROTOCOL = "2026-01-26";
const send = (message: object) => window.parent.postMessage({ jsonrpc: "2.0", ...message }, "*");

let id = 0;
const replies = new Map<number, (result: Record<string, unknown> | undefined) => void>();
const request = (method: string, params: object) =>
  new Promise<Record<string, unknown> | undefined>((resolve) => {
    replies.set(++id, resolve);
    send({ id, method, params });
  });

interface HostContext {
  displayMode?: string;
  availableDisplayModes?: string[];
}

/** The display of the frame: `offered` when the host can show the page full screen. */
export const screen = { offered: false, full: false, redraw: () => {} };

function follow(context: HostContext | undefined): void {
  if (context?.availableDisplayModes) {
    screen.offered = context.availableDisplayModes.includes("fullscreen");
  }
  if (context?.displayMode) screen.full = context.displayMode === "fullscreen";
}

/** Asks the host for full screen, or back to the chat; the host answers with the mode it chose. */
export async function toggleFullscreen(): Promise<void> {
  const r = await request("ui/request-display-mode", {
    mode: screen.full ? "inline" : "fullscreen",
  });
  follow({ displayMode: r?.mode as string | undefined });
  screen.redraw();
}

/** In a frame and without data: the page waits for the host. */
export const inChat = () => window.parent !== window && !window.GARMIN?.data;

/** Sends `ui/initialize`, then calls `show` with the blocks of the first tool result. */
export function connect(show: (blocks: ViewBlocks) => void): void {
  let shown = false;

  window.addEventListener("message", (e) => {
    // only the host talks to the page
    if (e.source !== window.parent || e.data?.jsonrpc !== "2.0") return;
    const m = e.data as {
      id?: number;
      method?: string;
      params?: { structuredContent?: unknown } & HostContext;
      result?: Record<string, unknown>;
    };
    if (m.method === undefined) {
      replies.get(m.id!)?.(m.result);
      replies.delete(m.id!);
    } else if (m.method === "ui/notifications/tool-result") {
      const blocks = m.params?.structuredContent as ViewBlocks | undefined;
      if (!shown && blocks?.data) {
        shown = true;
        show(blocks);
      }
    } else if (m.method === "ui/notifications/host-context-changed") {
      follow(m.params);
      screen.redraw();
    } else if (m.id !== undefined) {
      // ping, teardown: nothing to do, but a request needs a reply
      send({ id: m.id, result: {} });
    }
  });

  // the sandbox blocks navigation: the host opens the links that leave the page
  document.addEventListener("click", (e) => {
    const a = (e.target as Element).closest?.("a[href]");
    const href = a?.getAttribute("href") ?? "";
    if (!/^https?:\/\//.test(href)) return;
    e.preventDefault();
    void request("ui/open-link", { url: href });
  });

  void request("ui/initialize", {
    protocolVersion: PROTOCOL,
    appInfo: { name: "garmin-personal-dashboard", version: "1" },
    appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
  }).then((r) => {
    follow(r?.hostContext as HostContext | undefined);
    send({ method: "ui/notifications/initialized", params: {} });
    // the host sizes the frame to the page, measured as the ext-apps client does
    let last = 0;
    const resize = () => {
      const root = document.documentElement;
      const before = root.style.height;
      root.style.height = "max-content";
      const height = Math.ceil(root.getBoundingClientRect().height);
      root.style.height = before;
      if (height === last) return;
      last = height;
      send({ method: "ui/notifications/size-changed", params: { height } });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(document.documentElement);
    observer.observe(document.body);
  });
}
