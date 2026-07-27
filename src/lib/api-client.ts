import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  getApiBaseUrl,
  getSessionCookie,
  setSessionCookie,
} from "@/lib/settings";

/**
 * HTTP layer for the Nexus Tools API.
 *
 * Requests go through `@tauri-apps/plugin-http`, which performs them from the
 * Rust side. Two consequences we rely on:
 *   - no CORS preflight, so the API needs no changes to accept the desktop app;
 *   - we control the `Cookie` header, so the better-auth session can be
 *     replayed from the persisted store.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  get isUnauthorized() {
    return this.status === 401;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Query string parameters; `undefined` / `null` / `""` entries are dropped. */
  params?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Send the persisted session cookie. Defaults to true. */
  authenticated?: boolean;
  /** Capture `Set-Cookie` from the response into the store (sign-in only). */
  captureCookies?: boolean;
};

function buildUrl(
  baseUrl: string,
  path: string,
  params?: RequestOptions["params"],
): string {
  const url = new URL(
    path.startsWith("/") ? path : `/${path}`,
    `${baseUrl}/`,
  );

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

/**
 * Extracts the `name=value` pairs from a `Set-Cookie` header.
 *
 * The header may carry several cookies joined by commas, and each cookie
 * carries attributes (`Path`, `HttpOnly`, `Expires`, ...) we must strip. The
 * comma split is done on `, name=` boundaries so that comma-bearing `Expires`
 * dates ("Mon, 01 Jan ...") are not mistaken for separators.
 */
export function parseSetCookie(setCookieHeader: string): string {
  const cookies = setCookieHeader
    .split(/,\s*(?=[^;=,\s]+=)/)
    .map((chunk) => chunk.split(";")[0].trim())
    .filter((pair) => pair.includes("=") && !pair.endsWith("="));

  return cookies.join("; ");
}

/**
 * Nexus Tools routes answer `{ error }`; better-auth answers `{ message }`.
 */
function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  for (const key of ["error", "message"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }

  return null;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    method = "GET",
    params,
    body,
    authenticated = true,
    captureCookies = false,
  } = options;

  const baseUrl = await getApiBaseUrl();
  const url = buildUrl(baseUrl, path, params);

  const headers: Record<string, string> = { Accept: "application/json" };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (authenticated) {
    const cookie = await getSessionCookie();
    if (cookie) headers["Cookie"] = cookie;
  }

  let response: Response;
  try {
    response = await tauriFetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    throw new ApiError(
      0,
      `Impossible de joindre ${baseUrl}. Vérifiez l'URL de l'API et votre connexion.`,
      cause,
    );
  }

  if (captureCookies) {
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      const cookie = parseSetCookie(setCookie);
      if (cookie) await setSessionCookie(cookie);
    }
  }

  const text = await response.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      extractErrorMessage(payload) ??
      `${method} ${path} a échoué (HTTP ${response.status})`;

    throw new ApiError(response.status, message, payload);
  }

  return payload as T;
}
