import type { Episode, ResolvedPlaybackStream, Title } from "@/lib/cine/types";

export class ResolveError extends Error {}

const RESOLVE_ENDPOINT = "/api/cinejoy/resolve";

function tmdbIdFor(title: Title): number | null {
  if (title.source !== "tmdb") return null;
  const id = title.tmdbId ?? Number(title.id.split(":").pop());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Asks the server-side CineJoy proxy to resolve a playable, same-origin
 * proxied stream for this exact movie or season/episode. Throws ResolveError
 * with a user-presentable message when nothing playable is available.
 */
export async function resolveStream(
  title: Title,
  episode?: Episode,
  signal?: AbortSignal,
): Promise<ResolvedPlaybackStream> {
  const tmdbId = tmdbIdFor(title);
  if (tmdbId === null) {
    throw new ResolveError("This title has no TMDb id, so no stream can be resolved.");
  }
  if (title.mediaType === "tv" && (!episode || !episode.seasonNumber)) {
    throw new ResolveError("Select a season and episode before playing this series.");
  }

  const params = new URLSearchParams({
    type: title.mediaType,
    tmdb: String(tmdbId),
    title: title.title,
  });
  if (/^\d{4}$/.test(title.year ?? "")) params.set("year", title.year);
  if (title.mediaType === "tv" && episode) {
    params.set("season", String(episode.seasonNumber));
    params.set("episode", String(episode.number));
  }

  let response: Response;
  try {
    response = await fetch(`${RESOLVE_ENDPOINT}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ResolveError("Could not reach the playback service. Check your connection.");
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ResolveError(
      detail.trim() || `The playback service could not resolve this ${title.mediaType === "tv" ? "episode" : "movie"} (HTTP ${response.status}).`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ResolveError("The playback service returned an invalid response.");
  }

  const stream = payload as Partial<ResolvedPlaybackStream>;
  if (
    (stream.kind !== "hls" && stream.kind !== "mp4") ||
    typeof stream.src !== "string" ||
    !isSameOriginPlayableUrl(stream.src) ||
    typeof stream.proxyPrefix !== "string" ||
    !stream.src.startsWith(stream.proxyPrefix)
  ) {
    throw new ResolveError("The playback service did not return a valid stream URL.");
  }

  return {
    kind: stream.kind,
    src: stream.src,
    proxyPrefix: stream.proxyPrefix,
    cacheKey: typeof stream.cacheKey === "string" ? stream.cacheKey : "",
  };
}

/** Only accept app-relative or same-origin absolute URLs — never third-party origins. */
export function isSameOriginPlayableUrl(value: string): boolean {
  try {
    const url = new URL(value, "http://localhost");
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (typeof window === "undefined") return true;
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}
