import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GarminApiClient, GarminApiError } from "../src/api-client";
import { log } from "../src/log";

vi.mock("../src/log", () => ({ log: vi.fn() }));

const BASE = "https://api.test";
const TOKEN_URL = `${BASE}/personalapitoken-service/personal-api/personal-api-key/token`;
const KEY = "secret-api-key";

type Reply = { status?: number; body?: string; contentType?: string };
type Call = { url: string; method: string; headers: Record<string, string> };

let calls: Call[];
let replies: Reply[];

/** Replies in order; each request is recorded with its headers. */
function mockFetch(...queue: Reply[]) {
  replies = queue;
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        url: String(url),
        method: init.method ?? "GET",
        headers: Object.fromEntries(new Headers(init.headers).entries()),
      });
      const r = replies.shift();
      if (!r) throw new Error(`unexpected request ${url}`);
      return new Response(r.body ?? "", {
        status: r.status ?? 200,
        headers: { "Content-Type": r.contentType ?? "application/json" },
      });
    }),
  );
}

const tokenJson = (fields: Record<string, unknown>): Reply => ({ body: JSON.stringify(fields) });
const ok = (body: unknown): Reply => ({ body: JSON.stringify(body) });

function client(apiKeyFile = "/nonexistent/api-key") {
  return new GarminApiClient({ baseUrl: BASE, apiKeyFile, dataDir: "/nonexistent" });
}

