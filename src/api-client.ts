import { readFile } from "node:fs/promises";
import type { Config } from "./config";
import { log } from "./log";

const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";
const EXERCISE_CATALOGUE_URL = "https://connect.garmin.com/web-data/exercises/Exercises.json";
/** Re-obtain the token a bit before the documented 24h validity. */
const DEFAULT_TOKEN_TTL_MS = 23 * 3600_000;

export class GarminApiError extends Error {
  override name = "GarminApiError";
}

/**
 * Minimal client for the Garmin Connect Personal API.
 *
 * Flow: personal API key -> POST token endpoint -> OAuth2 access token (valid 24h, no refresh token)
 * -> "Authorization: Bearer ..." on every call. The token is kept in memory and re-obtained when it
 * expires or when a call answers 401. Neither the key nor the token is ever logged or returned.
 */
export class GarminApiClient {
  #token: string | undefined;
  #expiresAt = 0;
  #pending: Promise<string> | undefined;

  constructor(private readonly config: Config) {}

  /** GET a JSON resource. `path` must start with "/" (e.g. "/hrv-service/hrv/2026-10-25"). */
  async getJson(path: string, query: Record<string, string | undefined> = {}): Promise<unknown> {
    const body = await this.#get(path, query, "application/json");
    try {
      return JSON.parse(new TextDecoder().decode(body));
    } catch {
      throw new GarminApiError(`Response is not JSON: ${preview(body)}`);
    }
  }

  /** GET a binary resource (e.g. activity file download). */
  getBytes(path: string, query: Record<string, string | undefined> = {}): Promise<Uint8Array> {
    return this.#get(path, query, "*/*");
  }

  /**
   * GET Garmin's exercise catalogue (primary and secondary muscles per exercise), a public static
   * file of the Garmin Connect web app. Sent without the token: it is another host and needs none.
   */
  async getExerciseCatalogue(): Promise<Uint8Array> {
    let resp: Response;
    try {
      resp = await fetch(EXERCISE_CATALOGUE_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new GarminApiError(
        `Network error reading the exercise catalogue: ${(e as Error).message}`,
      );
    }
    if (!resp.ok) {
      throw new GarminApiError(`GET exercise catalogue -> HTTP ${resp.status}`);
    }
    try {
      return new Uint8Array(await resp.arrayBuffer());
    } catch (e) {
      throw new GarminApiError(
        `Network error reading the exercise catalogue: ${(e as Error).message}`,
      );
    }
  }

  async #get(
    path: string,
    query: Record<string, string | undefined>,
    accept: string,
  ): Promise<Uint8Array> {
    if (!path.startsWith("/") || path.includes("://") || path.includes("..")) {
      throw new Error("path must be a relative API path starting with '/'");
    }
    const url = this.config.baseUrl + path + toQueryString(query);
    let resp = await this.#send(url, path, accept);
    if (resp.status === 401) {
      log("INFO", `401 from ${path}, refreshing token and retrying once`);
      this.#token = undefined;
      resp = await this.#send(url, path, accept);
    }
    if (resp.status === 406 && accept !== "*/*") {
      log("INFO", `406 from ${path} with Accept ${accept}, retrying with */*`);
      resp = await this.#send(url, path, "*/*");
    }
    let body: Uint8Array;
    try {
      body = new Uint8Array(await resp.arrayBuffer());
    } catch (e) {
      throw new GarminApiError(`Network error reading ${path}: ${(e as Error).message}`);
    }
    if (!resp.ok) {
      throw new GarminApiError(`GET ${path} -> HTTP ${resp.status}: ${preview(body)}`);
    }
    return body;
  }

