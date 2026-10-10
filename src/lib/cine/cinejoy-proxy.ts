/**
 * Server-only CineJoy HLS proxy. Mounted from `server/middleware/cinejoy-proxy.ts`
 * (Nitro global middleware in production builds) and from a dev-server plugin in
 * `vite.config.ts`. Never import this module from client code.
 *
 * Responsibilities:
 *  - Serve `/api/cinejoy/resolve?...` → JSON with a playable, proxied stream URL.
 *  - Serve `/api/cinejoy/hls/<uuid>/<suffix>` → upstream manifests/segments with
 *    the provider-required Origin/Referer headers, rewriting every manifest URI
 *    so hls.js only ever requests same-origin proxied URLs.
 */
import {
  resolvePlayableStream,
  StreamResolveError,
} from "@/lib/cine/stream-resolver.server";

const UPSTREAM_ORIGIN = "https://nebula.bright67.online";
const CINEJOY_ORIGIN = "https://cinejoy.pk";
const APP_PROXY_PREFIX = "/api/cinejoy";
const RESOLVE_PATH = `${APP_PROXY_PREFIX}/resolve`;
const HLS_PATH_PREFIX = `${APP_PROXY_PREFIX}/hls/`;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASSTHROUGH_RESPONSE_HEADERS = [
  "accept-ranges",
  "cache-control",
  "content-length",
  "content-range",
  "etag",
  "last-modified",
];
const UPSTREAM_TIMEOUT_MS = 20_000;

type RewriteContext = { upstreamPrefix: string };

function errorResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function isManifestPath(pathname: string): boolean {
  const leaf = pathname.slice(pathname.lastIndexOf("/") + 1).toLowerCase();
  return leaf.endsWith(".m3u8") || leaf === "playlist.jpg";
}

function safeSuffix(pathname: string, upstreamPrefix: string): string | null {
  if (!pathname.startsWith(upstreamPrefix)) return null;
  const suffix = pathname.slice(upstreamPrefix.length);
  if (
    !suffix ||
    suffix.includes("\\") ||
    suffix.includes("%") ||
    suffix.split("/").some((part) => !part || part === "." || part === ".." || !/^[a-z0-9._-]+$/i.test(part))
  ) {
    return null;
  }
  return suffix;
}

function rewriteResourceUri(
  reference: string,
  upstreamManifest: URL,
  appOrigin: string,
  context: RewriteContext,
): string {
  const target = new URL(reference, upstreamManifest);
  if (target.origin !== UPSTREAM_ORIGIN) {
    throw new Error("Playlist resource is outside the configured HLS host");
  }
  const suffix = safeSuffix(target.pathname, context.upstreamPrefix);
  if (!suffix) throw new Error("Playlist resource is outside the resolved stream path");
  const localUrl = new URL(`${APP_PROXY_PREFIX}/hls/${suffix}`, appOrigin);
  if (target.search) localUrl.search = target.search;
  return localUrl.toString();
}

function rewriteManifest(
  text: string,
  upstreamManifest: URL,
  appOrigin: string,
  context: RewriteContext,
): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
          return `URI="${rewriteResourceUri(uri, upstreamManifest, appOrigin, context)}"`;
        });
      }
      return rewriteResourceUri(trimmed, upstreamManifest, appOrigin, context);
    })
    .join("\n");
}

function proxyContentType(pathname: string, upstreamType: string | null): string {
  if (isManifestPath(pathname)) return "application/vnd.apple.mpegurl";
  const leaf = pathname.slice(pathname.lastIndexOf("/") + 1).toLowerCase();
  if (leaf === "init.mp4" || /\.(jpg|jpeg|png|m4s)$/.test(leaf)) return "video/mp4";
  if (leaf.endsWith(".ts")) return "video/mp2t";
  return upstreamType || "application/octet-stream";
}