beforeEach(() => {
  vi.stubEnv("GARMIN_PERSONAL_API_KEY", KEY);
  vi.mocked(log).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("token", () => {
  it("exchanges the API key for a JSON token and sends it as Bearer", async () => {
    mockFetch(tokenJson({ access_token: "tok-1", expires_in: 86400 }), ok({ a: 1 }));

    expect(await client().getJson("/x/y")).toEqual({ a: 1 });

    expect(calls[0]).toMatchObject({ url: TOKEN_URL, method: "POST" });
    expect(calls[0].headers.authorization).toBe(`ApiKey ${KEY}`);
    expect(calls[1]).toMatchObject({ url: `${BASE}/x/y`, method: "GET" });
    expect(calls[1].headers.authorization).toBe("Bearer tok-1");
    expect(calls[1].headers.accept).toBe("application/json");
  });

  it.each(["access_token", "accessToken", "token"])("reads the token from %s", async (field) => {
    mockFetch(tokenJson({ [field]: "tok-2" }), ok({}));
    await client().getJson("/x");
    expect(calls[1].headers.authorization).toBe("Bearer tok-2");
  });

  it.each([
    ["plain-token", "plain-token"],
    ['"quoted-token"', "quoted-token"],
    ["  spaced-token \n", "spaced-token"],
  ])("accepts a plain-text token %j", async (body, token) => {
    mockFetch({ body, contentType: "text/plain" }, ok({}));
    await client().getJson("/x");
    expect(calls[1].headers.authorization).toBe(`Bearer ${token}`);
  });

  it("keeps the token in memory and renews it 60 s before expires_in", async () => {
    vi.useFakeTimers({ now: 0 });
    mockFetch(tokenJson({ access_token: "tok-a", expires_in: 3600 }), ok({}), ok({}));
    const api = client();
    await api.getJson("/x");
    vi.setSystemTime(3539_000);
    await api.getJson("/x");
    expect(calls.map((c) => c.url)).toEqual([TOKEN_URL, `${BASE}/x`, `${BASE}/x`]);

    vi.setSystemTime(3540_000);
    replies.push(tokenJson({ access_token: "tok-b" }), ok({}));
    await api.getJson("/x");
    expect(calls[3].url).toBe(TOKEN_URL);
    expect(calls[4].headers.authorization).toBe("Bearer tok-b");
  });

  it.each([
    ["expires_in 120", { expires_in: 120 }],
    ["expiresIn 60", { expiresIn: 60 }],
    ["no expiry", {}],
  ])("keeps the token for 23 h with %s", async (_, expiry) => {
    vi.useFakeTimers({ now: 0 });
    mockFetch(tokenJson({ access_token: "tok", ...expiry }), ok({}), ok({}));
    const api = client();
    await api.getJson("/x");
    vi.setSystemTime(23 * 3600_000 - 1);
    await api.getJson("/x");
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);

    vi.setSystemTime(23 * 3600_000);
    replies.push(tokenJson({ access_token: "tok" }), ok({}));
    await api.getJson("/x");
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(2);
  });

  it("uses expiresIn when expires_in is missing", async () => {
    vi.useFakeTimers({ now: 0 });
    mockFetch(tokenJson({ access_token: "tok", expiresIn: 600 }), ok({}));
    const api = client();
    await api.getJson("/x");
    vi.setSystemTime(540_000);
    replies.push(tokenJson({ access_token: "tok" }), ok({}));
    await api.getJson("/x");
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(2);
  });

  // expires_in: a number, or numeric text with spaces around it; hex, booleans and absurd values fall back
  it.each([
    ["the text 600", "600", 540_000],
    ["the text +600", "+600", 540_000],
    ["the number 600.9", 600.9, 540_000],
    ["the text 600.5", "600.5", 540_000],
    ["the text ' 600 '", " 600 ", 540_000],
    ["the text 6e2", "6e2", 540_000],
    ["the text 0x258", "0x258", 23 * 3600_000],
    ["the boolean true", true, 23 * 3600_000],
    ["the number 1e30", 1e30, 23 * 3600_000],
  ])("reads expires_in given as %s", async (_, expiresIn, renewAt) => {
    vi.useFakeTimers({ now: 0 });
    mockFetch(tokenJson({ access_token: "tok", expires_in: expiresIn }), ok({}));
    const api = client();
    await api.getJson("/x");
    vi.setSystemTime(renewAt - 1);
    replies.push(ok({}));
    await api.getJson("/x");
    vi.setSystemTime(renewAt);
    replies.push(tokenJson({ access_token: "tok" }), ok({}));
    await api.getJson("/x");
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(2);
  });

  it("falls back to expiresIn when expires_in is not a number", async () => {
    vi.useFakeTimers({ now: 0 });
    mockFetch(tokenJson({ access_token: "tok", expires_in: "soon", expiresIn: 600 }), ok({}));
    const api = client();
    await api.getJson("/x");
    vi.setSystemTime(540_000);
    replies.push(tokenJson({ access_token: "tok" }), ok({}));
    await api.getJson("/x");
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(2);
  });

  it("shares one token request between concurrent calls", async () => {
    mockFetch(tokenJson({ access_token: "tok" }), ok({ n: 1 }), ok({ n: 2 }));
    const api = client();
    await Promise.all([api.getJson("/a"), api.getJson("/b")]);
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);
  });

  it("reports a refused key with the status, content type and body", async () => {
    mockFetch({ status: 401, body: "bad key", contentType: "text/plain" });
    await expect(client().getJson("/x")).rejects.toThrow(
      "Token request failed: HTTP 401 (Content-Type: text/plain, body: bad key) - check that the personal API key is valid and not expired",
    );
  });

  it("reports an empty token response", async () => {
    mockFetch({ body: "  ", contentType: "text/plain" });
    await expect(client().getJson("/x")).rejects.toThrow(
      "Token response is empty (Content-Type: text/plain)",
    );
  });

  it("lists the fields of a JSON token response without a token", async () => {
    mockFetch(tokenJson({ foo: 1, bar: "" }));
    await expect(client().getJson("/x")).rejects.toThrow(
      "Token response has no access token field (Content-Type: application/json). Fields: foo bar",
    );
  });

  it("reports a token response that is not valid JSON without quoting it", async () => {
    mockFetch({ body: '{"access_token":tok-secret-value}' });
    const error = await client()
      .getJson("/x")
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(GarminApiError);
    expect((error as Error).message).toBe(
      "Token response is not valid JSON (Content-Type: application/json, 33 characters)",
    );
    expect(String(error)).not.toContain("tok-secret");
  });
});

