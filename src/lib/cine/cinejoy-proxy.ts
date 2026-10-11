import {
  resolvePlayableStream,
  StreamResolveError,
} from "@/lib/cine/stream-resolver.server";

const UPSTREAM_ORIGIN = "https://nebula.bright67.online";
const CINEJOY_ORIGIN = "https://cinejoy.pk";
const APP_PROXY_PREFIX = "/api/cinejoy";
const RESOLVE_PATH = `${APP_PROXY_PREFIX}/resolve`;
const STREAM_PATH = `${APP_PROXY_PREFIX}/stream`;
const HLS_PATH_PREFIX = `${APP_PROXY_PREFIX}/hls/`;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIRECT_MOVIE_PATTERN = /^\/api\/cinejoy\/resolve\/(\d+)\/master\.m3u8$/i;
const DIRECT_TV_PATTERN = /^\/api\/cinejoy\/resolve(?:-tv)?\/(\d+)\/(\d+)\/(\d+)\/master\.m3u8$/i;

const PASSTHROUGH_RESPONSE_HEADERS = [
  "accept-ranges",
  "cache-control",
  "content-length",
  "content-range",
  "etag",
  "last-modified",
];
const UPSTREAM_TIMEOUT_MS = 20_000;

function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "bright67.online" ||
    h.endsWith(".bright67.online") ||
    h === "cheaptruckrepairs.cc" ||
    h.endsWith(".cheaptruckrepairs.cc") ||
    h === "cursed.st" ||
    h.endsWith(".cursed.st") ||
    h === "wing.st" ||
    h.endsWith(".wing.st") ||
    h === "cinejoy.pk" ||
    h.endsWith(".cinejoy.pk")
  );
}

function errorResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": "*",
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
      "access-control-allow-origin": "*",
    },
  });
}

function isManifest(pathname: string, contentType: string | null): boolean {
  const leaf = pathname.slice(pathname.lastIndexOf("/") + 1).toLowerCase();
  if (leaf.endsWith(".m3u8") || leaf === "playlist.jpg") return true;
  if (contentType && contentType.toLowerCase().includes("mpegurl")) return true;
  return false;
}

function rewriteHlsManifest(
  manifestText: string,
  manifestBaseUrl: URL,
  appOrigin: string
): string {
  return manifestText
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (orig, rawUri: string) => {
          try {
            const resolved = new URL(rawUri, manifestBaseUrl);
            if (isAllowedHost(resolved.hostname)) {
              const proxied = new URL(STREAM_PATH, appOrigin);
              proxied.searchParams.set("url", resolved.toString());
              return `URI="${proxied.toString()}"`;
            }
          } catch {}
          return orig;
        });
      }

      try {
        const resolved = new URL(trimmed, manifestBaseUrl);
        if (isAllowedHost(resolved.hostname)) {
          const proxied = new URL(STREAM_PATH, appOrigin);
          proxied.searchParams.set("url", resolved.toString());
          return proxied.toString();
        }
      } catch {}

      return line;
    })
    .join("\n");
}

async function handleStreamProxy(request: Request, requestUrl: URL): Promise<Response> {
  const targetRaw = requestUrl.searchParams.get("url");
  if (!targetRaw) {
    return errorResponse("Missing url parameter", 400);
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(targetRaw);
  } catch {
    return errorResponse("Invalid target URL", 400);
  }

  if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") {
    return errorResponse("Invalid protocol", 400);
  }

  if (!isAllowedHost(targetUrl.hostname)) {
    return errorResponse("Host not permitted", 403);
  }

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

  let currentTarget = targetUrl;
  let hops = 0;
  let upstream: Response | null = null;

  while (hops < 3) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      upstream = await fetch(currentTarget, {
        method: request.method,
        headers: upstreamHeaders,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch {
      return errorResponse("CineJoy upstream stream fetch failed", 502);
    } finally {
      clearTimeout(timer);
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      const loc = upstream.headers.get("location");
      if (!loc) {
        return errorResponse("Upstream redirect missing Location", 502);
      }
      try {
        const nextTarget = new URL(loc, currentTarget);
        if (!isAllowedHost(nextTarget.hostname)) {
          return errorResponse("Redirect to unauthorized host", 403);
        }
        currentTarget = nextTarget;
        hops++;
        continue;
      } catch {
        return errorResponse("Invalid redirect location", 502);
      }
    }

    break;
  }

  if (!upstream) {
    return errorResponse("Upstream fetch failed", 502);
  }

  const contentType = upstream.headers.get("content-type");
  const isM3u8 = isManifest(currentTarget.pathname, contentType);

  const responseHeaders = new Headers({
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "Range, Content-Type, Accept",
    "access-control-expose-headers": "Content-Length, Content-Range, Accept-Ranges",
    "x-content-type-options": "nosniff",
  });

  for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }

  if (isM3u8) {
    responseHeaders.set("content-type", "application/vnd.apple.mpegurl");
    responseHeaders.set("cache-control", "no-store");
    responseHeaders.delete("content-length");
    responseHeaders.delete("content-range");
  } else if (!responseHeaders.has("content-type") && contentType) {
    responseHeaders.set("content-type", contentType);
  }

  if (request.method === "HEAD" || !upstream.body) {
    return new Response(null, { status: upstream.status, headers: responseHeaders });
  }

  if (isM3u8 && upstream.ok) {
    try {
      let manifest = await upstream.text();
      if (!manifest.trimStart().startsWith("#EXTM3U")) {
        return errorResponse("Upstream response was not an HLS playlist", 502);
      }
      manifest = rewriteHlsManifest(manifest, currentTarget, requestUrl.origin);
      return new Response(manifest, { status: upstream.status, headers: responseHeaders });
    } catch {
      return errorResponse("CineJoy playlist rewrite failed", 502);
    }
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

function sameOriginGuard(request: Request, requestUrl: URL): Response | null {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (
        originHost !== requestUrl.host &&
        !originHost.endsWith(".vercel.app") &&
        !originHost.includes("localhost") &&
        !originHost.includes("127.0.0.1")
      ) {
        return errorResponse("Cross-origin requests are not allowed", 403);
      }
    } catch {
      return errorResponse("Invalid origin", 403);
    }
  }
  const referer = request.headers.get("referer");
  if (!origin && referer) {
    try {
      const refererHost = new URL(referer).host;
      if (
        refererHost !== requestUrl.host &&
        !refererHost.endsWith(".vercel.app") &&
        !refererHost.includes("localhost") &&
        !refererHost.includes("127.0.0.1")
      ) {
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
  const server = (requestUrl.searchParams.get("server") ?? "").trim() || undefined;

  if (mediaType !== "movie" && mediaType !== "tv") {
    return errorResponse("Query parameter type must be movie or tv.", 400);
  }
  const tmdbId = Number(tmdbRaw);
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) {
    return errorResponse("A valid numeric TMDb id is required.", 400);
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
      title: title || (mediaType === "tv" ? "TV Series" : "Movie"),
      year: year || undefined,
      season,
      episode,
      server,
    });
    return jsonResponse(stream);
  } catch (error) {
    if (error instanceof StreamResolveError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("Could not resolve a playable stream for this title.", 502);
  }
}

