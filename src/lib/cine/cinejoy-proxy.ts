import type { Browser } from "playwright";

const UPSTREAM_ORIGIN = "https://nebula.bright67.online";
const CINEJOY_ORIGIN = "https://cinejoy.pk";
const APP_PROXY_PREFIX = "/api/cinejoy";
const FIXED_STREAM_PREFIX = "/hls/eeea82d4-605b-4469-a754-f19d1c443ad6/";
const CACHE_TTL_MS = 10 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASSTHROUGH_RESPONSE_HEADERS = [
  "accept-ranges",
  "cache-control",
  "content-length",
  "content-range",
  "etag",
  "last-modified",
];

type ResolvedStream = { uuid: string; expiresAt: number };
type RewriteContext = {
  upstreamPrefix: string;
  movieId?: string;
  title?: string;
  year?: string;
};

const resolvedStreams = new Map<string, ResolvedStream>();
const inFlightResolutions = new Map<string, Promise<string>>();
let browserPromise: Promise<Browser> | undefined;

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

function isManifestPath(pathname: string): boolean {
  const leaf = pathname.slice(pathname.lastIndexOf("/") + 1).toLowerCase();
  return leaf.endsWith(".m3u8") || leaf === "playlist.jpg";
}

function safeManifestSuffix(pathname: string, upstreamPrefix: string): string | null {
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
  const suffix = safeManifestSuffix(target.pathname, context.upstreamPrefix);
  if (!suffix) throw new Error("Playlist resource is outside the resolved stream path");

  const localPath = context.movieId
    ? `${APP_PROXY_PREFIX}/resolve/${context.movieId}/${suffix}`
    : `${APP_PROXY_PREFIX}${target.pathname}`;
  const localUrl = new URL(localPath, appOrigin);
  const query = new URLSearchParams();
  if (context.title) query.set("title", context.title);
  if (context.year) query.set("year", context.year);
  if (target.search) query.set("sourceSearch", target.search);
  localUrl.search = query.toString();
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

function titleSlug(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright");
      return chromium.launch({
        headless: true,
        executablePath: process.env.CINEJOY_CHROMIUM_PATH || "/usr/bin/chromium",
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    })().catch((error) => {
      browserPromise = undefined;
      throw error;
    });
  }
  return browserPromise;
}