describe("API key", () => {
  it("reads the key file when the env var is not set, trimmed", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", " ");
    const file = join(mkdtempSync(join(tmpdir(), "garmin-")), "api-key");
    writeFileSync(file, "  file-key\n");
    mockFetch(tokenJson({ access_token: "tok" }), ok({}));
    await client(file).getJson("/x");
    expect(calls[0].headers.authorization).toBe("ApiKey file-key");
  });

  it("prefers the env var over the file, trimmed", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", " env-key ");
    const file = join(mkdtempSync(join(tmpdir(), "garmin-")), "api-key");
    writeFileSync(file, "file-key");
    mockFetch(tokenJson({ access_token: "tok" }), ok({}));
    await client(file).getJson("/x");
    expect(calls[0].headers.authorization).toBe("ApiKey env-key");
  });

  it("says how to provide a missing key", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    mockFetch();
    await expect(client("/nonexistent/api-key").getJson("/x")).rejects.toThrow(
      "No API key: set GARMIN_PERSONAL_API_KEY or create /nonexistent/api-key",
    );
  });

  it("rejects an empty key file", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    const file = join(mkdtempSync(join(tmpdir(), "garmin-")), "api-key");
    writeFileSync(file, " \n");
    mockFetch();
    await expect(client(file).getJson("/x")).rejects.toThrow(`API key file is empty: ${file}`);
  });
});

describe("retries", () => {
  it("drops the token on 401, gets a new one and retries once", async () => {
    mockFetch(
      tokenJson({ access_token: "old" }),
      { status: 401 },
      tokenJson({ access_token: "new" }),
      ok({ ok: true }),
    );
    expect(await client().getJson("/x")).toEqual({ ok: true });
    expect(calls.map((c) => c.headers.authorization)).toEqual([
      `ApiKey ${KEY}`,
      "Bearer old",
      `ApiKey ${KEY}`,
      "Bearer new",
    ]);
  });

  it("gives up after the second 401", async () => {
    mockFetch(
      tokenJson({ access_token: "old" }),
      { status: 401, body: "no" },
      tokenJson({ access_token: "new" }),
      { status: 401, body: "still no" },
    );
    await expect(client().getJson("/x")).rejects.toThrow("GET /x -> HTTP 401: still no");
  });

  it("retries a 406 once with Accept */*", async () => {
    mockFetch(tokenJson({ access_token: "tok" }), { status: 406 }, ok([1]));
    expect(await client().getJson("/x")).toEqual([1]);
    expect(calls.slice(1).map((c) => c.headers.accept)).toEqual(["application/json", "*/*"]);
  });

  it("does not retry a 406 that was already sent with */*", async () => {
    mockFetch(tokenJson({ access_token: "tok" }), { status: 406, body: "nope" });
    await expect(client().getBytes("/file")).rejects.toThrow("GET /file -> HTTP 406: nope");
  });

  it("reports other errors with a body preview of 500 characters", async () => {
    mockFetch(tokenJson({ access_token: "tok" }), { status: 500, body: "e".repeat(600) });
    await expect(client().getJson("/x")).rejects.toThrow(
      `GET /x -> HTTP 500: ${"e".repeat(500)}...`,
    );
  });
});

