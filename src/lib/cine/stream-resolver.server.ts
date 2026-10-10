/**
 * Server-only stream resolver for CineGlass.
 *
 * Resolves a TMDB movie / TV episode to a playable HLS master playlist on the
 * configured provider (CineJoy's nebula HLS host) and returns URLs that are
 * served through the app's own proxy (`/api/cinejoy/...`), so the browser never
 * talks to the provider directly and required Referer headers can be attached
 * server-side.
 *
 * Two resolution paths:
 *  1. HTTP-first (works on Vercel): fetches the provider's watch page and
 *     extracts the `/hls/<uuid>/master.m3u8` reference with a regex — no
 *     browser automation needed.
 *  2. Browser fallback (self-hosted only, where a Chromium binary exists):
 *     drives the page with Playwright via `CINEJOY_CHROMIUM_PATH`, intercepting
 *     the master playlist request. Enabled by setting `CINEJOY_ALLOW_BROWSER=1`.
 *
 * Nothing in this module may ever be imported from client code.
 */

const UPSTREAM_ORIGIN = "https://nebula.bright67.online";
const CINEJOY_ORIGIN = "https://cinejoy.pk";
const APP_PROXY_PREFIX = "/api/cinejoy";

const CACHE_TTL_MS = 10 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const FETCH_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MASTER_HLS_PATTERN =
  /\/hls\/([0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})\/master\.m3u8/gi;

export class StreamResolveError extends Error {
  readonly status: number;
  constructor(message: string, status = 404) {
    super(message);
    this.name = "StreamResolveError";
    this.status = status;
  }
}