async function scrapeStreamUuid(movieId: string, title: string, year: string): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({ locale: "en-US" });
  let resolveDetected!: (uuid: string) => void;
  const detectedUuid = new Promise<string>((resolve) => {
    resolveDetected = resolve;
  });
  try {
    await context.route("**/*", async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      const masterMatch =
        requestUrl.origin === UPSTREAM_ORIGIN &&
        requestUrl.pathname.match(/^\/hls\/([0-9a-f-]{36})\/master\.m3u8$/i);
      if (masterMatch && UUID_PATTERN.test(masterMatch[1])) {
        resolveDetected(masterMatch[1]);
        await route.abort();
        return;
      }
      if (
        requestUrl.origin === UPSTREAM_ORIGIN &&
        requestUrl.pathname.startsWith("/hls/")
      ) {
        await route.abort();
        return;
      }
      if (
        request.resourceType() === "media" ||
        ["a.wing.st", "trailer.wing.st", "server.wing.st", "subs.wing.st", "imdb.wing.st"].includes(
          requestUrl.hostname,
        )
      ) {
        await route.abort();
        return;
      }
      await route.continue();
    });

    const page = await context.newPage();
    page.on("popup", (popup) => {
      void popup.close().catch(() => undefined);
    });
    const slug = titleSlug(title);
    const yearSuffix = /^\d{4}$/.test(year) ? `-${year}` : "";
    const titleUrl = `${CINEJOY_ORIGIN}/movie/${movieId}-${slug}${yearSuffix}`;
    await page.goto(titleUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
    const playButton = page.getByRole("button", { name: /^Play$/i }).first();
    await playButton.waitFor({ state: "visible", timeout: 15_000 });
    await playButton.click({ timeout: 10_000 });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("CineJoy did not expose a playable stream")), 25_000);
    });
    try {
      const uuid = await Promise.race([detectedUuid, timeout]);
      return uuid;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function resolveStreamUuid(movieId: string, title: string, year: string): Promise<string> {
  const cached = resolvedStreams.get(movieId);
  if (cached && cached.expiresAt > Date.now()) return cached.uuid;
  const pending = inFlightResolutions.get(movieId);
  if (pending) return pending;

  const promise = scrapeStreamUuid(movieId, title, year)
    .then((uuid) => {
      resolvedStreams.set(movieId, { uuid, expiresAt: Date.now() + CACHE_TTL_MS });
      return uuid;
    })
    .finally(() => inFlightResolutions.delete(movieId));
  inFlightResolutions.set(movieId, promise);
  return promise;
}

function validateSourceSearch(value: string | null): string {
  if (!value) return "";
  if (!value.startsWith("?") || value.length > 2_000 || /[\r\n]/.test(value)) {
    throw new Error("Invalid upstream query");
  }
  return value;
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
  });
  for (const header of ["range", "if-range"]) {
    const value = request.headers.get(header);
    if (value) upstreamHeaders.set(header, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      redirect: "manual",
    });
  } catch {
    return errorResponse("CineJoy upstream fetch failed", 502);
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

export async function handleCineJoyProxyRequest(request: Request): Promise<Response | null> {
  const requestUrl = new URL(request.url);
  if (!requestUrl.pathname.startsWith(`${APP_PROXY_PREFIX}/`)) return null;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse("Method not allowed", 405);
  }

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

  const dynamicPrefix = `${APP_PROXY_PREFIX}/resolve/`;
  if (requestUrl.pathname.startsWith(dynamicPrefix)) {
    const match = requestUrl.pathname.slice(dynamicPrefix.length).match(/^(\d{1,12})\/(.+)$/);
    if (!match) return errorResponse("Invalid CineJoy movie route", 404);
    const [, movieId, suffix] = match;
    if (
      suffix.includes("\\") ||
      suffix.includes("%") ||
      suffix.split("/").some((part) => !part || part === "." || part === ".." || !/^[a-z0-9._-]+$/i.test(part))
    ) {
      return errorResponse("Invalid HLS resource path", 404);
    }

    const title = (requestUrl.searchParams.get("title") ?? "").trim();
    const year = (requestUrl.searchParams.get("year") ?? "").trim();
    if (!title || title.length > 180 || (year && !/^\d{4}$/.test(year))) {
      return errorResponse("Movie title and year are required to resolve CineJoy", 400);
    }

    try {
      const uuid = await resolveStreamUuid(movieId, title, year);
      const upstreamPrefix = `/hls/${uuid}/`;
      const sourceSearch = validateSourceSearch(requestUrl.searchParams.get("sourceSearch"));
      const upstreamUrl = new URL(`${upstreamPrefix}${suffix}${sourceSearch}`, UPSTREAM_ORIGIN);
      return proxyUpstream(request, requestUrl, upstreamUrl, {
        upstreamPrefix,
        movieId,
        title,
        year,
      });
    } catch {
      return errorResponse("CineJoy could not resolve a stream for this movie", 404);
    }
  }

  const staticPath = requestUrl.pathname.slice(APP_PROXY_PREFIX.length);
  if (
    !staticPath.startsWith(FIXED_STREAM_PREFIX) ||
    staticPath.includes("\\") ||
    staticPath.includes("%") ||
    staticPath.split("/").includes("..")
  ) {
    return errorResponse("Path not allowed", 404);
  }
  const upstreamUrl = new URL(`${staticPath}${requestUrl.search}`, UPSTREAM_ORIGIN);
  return proxyUpstream(request, requestUrl, upstreamUrl, {
    upstreamPrefix: FIXED_STREAM_PREFIX,
  });
}