async function proxyUpstream(
  request: Request,
  requestUrl: URL,
  upstreamUrl: URL,
  context: RewriteContext,
): Promise<Response> {
  const upstreamHeaders = new Headers({
    Origin: CINEJOY_ORIGIN,
    Referer: `${CINEJOY_ORIGIN}/`,
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });
  for (const header of ["range", "if-range"]) {
    const value = request.headers.get(header);
    if (value) upstreamHeaders.set(header, value);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      redirect: "manual",
      signal: controller.signal,
    });
  } catch {
    return errorResponse("CineJoy upstream fetch failed", 502);
  } finally {
    clearTimeout(timer);
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    return errorResponse("Unexpected upstream redirect", 502);
  }

  const isManifest = isManifestPath(upstreamUrl.pathname);
  const headers = new Headers({
    "content-type": proxyContentType(upstreamUrl.pathname, upstream.headers.get("content-type")),
    "x-content-type-options": "nosniff",
  });
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (isManifest) {
    headers.set("cache-control", "no-store");
    headers.delete("content-length");
    headers.delete("content-range");
  }

  if (request.method === "HEAD" || !upstream.body) {
    return new Response(null, { status: upstream.status, headers });
  }

  if (isManifest && upstream.ok) {
    try {
      let manifest = await upstream.text();
      if (!manifest.trimStart().startsWith("#EXTM3U")) {
        return errorResponse("Upstream response was not an HLS playlist", 502);
      }
      manifest = rewriteManifest(manifest, upstreamUrl, requestUrl.origin, context);
      return new Response(manifest, { status: upstream.status, headers });
    } catch {
      return errorResponse("CineJoy playlist rewrite failed", 502);
    }
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}

function sameOriginGuard(request: Request, requestUrl: URL): Response | null {
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) {
    return errorResponse("Cross-origin requests are not allowed", 403);
  }
  const referer = request.headers.get("referer");
  if (!origin && referer) {
    try {
      if (new URL(referer).origin !== requestUrl.origin) {
        return errorResponse("Cross-origin requests are not allowed", 403);
      }
    } catch {
      return errorResponse("Invalid referrer", 403);
    }
  }
  return null;
}

async function handleResolve(request: Request, requestUrl: URL): Promise<Response> {
  const mediaType = requestUrl.searchParams.get("type");
  const tmdbRaw = requestUrl.searchParams.get("tmdb");
  const title = (requestUrl.searchParams.get("title") ?? "").trim();
  const year = (requestUrl.searchParams.get("year") ?? "").trim();
  const seasonRaw = requestUrl.searchParams.get("season");
  const episodeRaw = requestUrl.searchParams.get("episode");

  if (mediaType !== "movie" && mediaType !== "tv") {
    return errorResponse("Query parameter type must be 'movie' or 'tv'.", 400);
  }
  const tmdbId = Number(tmdbRaw);
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) {
    return errorResponse("A valid numeric TMDb id is required.", 400);
  }
  if (!title || title.length > 180) {
    return errorResponse("A title between 1 and 180 characters is required.", 400);
  }
  if (year && !/^\d{4}$/.test(year)) {
    return errorResponse("Year must be a four-digit number.", 400);
  }
  const season = seasonRaw === null ? undefined : Number(seasonRaw);
  const episode = episodeRaw === null ? undefined : Number(episodeRaw);
  if (mediaType === "tv") {
    if (!Number.isInteger(season) || (season as number) < 1 || (season as number) > 200) {
      return errorResponse("TV resolution requires a valid season number.", 400);
    }
    if (!Number.isInteger(episode) || (episode as number) < 1 || (episode as number) > 1000) {
      return errorResponse("TV resolution requires a valid episode number.", 400);
    }
  }

  try {
    const stream = await resolvePlayableStream({
      mediaType,
      tmdbId,
      title,
      year: year || undefined,
      season,
      episode,
    });
    return jsonResponse(stream);
  } catch (error) {
    if (error instanceof StreamResolveError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("Could not resolve a playable stream for this title.", 502);
  }
}

export async function handleCineJoyProxyRequest(request: Request): Promise<Response | null> {
  const requestUrl = new URL(request.url);
  if (!requestUrl.pathname.startsWith(`${APP_PROXY_PREFIX}/`)) return null;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse("Method not allowed", 405);
  }

  const guard = sameOriginGuard(request, requestUrl);
  if (guard) return guard;

  if (requestUrl.pathname === RESOLVE_PATH || `${requestUrl.pathname}/` === `${RESOLVE_PATH}/`) {
    return handleResolve(request, requestUrl);
  }

  if (requestUrl.pathname.startsWith(HLS_PATH_PREFIX)) {
    const rest = requestUrl.pathname.slice(HLS_PATH_PREFIX.length);
    const slash = rest.indexOf("/");
    const uuid = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
    const suffix = slash === -1 ? "" : rest.slice(slash + 1);
    if (!UUID_PATTERN.test(uuid) || !safeSuffix(`/hls/${uuid}/${suffix}`, `/hls/${uuid}/`)) {
      return errorResponse("Invalid HLS resource path", 404);
    }
    const upstreamPrefix = `/hls/${uuid}/`;
    const upstreamUrl = new URL(`/hls/${uuid}/${suffix}${requestUrl.search}`, UPSTREAM_ORIGIN);
    return proxyUpstream(request, requestUrl, upstreamUrl, { upstreamPrefix });
  }

  return errorResponse("Path not allowed", 404);
}