/** Minimal structural types for the optional playwright browser fallback. */
type PlaywrightRoute = {
  request(): { url(): string; resourceType(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
};
type PlaywrightPage = {
  on(event: "popup", handler: (popup: { close(): Promise<void> }) => void): void;
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<void>;
  getByRole(role: string, options: { name: RegExp }): {
    first(): {
      waitFor(options: { state: string; timeout: number }): Promise<void>;
      click(options: { timeout: number }): Promise<void>;
    };
  };
};
type PlaywrightContext = {
  route(pattern: string, handler: (route: PlaywrightRoute) => Promise<void>): Promise<void>;
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
};
type PlaywrightBrowser = {
  newContext(options: Record<string, unknown>): Promise<PlaywrightContext>;
  close(): Promise<void>;
};
type PlaywrightChromium = {
  launch(options: Record<string, unknown>): Promise<PlaywrightBrowser>;
};

export type ResolvedStream = {
  kind: "hls";
  /** App-relative proxied master playlist URL (safe to hand to hls.js). */
  src: string;
  /** Proxied path prefix used to validate every manifest/segment URL. */
  proxyPrefix: string;
  cacheKey: string;
};

type CacheEntry = { uuid: string; expiresAt: number };

const uuidCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string>>();

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

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function buildProviderPagePath(input: {
  mediaType: "movie" | "tv";
  tmdbId: number;
  title: string;
  year?: string;
  season?: number;
  episode?: number;
}): string {
  const slug = titleSlug(input.title);
  if (input.mediaType === "tv") {
    if (!Number.isInteger(input.season) || !Number.isInteger(input.episode)) {
      throw new StreamResolveError("TV playback requires a season and episode number.", 400);
    }
    return `/tv/${input.tmdbId}-${slug}/${input.season}/${input.episode}`;
  }
  const yearSuffix = /^\d{4}$/.test(input.year ?? "") ? `-${input.year}` : "";
  return `/movie/${input.tmdbId}-${slug}${yearSuffix}`;
}

function extractMasterUuids(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(MASTER_HLS_PATTERN)) {
    const uuid = match[1]!.toLowerCase();
    if (UUID_PATTERN.test(uuid) && !found.includes(uuid)) found.push(uuid);
  }
  return found;
}

async function fetchProviderHtml(pageUrl: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(pageUrl, {
      headers: {
        "User-Agent": FETCH_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (response.status === 404) {
      throw new StreamResolveError("This title is not available on the provider.", 404);
    }
    if (!response.ok) {
      throw new StreamResolveError(`Provider returned HTTP ${response.status}.`, 502);
    }
    return await response.text();
  } catch (error) {
    if (error instanceof StreamResolveError) throw error;
    if (controller.signal.aborted) {
      throw new StreamResolveError("The provider did not respond in time. Try again shortly.", 504);
    }
    throw new StreamResolveError("Could not reach the provider. Try again shortly.", 502);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Browser fallback. Only runs when explicitly enabled AND playwright resolves;
 * playwright is intentionally NOT a production dependency (it cannot run inside
 * Vercel's default serverless runtime), so this import always fails closed
 * there and the HTTP-first path remains the supported one.
 */
async function scrapeMasterUuidWithBrowser(pageUrl: string): Promise<string> {
  if (process.env.CINEJOY_ALLOW_BROWSER !== "1") {
    throw new StreamResolveError("No stream is currently available for this title.", 404);
  }
  // Playwright is intentionally NOT a production dependency (it cannot run in
  // Vercel's default serverless runtime). Load it dynamically through the Node
  // module cache so the browser bundle never references it and self-hosted
  // deployments can install it on demand.
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<{ chromium: PlaywrightChromium }>;
  let playwrightModule: { chromium: PlaywrightChromium };
  try {
    playwrightModule = await dynamicImport("playwright");
  } catch {
    throw new StreamResolveError(
      "Browser scraping is enabled but playwright is not installed on this server.",
      500,
    );
  }
  const browser = await playwrightModule.chromium.launch({
    headless: true,
    executablePath: process.env.CINEJOY_CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ locale: "en-US", userAgent: FETCH_USER_AGENT });
  try {
    let resolveDetected!: (uuid: string) => void;
    const detectedUuid = new Promise<string>((resolve) => {
      resolveDetected = resolve;
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      if (requestUrl.origin === UPSTREAM_ORIGIN && requestUrl.pathname.startsWith("/hls/")) {
        const masterMatch = requestUrl.pathname.match(
          /^\/hls\/([0-9a-f-]{36})\/master\.m3u8$/i,
        );
        if (masterMatch && UUID_PATTERN.test(masterMatch[1]!)) {
          resolveDetected(masterMatch[1]!.toLowerCase());
        }
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
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
    const playButton = page.getByRole("button", { name: /^Play$/i }).first();
    await playButton.waitFor({ state: "visible", timeout: 15_000 });
    await playButton.click({ timeout: 10_000 });
    let rejectScrape!: (error: unknown) => void;
    const timeout = new Promise<never>((_resolve, reject) => {
      rejectScrape = reject;
    });
    const timeoutHandle = setTimeout(
      () => rejectScrape(new Error("Provider did not expose a playable stream")),
      25_000,
    );
    try {
      return await Promise.race([detectedUuid, timeout]);
    } finally {
      clearTimeout(timeoutHandle);
    }
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function discoverUuid(cacheKey: string, pageUrl: string): Promise<string> {
  const html = await fetchProviderHtml(pageUrl);
  const uuids = extractMasterUuids(html);
  if (uuids.length > 0) return uuids[0]!;
  // Page renders the player client-side: fall back to browser scraping when
  // explicitly allowed (self-hosted deployments with a Chromium binary).
  return scrapeMasterUuidWithBrowser(pageUrl);
}

/**
 * Returns the provider UUID whose master playlist matches the expected
 * season/episode label. Movies accept the first verified stream; TV episodes
 * must match their own SxxExy variant so a movie or wrong-episode stream is
 * never played.
 */
async function verifyAndSelectUuid(
  uuids: string[],
  expectation: { mediaType: "movie" | "tv"; season?: number; episode?: number },
): Promise<string> {
  for (const uuid of uuids.slice(0, 4)) {
    let master: string;
    try {
      master = await fetchUpstreamText(`/hls/${uuid}/master.m3u8`);
    } catch {
      continue;
    }
    if (!master.trimStart().startsWith("#EXTM3U")) continue;
    if (expectation.mediaType === "movie") return uuid;
    if (
      masterMatchesEpisode(master, expectation.season ?? -1, expectation.episode ?? -1) ||
      (await anyVariantMatchesEpisode(uuid, master, expectation.season ?? -1, expectation.episode ?? -1))
    ) {
      return uuid;
    }
  }
  throw new StreamResolveError("No stream for this exact season and episode was found.", 404);
}

const EPISODE_LABEL_PATTERN = /[sS]\d{1,2}[eE]\d{1,2}/g;

function masterMatchesEpisode(master: string, season: number, episode: number): boolean {
  const wanted = `s${pad2(season)}e${pad2(episode)}`.toLowerCase();
  return [...master.matchAll(EPISODE_LABEL_PATTERN)].some((m) => m[0].toLowerCase() === wanted);
}

async function anyVariantMatchesEpisode(
  uuid: string,
  master: string,
  season: number,
  episode: number,
): Promise<boolean> {
  const variantPaths = [...master.matchAll(/^([^#\r\n][^\r\n]*)$/gm)]
    .map((m) => m[1]!.trim())
    .filter((p) => p && !/^https?:/i.test(p))
    .slice(0, 4);
  for (const variantPath of variantPaths) {
    const suffix = `${uuid}/${variantPath.replace(/^\/+/, "")}`;
    try {
      const text = await fetchUpstreamText(`/hls/${suffix}`);
      if (masterMatchesEpisode(text, season, episode)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function fetchUpstreamText(pathname: string): Promise<string> {
  const url = new URL(pathname, UPSTREAM_ORIGIN);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Origin: CINEJOY_ORIGIN, Referer: `${CINEJOY_ORIGIN}/` },
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function resolvePlayableStream(input: {
  mediaType: "movie" | "tv";
  tmdbId: number;
  title: string;
  year?: string;
  season?: number;
  episode?: number;
}): Promise<ResolvedStream> {
  const cacheKey =
    input.mediaType === "tv"
      ? `tv:${input.tmdbId}:${input.season ?? 0}:${input.episode ?? 0}`
      : `movie:${input.tmdbId}`;

  const cached = uuidCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return finalize(cached.uuid, cacheKey, input);
  }

  let pending = inFlight.get(cacheKey);
  if (!pending) {
    const pageUrl = `${CINEJOY_ORIGIN}${buildProviderPagePath(input)}`;
    pending = discoverUuid(cacheKey, pageUrl)
      .then(async (uuid) => {
        const selected = await verifyAndSelectUuid([uuid], input);
        uuidCache.set(cacheKey, { uuid: selected, expiresAt: Date.now() + CACHE_TTL_MS });
        return selected;
      })
      .catch(async (firstError: unknown) => {
        // One retry: re-discover (page HTML may contain multiple variants).
        const html = await fetchProviderHtml(pageUrl).catch(() => "");
        const uuids = extractMasterUuids(html);
        if (uuids.length > 1) {
          const selected = await verifyAndSelectUuid(uuids, input);
          uuidCache.set(cacheKey, { uuid: selected, expiresAt: Date.now() + CACHE_TTL_MS });
          return selected;
        }
        uuidCache.set(cacheKey, { uuid: "", expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS });
        throw firstError;
      })
      .finally(() => inFlight.delete(cacheKey));
    inFlight.set(cacheKey, pending);
  }

  const uuid = await pending;
  if (!uuid) {
    throw new StreamResolveError("No stream is currently available for this title.", 404);
  }
  return finalize(uuid, cacheKey, input);
}

function finalize(uuid: string, cacheKey: string, input: Parameters<typeof resolvePlayableStream>[0]): ResolvedStream {
  const params = new URLSearchParams({ title: input.title, key: cacheKey });
  if (/^\d{4}$/.test(input.year ?? "")) params.set("year", input.year!);
  if (input.mediaType === "tv") {
    params.set("season", String(input.season));
    params.set("episode", String(input.episode));
  }
  const proxyPrefix = `${APP_PROXY_PREFIX}/hls/${uuid}/`;
  return {
    kind: "hls",
    src: `${proxyPrefix}master.m3u8?${params.toString()}`,
    proxyPrefix,
    cacheKey,
  };
}
