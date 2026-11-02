import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServer } from "../src/server";

vi.mock("../src/log", () => ({ log: vi.fn() }));

const BASE = "https://api.test";
const TOKEN_URL = `${BASE}/personalapitoken-service/personal-api/personal-api-key/token`;
const KEY_PAGE = "https://connect.garmin.com/app/settings/personalApiToken";

type Reply = { status: number; body: string; contentType?: string };

let dir: string;
let keyFile: string;
/** The next answers of the token endpoint; every other request gets an empty JSON object. */
let tokenReplies: Reply[];
let keysSent: string[];

beforeEach(() => {
  // only Date: the in-memory transport needs its real timers
  vi.useFakeTimers({ toFake: ["Date"], now: 0 });
  dir = mkdtempSync(join(tmpdir(), "expired-key-"));
  keyFile = join(dir, "api-key");
  tokenReplies = [];
  keysSent = [];
  vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (String(url) !== TOKEN_URL) return new Response("{}", { status: 200 });
      keysSent.push(new Headers(init.headers).get("authorization") ?? "");
      const r = tokenReplies.shift();
      if (!r) throw new Error("unexpected token request");
      return new Response(r.body, {
        status: r.status,
        headers: { "Content-Type": r.contentType ?? "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function connect(): Promise<Client> {
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  const server = createServer({ baseUrl: BASE, apiKeyFile: keyFile, dataDir: dir });
  const client = new Client({ name: "test", version: "1" });
  await server.connect(serverEnd);
  await client.connect(clientEnd);
  return client;
}

/** What the assistant reads from a tool call. */
async function zones(client: Client): Promise<{ isError: boolean; text: string }> {
  const r = await client.callTool({ name: "getHeartRateZones", arguments: {} });
  const first = Array.isArray(r.content) ? r.content[0] : undefined;
  return { isError: r.isError === true, text: first?.type === "text" ? first.text : "" };
}

const token = (expiresIn: number): Reply => ({
  status: 200,
  body: JSON.stringify({ access_token: "tok", expires_in: expiresIn }),
});

it("tells how to replace a key file that expires during a chat, and the new key works without a restart", async () => {
  writeFileSync(keyFile, "old-key");
  const client = await connect();
  tokenReplies.push(token(3600));
  expect((await zones(client)).isError).toBe(false);

  vi.setSystemTime(3600_000);
  tokenReplies.push({ status: 401, body: '{"message":"expired"}' });
  const failed = await zones(client);
  expect(failed.isError).toBe(true);
  expect(failed.text).toContain("HTTP 401");
  expect(failed.text).toContain(KEY_PAGE);
  expect(failed.text).toContain(keyFile);
  expect(failed.text).toContain("no restart");
  expect(failed.text).not.toContain("old-key");

  writeFileSync(keyFile, "new-key");
  tokenReplies.push(token(3600));
  expect((await zones(client)).isError).toBe(false);
  expect(keysSent.at(-1)).toBe("ApiKey new-key");
});

it("tells to change the client configuration when the refused key comes from the environment", async () => {
  vi.stubEnv("GARMIN_PERSONAL_API_KEY", "env-key");
  tokenReplies.push({ status: 403, body: "forbidden", contentType: "text/plain" });
  const failed = await zones(await connect());
  expect(failed.isError).toBe(true);
  expect(failed.text).toContain(KEY_PAGE);
  expect(failed.text).toContain("GARMIN_PERSONAL_API_KEY");
  expect(failed.text).toContain("restart the client");
  expect(failed.text).not.toContain(keyFile);
  expect(failed.text).not.toContain("env-key");
});

it("does not blame the key when the Garmin token service fails", async () => {
  writeFileSync(keyFile, "good-key");
  tokenReplies.push({ status: 503, body: "<html>maintenance</html>", contentType: "text/html" });
  const failed = await zones(await connect());
  expect(failed.isError).toBe(true);
  expect(failed.text).toContain("HTTP 503");
  expect(failed.text).toContain("Try again later");
  expect(failed.text).not.toContain(KEY_PAGE);
  expect(failed.text).not.toContain("expired");
});
