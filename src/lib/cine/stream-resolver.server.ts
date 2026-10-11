import { resolveWingStream } from "@/lib/cine/wing-native.server";

const UPSTREAM_ORIGIN = "https://nebula.bright67.online";
const CINEJOY_ORIGIN = "https://cinejoy.pk";
const APP_PROXY_PREFIX = "/api/cinejoy";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache for active streams
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
  src: string;
  proxyPrefix: string;
  cacheKey: string;
  server?: string;
  playlistUrl?: string;
};

type CacheEntry = {
  playlistUrl: string;
  server: string;
  uuid?: string;
  expiresAt: number;
};

const streamCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();

export function buildProviderPagePath(input: {
  mediaType: "movie" | "tv";
  tmdbId: number;
  title: string;
  year?: string;
  season?: number;
  episode?: number;
}): string {
  if (input.mediaType === "tv") {
    const season = input.season ?? 1;
    const episode = input.episode ?? 1;
    return `/watch/tv/${input.tmdbId}/${season}/${episode}`;
  }
  return `/watch/movie/${input.tmdbId}`;
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

async function scrapeMasterUuidWithBrowser(pageUrl: string): Promise<string> {
  if (process.env.CINEJOY_ALLOW_BROWSER !== "1") {
    throw new StreamResolveError("No stream is currently available for this title.", 404);
  }
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
  return scrapeMasterUuidWithBrowser(pageUrl);
}

export async function resolvePlayableStream(input: {
  mediaType: "movie" | "tv";
  tmdbId: number;
  title: string;
  year?: string;
  season?: number;
  episode?: number;
  server?: string;
}): Promise<ResolvedStream> {
  const cacheKey =
    input.mediaType === "tv"
      ? `tv:${input.tmdbId}:${input.season ?? 1}:${input.episode ?? 1}`
      : `movie:${input.tmdbId}`;

  const lookupKey = input.server ? `${cacheKey}:${input.server}` : cacheKey;

  const cached = streamCache.get(lookupKey) ?? streamCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return finalize(cached, cacheKey, input);
  }

  let pending = inFlight.get(lookupKey);
  if (!pending) {
    pending = (async () => {
      try {
        const wing = await resolveWingStream({
          mediaType: input.mediaType,
          tmdbId: input.tmdbId,
          season: input.season ?? 1,
          episode: input.episode ?? 1,
          server: input.server,
        });
        if (wing && wing.playlistUrl) {
          const entry: CacheEntry = {
            playlistUrl: wing.playlistUrl,
            server: wing.server,
            uuid: wing.uuid,
            expiresAt: Date.now() + CACHE_TTL_MS,
          };
          streamCache.set(lookupKey, entry);
          streamCache.set(cacheKey, entry);
          return entry;
        }
      } catch (err) {
        console.warn("[stream-resolver] Native Wing resolution failed, trying fallback:", err);
      }

      const pageUrl = `${CINEJOY_ORIGIN}${buildProviderPagePath(input)}`;
      try {
        const uuid = await discoverUuid(cacheKey, pageUrl);
        const fallbackUrl = `${UPSTREAM_ORIGIN}/hls/${uuid}/master.m3u8`;
        const entry: CacheEntry = {
          playlistUrl: fallbackUrl,
          server: "nebula",
          uuid,
          expiresAt: Date.now() + CACHE_TTL_MS,
        };
        streamCache.set(lookupKey, entry);
        streamCache.set(cacheKey, entry);
        return entry;
      } catch (fallbackError) {
        streamCache.set(lookupKey, {
          playlistUrl: "",
          server: "none",
          expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS,
        });
        throw fallbackError;
      }
    })().finally(() => inFlight.delete(lookupKey));

    inFlight.set(lookupKey, pending);
  }

  const entry = await pending;
  if (!entry || !entry.playlistUrl) {
    throw new StreamResolveError("No stream is currently available for this title.", 404);
  }
  return finalize(entry, cacheKey, input);
}

function finalize(
  entry: CacheEntry,
  cacheKey: string,
  input: Parameters<typeof resolvePlayableStream>[0]
): ResolvedStream {
  const params = new URLSearchParams({
    url: entry.playlistUrl,
    title: input.title,
    server: entry.server,
  });
  if (/^\d{4}$/.test(input.year ?? "")) params.set("year", input.year!);
  if (input.mediaType === "tv") {
    params.set("season", String(input.season ?? 1));
    params.set("episode", String(input.episode ?? 1));
  }
  const streamUrl = `${APP_PROXY_PREFIX}/stream?${params.toString()}`;
  return {
    kind: "hls",
    src: streamUrl,
    proxyPrefix: `${APP_PROXY_PREFIX}/stream?url=`,
    cacheKey,
    server: entry.server,
    playlistUrl: entry.playlistUrl,
  };
}
