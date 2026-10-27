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
    return new Uint8Array(await resp.arrayBuffer());
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
    const body = new Uint8Array(await resp.arrayBuffer());
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
      throw new GarminApiError(`Network error calling ${path}: ${(e as Error).message}`);
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
      throw new GarminApiError(`Network error obtaining token: ${(e as Error).message}`);
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
      this.#token = body.replace(/^"|"$/g, "");
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
    } catch (e) {
      throw new GarminApiError(`Token response is not valid JSON: ${(e as Error).message}`);
    }
    const token = firstText(json, "access_token", "accessToken", "token");
    if (!token) {
      throw new GarminApiError(
        `Token response has no access token field (Content-Type: ${contentType}). Fields: ${Object.keys(json).join(" ")}`,
      );
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

  async #apiKey(): Promise<string> {
    const env = process.env.GARMIN_PERSONAL_API_KEY?.trim();
    if (env) {
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
    return key;
  }
}

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

/** Jackson's asLong: a number within the long range, or text of digits with an optional sign; undefined otherwise. */
function asLong(v: unknown): number | undefined {
  const n =
    typeof v === "number" ? v : typeof v === "string" && /^[+-]?\d+$/.test(v) ? Number(v) : NaN;
  return Math.abs(n) < 2 ** 63 ? Math.trunc(n) : undefined;
}

function preview(body: Uint8Array | string): string {
  const s = typeof body === "string" ? body : new TextDecoder().decode(body);
  return s.length > 500 ? `${s.slice(0, 500)}...` : s;
}
