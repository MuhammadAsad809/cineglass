import { createHash } from "node:crypto";

const API_ORIGIN = "https://h5-api.aoneroom.com";
const API_PREFIX = "/wefeed-h5api-bff";
const ROUTE_PREFIX = "/api/aoneroom/";
const SESSION_COOKIE = "aoneroom_session";
const MAX_BODY_BYTES = 32 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

interface RouteSpec {
  method: "GET" | "POST";
  query: readonly string[];
}

/** Only the H5 catalog/detail/play routes needed by the app are exposed. */
const ROUTES: Record<string, RouteSpec> = {
  home: { method: "GET", query: ["host"] },
  "tab/get-bottom-tab-list": { method: "GET", query: [] },
  "subject/trending": { method: "GET", query: ["page", "perPage", "tabId"] },
  "subject/search": { method: "POST", query: [] },
  "subject/filter": { method: "POST", query: [] },
  detail: { method: "GET", query: ["subjectId"] },
  "subject/play": {
    method: "GET",
    query: ["subjectId", "se", "ep", "detailPath", "resolution", "quality"],
  },
  "subject/detail-rec": { method: "GET", query: ["subjectId", "page", "perPage"] },
  "subject/everyone-search": { method: "GET", query: ["keyword", "page", "perPage"] },
  "ranking-list/content": { method: "GET", query: ["rankingId", "page", "perPage"] },
  "tab-operating": { method: "GET", query: ["tabId", "page", "perPage"] },
  "media-player/get-domain": { method: "GET", query: [] },
  "subject/caption": { method: "GET", query: ["subjectId", "resourceId", "se", "ep"] },
  "ad/get-config": { method: "GET", query: [] },
  "app/get-latest-app-pkgs": { method: "GET", query: ["appName"] },
};

function jsonError(status: number, message: string, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function makeClientToken(): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const digest = createHash("md5").update([...timestamp].reverse().join("")).digest("hex");
  return `${timestamp},${digest}`;
}

function sessionFromCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    try {
      const value = decodeURIComponent(part.slice(separator + 1).trim());
      return value.length > 0 && value.length <= 4096 ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

function sessionFromUpstreamHeader(value: string | null): string | null {
  if (!value || value.length > 8192) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || !("token" in parsed)) return null;
    const token = (parsed as { token?: unknown }).token;
    return typeof token === "string" && token.length > 0 && token.length <= 4096 ? token : null;
  } catch {
    return null;
  }
}

function sessionCookie(token: string, requestUrl: URL): string {
  const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestUrl.host);
  const secure = requestUrl.protocol === "https:" || !isLocal;
  const sameSite = secure ? "None" : "Lax";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=1800; Path=/api/aoneroom; HttpOnly; SameSite=${sameSite}${secure ? "; Secure" : ""}`;
}

function isSameOriginRequest(request: Request, requestUrl: URL): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === requestUrl.origin;
  } catch {
    return false;
  }
}

/**
 * Same-origin proxy for the public AoneRoom H5 API. This is a transport/CORS
 * proxy only: it does not sign the separate V3 mobile API or invent media URLs.
 */
export async function handleAoneRoomProxyRequest(request: Request): Promise<Response | null> {
  const requestUrl = new URL(request.url);
  if (!requestUrl.pathname.startsWith(ROUTE_PREFIX)) return null;
  if (!isSameOriginRequest(request, requestUrl)) {
    return jsonError(403, "Cross-origin requests are not allowed");
  }

  let endpoint: string;
  try {
    endpoint = decodeURIComponent(requestUrl.pathname.slice(ROUTE_PREFIX.length));
  } catch {
    return jsonError(400, "Invalid API path");
  }
  const route = ROUTES[endpoint];
  if (!route) return jsonError(404, "AoneRoom API route is not allowlisted");

  const method = request.method.toUpperCase();
  if (method !== route.method) {
    return jsonError(405, "Method not allowed", { allow: route.method });
  }

  const upstreamUrl = new URL(`${API_PREFIX}/${endpoint}`, API_ORIGIN);
  const seen = new Set<string>();
  for (const [key, value] of requestUrl.searchParams) {
    if (!route.query.includes(key) || seen.has(key)) {
      return jsonError(400, "Unsupported or repeated query parameter");
    }
    if (value.length > 2048 || hasControlCharacters(value)) {
      return jsonError(400, "Invalid query parameter");
    }
    seen.add(key);
    upstreamUrl.searchParams.set(key, value);
  }

  let body: string | undefined;
  if (method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonError(415, "JSON request bodies are required");
    }
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_BODY_BYTES) return jsonError(413, "Request body too large");
    body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return jsonError(413, "Request body too large");
    }
    try {
      const value: unknown = JSON.parse(body);
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return jsonError(400, "A JSON object is required");
      }
    } catch {
      return jsonError(400, "Invalid JSON body");
    }
  }

  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
    "user-agent":
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    origin: "https://moviebox.ph",
    referer: "https://moviebox.ph/",
    "x-request-lang": "en",
    "x-client-info": JSON.stringify({ timezone: "UTC" }),
    "x-client-token": makeClientToken(),
  });
  const session = sessionFromCookie(request);
  if (session) headers.set("authorization", `Bearer ${session}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body,
      redirect: "follow",
      signal: controller.signal,
    });
  } catch {
    return jsonError(502, "AoneRoom API request failed");
  } finally {
    clearTimeout(timeout);
  }

  const responseHeaders = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  const nextSession = sessionFromUpstreamHeader(upstream.headers.get("x-user"));
  if (nextSession) responseHeaders.append("set-cookie", sessionCookie(nextSession, requestUrl));
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) responseHeaders.set("retry-after", retryAfter);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