describe("requests", () => {
  it.each(["x", "/a/../b", "/https://evil.test", ""])("rejects the path %j", async (path) => {
    mockFetch();
    await expect(client().getJson(path)).rejects.toThrow(
      "path must be a relative API path starting with '/'",
    );
  });

  it("drops blank query values and encodes the rest", async () => {
    mockFetch(tokenJson({ access_token: "tok" }), ok({}));
    await client().getJson("/q", { date: "2026-10-27", empty: " ", none: undefined, q: "a b&c" });
    expect(calls[1].url).toBe(`${BASE}/q?date=2026-10-27&q=a+b%26c`);
  });

  it("returns raw bytes with Accept */*", async () => {
    mockFetch(tokenJson({ access_token: "tok" }), { body: "PK\u0003\u0004", contentType: "x" });
    const bytes = await client().getBytes("/download-service/files/activity/1");
    expect(Buffer.from(bytes).toString()).toBe("PK\u0003\u0004");
    expect(calls[1].headers.accept).toBe("*/*");
  });

  it("reports a response that is not JSON", async () => {
    mockFetch(tokenJson({ access_token: "tok" }), { body: "<html>", contentType: "text/html" });
    await expect(client().getJson("/x")).rejects.toThrow("Response is not JSON: <html>");
  });

  it("wraps network errors", async () => {
    mockFetch(tokenJson({ access_token: "tok" }));
    const api = client();
    await api.getJson("/warm").catch(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(api.getJson("/x")).rejects.toThrow("Network error calling /x: fetch failed");
    await expect(api.getJson("/x")).rejects.toBeInstanceOf(GarminApiError);
  });

  it("wraps a network error while reading the body", async () => {
    mockFetch(tokenJson({ access_token: "tok" }));
    const api = client();
    await api.getJson("/warm").catch(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        arrayBuffer: () => Promise.reject(new TypeError("terminated")),
      }),
    );
    await expect(api.getJson("/x")).rejects.toThrow("Network error reading /x: terminated");
    await expect(api.getJson("/x")).rejects.toBeInstanceOf(GarminApiError);
  });

  it("fetches the exercise catalogue without the token", async () => {
    mockFetch(ok({ categories: {} }));
    const body = await client().getExerciseCatalogue();
    expect(JSON.parse(Buffer.from(body).toString())).toEqual({ categories: {} });
    expect(calls[0].url).toBe("https://connect.garmin.com/web-data/exercises/Exercises.json");
    expect(calls[0].headers.authorization).toBeUndefined();
  });

  it("reports a failed exercise catalogue download", async () => {
    mockFetch({ status: 503 });
    await expect(client().getExerciseCatalogue()).rejects.toThrow(
      "GET exercise catalogue -> HTTP 503",
    );
  });

  it("wraps a network error while reading the exercise catalogue body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        arrayBuffer: () => Promise.reject(new TypeError("terminated")),
      }),
    );
    const error = await client()
      .getExerciseCatalogue()
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(GarminApiError);
    expect((error as Error).message).toBe(
      "Network error reading the exercise catalogue: terminated",
    );
  });
});

describe("secrets", () => {
  it("never logs or reports the API key or the token", async () => {
    mockFetch(
      tokenJson({ access_token: "tok-secret", expires_in: 3600 }),
      { status: 401 },
      { body: "plain-secret", contentType: "text/plain" },
      { status: 406 },
      { status: 500, body: "boom" },
    );
    const error = await client()
      .getJson("/x")
      .catch((e: Error) => e);
    const logged = vi
      .mocked(log)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
    for (const secret of [KEY, "tok-secret", "plain-secret"]) {
      expect(logged).not.toContain(secret);
      expect(String(error)).not.toContain(secret);
    }
    expect(logged).toContain("401 from /x");
  });

  it("refuses a key with a line break inside, without showing it", async () => {
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "abc-key\nsecond-line");
    mockFetch();
    const error = await client()
      .getJson("/x")
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(GarminApiError);
    expect((error as Error).message).toMatch(/GARMIN_PERSONAL_API_KEY/);
    expect(String(error)).not.toContain("abc-key");
    expect(String(error)).not.toContain("second-line");
    expect(calls).toEqual([]);
  });

  it("refuses a key file with a second line, naming only the file", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "garmin-key-")), "api-key");
    writeFileSync(file, "abc-key\nnote: my key\n");
    vi.stubEnv("GARMIN_PERSONAL_API_KEY", "");
    mockFetch();
    const error = await client(file)
      .getJson("/x")
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(GarminApiError);
    expect((error as Error).message).toContain(file);
    expect(String(error)).not.toContain("abc-key");
    expect(calls).toEqual([]);
  });

  it("refuses a plain-text token with a line break inside", async () => {
    mockFetch({ body: "tok-a\ntok-b", contentType: "text/plain" });
    const error = await client()
      .getJson("/x")
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(GarminApiError);
    expect(String(error)).not.toContain("tok-a");
    expect(calls).toHaveLength(1);
  });

  it("removes the key and the token from network error messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError(`boom ${KEY}`)));
    await expect(client().getJson("/x")).rejects.toThrow(
      new GarminApiError("Network error obtaining token: boom ***"),
    );

    mockFetch(tokenJson({ access_token: "tok-secret" }), ok({}));
    const api = client();
    await api.getJson("/warm");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("bad tok-secret")));
    await expect(api.getJson("/x")).rejects.toThrow(
      new GarminApiError("Network error calling /x: bad ***"),
    );
  });
});
