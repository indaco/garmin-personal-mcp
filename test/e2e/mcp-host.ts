// A minimal MCP Apps host on the reference AppBridge. It shows a page in a sandboxed frame, as hosts
// do, and sends one tool result. The MCP App e2e test bundles it for the browser.
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

interface HostLog {
  sizes: number[];
  links: string[];
}

declare global {
  interface Window {
    showApp(html: string, structuredContent: Record<string, unknown>): Promise<HostLog>;
    hostLog: HostLog;
  }
}

window.showApp = async (html, structuredContent) => {
  const log: HostLog = { sizes: [], links: [] };
  window.hostLog = log;
  const frame = document.createElement("iframe");
  // no allow-same-origin: the page gets an opaque origin, without storage
  frame.sandbox.add("allow-scripts");
  frame.style.width = "1200px";
  document.body.append(frame);
  const bridge = new AppBridge(null, { name: "test-host", version: "1" }, { openLinks: {} });
  bridge.onsizechange = ({ height }) => {
    if (height !== undefined) log.sizes.push(height);
    frame.style.height = `${height}px`;
  };
  bridge.onopenlink = async ({ url }) => {
    log.links.push(url);
    return {};
  };
  bridge.oninitialized = () =>
    void bridge.sendToolResult({ content: [{ type: "text", text: "{}" }], structuredContent });
  frame.srcdoc = html;
  await bridge.connect(new PostMessageTransport(frame.contentWindow!, frame.contentWindow!));
  return log;
};
