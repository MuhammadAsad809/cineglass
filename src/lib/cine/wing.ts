export interface WingMovieInfo {
  tmdbId: number;
  title: string;
  year: number | null;
  quality: string | null;
  runtime: number | null;
}

export class WingApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WingApiError";
  }
}

const WING_INFO_ENDPOINT = "https://api.wing.st/info";
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const cache = new Map<number, { expiresAt: number; info: WingMovieInfo }>();
const inFlight = new Map<number, Promise<WingMovieInfo>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestMovieInfo(tmdbId: number): Promise<WingMovieInfo> {
  const url = new URL(WING_INFO_ENDPOINT);
  url.searchParams.set("type", "movie");
  url.searchParams.set("tmdb", String(tmdbId));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        throw new WingApiError("Wing API lookup timed out. Try again later.");
      }
      throw new WingApiError("Could not reach the Wing API. Check your connection and try again.");
    }

    if (!response.ok) {
      throw new WingApiError(`Wing API request failed (HTTP ${response.status}).`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new WingApiError("Wing API returned invalid JSON.");
    }

    if (!isRecord(payload)) {
      throw new WingApiError("Wing API returned an unexpected response.");
    }

    if (payload.tmdb_id !== tmdbId || payload.type !== "movie" || typeof payload.title !== "string") {
      throw new WingApiError("Wing API response did not match the requested movie.");
    }

    const year = typeof payload.year === "number" && Number.isInteger(payload.year) ? payload.year : null;
    const runtime = typeof payload.runtime === "number" && Number.isFinite(payload.runtime) ? payload.runtime : null;
    const quality = typeof payload.quality_tag === "string" ? payload.quality_tag : null;

    return {
      tmdbId,
      title: payload.title,
      year,
      quality,
      runtime,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function fetchWingMovieInfo(tmdbId: number): Promise<WingMovieInfo> {
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) {
    return Promise.reject(new WingApiError("A valid TMDb movie ID is required."));
  }

  const cached = cache.get(tmdbId);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.info);

  const existingRequest = inFlight.get(tmdbId);
  if (existingRequest) return existingRequest;

  const request = requestMovieInfo(tmdbId)
    .then((info) => {
      cache.set(tmdbId, { info, expiresAt: Date.now() + CACHE_TTL_MS });
      return info;
    })
    .finally(() => inFlight.delete(tmdbId));

  inFlight.set(tmdbId, request);
  return request;
}