async function handleDirectMovie(requestUrl: URL, match: RegExpMatchArray): Promise<Response> {
  const tmdbId = Number(match[1]);
  const title = (requestUrl.searchParams.get("title") ?? "").trim() || "Movie";
  const year = (requestUrl.searchParams.get("year") ?? "").trim() || undefined;
  const server = (requestUrl.searchParams.get("server") ?? "").trim() || undefined;

  try {
    const stream = await resolvePlayableStream({
      mediaType: "movie",
      tmdbId,
      title,
      year,
      server,
    });
    return Response.redirect(new URL(stream.src, requestUrl.origin), 307);
  } catch (error) {
    if (error instanceof StreamResolveError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("Could not resolve a playable stream for this movie.", 502);
  }
}

async function handleDirectTv(requestUrl: URL, match: RegExpMatchArray): Promise<Response> {
  const tmdbId = Number(match[1]);
  const season = Number(match[2]);
  const episode = Number(match[3]);
  const title = (requestUrl.searchParams.get("title") ?? "").trim() || "TV Series";
  const server = (requestUrl.searchParams.get("server") ?? "").trim() || undefined;

  try {
    const stream = await resolvePlayableStream({
      mediaType: "tv",
      tmdbId,
      title,
      season,
      episode,
      server,
    });
    return Response.redirect(new URL(stream.src, requestUrl.origin), 307);
  } catch (error) {
    if (error instanceof StreamResolveError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("Could not resolve a playable stream for this episode.", 502);
  }
}

export async function handleCineJoyProxyRequest(request: Request): Promise<Response | null> {
  const requestUrl = new URL(request.url);
  if (!requestUrl.pathname.startsWith(`${APP_PROXY_PREFIX}/`)) return null;

  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
    return errorResponse("Method not allowed", 405);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "access-control-allow-headers": "Range, Content-Type, Accept",
      },
    });
  }

  const guard = sameOriginGuard(request, requestUrl);
  if (guard) return guard;

  if (requestUrl.pathname === RESOLVE_PATH || `${requestUrl.pathname}/` === `${RESOLVE_PATH}/`) {
    return handleResolve(request, requestUrl);
  }

  if (requestUrl.pathname === STREAM_PATH || `${requestUrl.pathname}/` === `${STREAM_PATH}/`) {
    return handleStreamProxy(request, requestUrl);
  }

  const directMovieMatch = requestUrl.pathname.match(DIRECT_MOVIE_PATTERN);
  if (directMovieMatch) {
    return handleDirectMovie(requestUrl, directMovieMatch);
  }

  const directTvMatch = requestUrl.pathname.match(DIRECT_TV_PATTERN);
  if (directTvMatch) {
    return handleDirectTv(requestUrl, directTvMatch);
  }

  // Legacy UUID route compatibility
  if (requestUrl.pathname.startsWith(HLS_PATH_PREFIX)) {
    const rest = requestUrl.pathname.slice(HLS_PATH_PREFIX.length);
    const slash = rest.indexOf("/");
    const uuid = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
    const suffix = slash === -1 ? "" : rest.slice(slash + 1);
    if (!UUID_PATTERN.test(uuid)) {
      return errorResponse("Invalid HLS resource path", 404);
    }
    const upstreamUrl = new URL(`/hls/${uuid}/${suffix}${requestUrl.search}`, UPSTREAM_ORIGIN);
    const proxyUrl = new URL(STREAM_PATH, requestUrl.origin);
    proxyUrl.searchParams.set("url", upstreamUrl.toString());
    return Response.redirect(proxyUrl, 307);
  }

  return errorResponse("Path not allowed", 404);
}