  async #send(url: string, path: string, accept: string): Promise<Response> {
    const token = await this.#accessToken();
    try {
      return await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: accept },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new GarminApiError(
        `Network error calling ${path}: ${this.#scrub((e as Error).message, token)}`,
      );
    }
  }

  /** The cached token, or a new one; concurrent callers share one token request. */
  #accessToken(): Promise<string> {
    if (this.#token && Date.now() < this.#expiresAt) {
      return Promise.resolve(this.#token);
    }
    this.#pending ??= this.#requestToken().finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  async #requestToken(): Promise<string> {
    const apiKey = await this.#apiKey();
    let resp: Response;
    let text: string;
    try {
      resp = await fetch(this.config.baseUrl + TOKEN_PATH, {
        method: "POST",
        headers: { Authorization: `ApiKey ${apiKey}`, Accept: "*/*" },
        signal: AbortSignal.timeout(30_000),
      });
      text = await resp.text();
    } catch (e) {
      throw new GarminApiError(
        `Network error obtaining token: ${this.#scrub((e as Error).message, apiKey)}`,
      );
    }
    const contentType = resp.headers.get("Content-Type") ?? "none";
    if (!resp.ok) {
      throw new GarminApiError(
        `Token request failed: HTTP ${resp.status} (Content-Type: ${contentType}, body: ` +
          `${preview(text)}) - check that the personal API key is valid and not expired`,
      );
    }
    const body = text.trim();
    if (!body) {
      throw new GarminApiError(`Token response is empty (Content-Type: ${contentType})`);
    }
    if (!body.startsWith("{")) {
      // Plain-text token, possibly wrapped in quotes
      const plain = body.replace(/^"|"$/g, "");
      if (!isHeaderSafe(plain)) {
        throw new GarminApiError(`Token response is not a token (Content-Type: ${contentType})`);
      }
      this.#token = plain;
      this.#expiresAt = Date.now() + DEFAULT_TOKEN_TTL_MS;
      log(
        "INFO",
        `Obtained Garmin access token (plain text, ${contentType}), valid until ${new Date(this.#expiresAt).toISOString()}`,
      );
      return this.#token;
    }
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(body);
    } catch {
      // the parse message quotes the text around the error, which can be part of the token
      throw new GarminApiError(
        `Token response is not valid JSON (Content-Type: ${contentType}, ${body.length} characters)`,
      );
    }
    const token = firstText(json, "access_token", "accessToken", "token");
    if (!token) {
      throw new GarminApiError(
        `Token response has no access token field (Content-Type: ${contentType}). Fields: ${Object.keys(json).join(" ")}`,
      );
    }
    if (!isHeaderSafe(token)) {
      throw new GarminApiError(`Token response is not a token (Content-Type: ${contentType})`);
    }
    const expiresIn = asLong(json.expires_in) ?? asLong(json.expiresIn) ?? 0;
    this.#token = token;
    this.#expiresAt =
      Date.now() + (expiresIn > 120 ? (expiresIn - 60) * 1000 : DEFAULT_TOKEN_TTL_MS);
    log(
      "INFO",
      `Obtained Garmin access token, valid until ${new Date(this.#expiresAt).toISOString()}`,
    );
    return token;
  }

  /** The text of a fetch error without the key or the token: some fetch errors quote a header. */
  #scrub(message: string, ...secrets: (string | undefined)[]): string {
    return secrets.reduce<string>((m, s) => (s ? m.replaceAll(s, "***") : m), message);
  }

  async #apiKey(): Promise<string> {
    const env = process.env.GARMIN_PERSONAL_API_KEY?.trim();
    if (env) {
      if (!isHeaderSafe(env)) {
        throw new GarminApiError(
          "GARMIN_PERSONAL_API_KEY has spaces, line breaks or other characters that a key cannot have",
        );
      }
      return env;
    }
    const file = this.config.apiKeyFile;
    let key: string;
    try {
      key = (await readFile(file, "utf8")).trim();
    } catch {
      throw new GarminApiError(`No API key: set GARMIN_PERSONAL_API_KEY or create ${file}`);
    }
    if (!key) {
      throw new GarminApiError(`API key file is empty: ${file}`);
    }
    if (!isHeaderSafe(key)) {
      throw new GarminApiError(
        `The API key file has more than the key (spaces, line breaks or other characters): ${file}`,
      );
    }
    return key;
  }
}

/** A key or token is printable ASCII without spaces; anything else would break the header and show in fetch's error. */
const isHeaderSafe = (s: string) => /^[\x21-\x7e]+$/.test(s);

function toQueryString(query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v.trim()) {
      params.append(k, v);
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function firstText(json: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = json[n];
    if (typeof v === "string" && v.trim()) {
      return v;
    }
  }
  return undefined;
}

/** A number or numeric text (spaces around it allowed), without its decimals; undefined otherwise or when absurd. */
function asLong(v: unknown): number | undefined {
  const numeric = typeof v === "string" && /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(v);
  const n = Math.trunc(typeof v === "number" ? v : numeric ? Number(v) : NaN);
  return Number.isSafeInteger(n) ? n : undefined;
}

function preview(body: Uint8Array | string): string {
  const s = typeof body === "string" ? body : new TextDecoder().decode(body);
  return s.length > 500 ? `${s.slice(0, 500)}...` : s;
}
