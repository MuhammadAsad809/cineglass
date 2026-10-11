export type MediaType = "movie" | "tv";
export type Shelf = "trending" | "movies" | "tv" | "favorites";
export type LibraryMode = "live" | "atelier";
export type StillFocus = "left" | "center" | "right" | "top";

export interface Server {
  id: string;
  name: string;
  kind: "trailer" | "teaser" | "clip" | "featurette" | "prelude" | "mp4" | "hls";
  youtubeKey?: string;
  src?: string;
}

export interface CastMember {
  id: number;
  name: string;
  character: string;
  profileUrl: string | null;
}

export interface WatchProvider {
  id: number;
  name: string;
  logoUrl: string | null;
  type: "stream" | "rent" | "buy";
}

export interface Episode {
  id: string;
  number: number;
  seasonNumber?: number;
  title: string;
  overview: string;
  stillUrl: string | null;
  stillFocus?: StillFocus;
  runtime?: number;
  airDate?: string;
}

export interface SeasonMeta {
  number: number;
  name: string;
  episodeCount: number;
  posterUrl: string | null;
  episodes?: Episode[];
}

export interface TitleSnapshot {
  id: string;
  source: "atelier" | "tmdb";
  mediaType: MediaType;
  tmdbId?: number;
  title: string;
  overview: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  year: string;
  rating: number;
  genres: string[];
  runtimeLabel?: string;
}

interface TitleDetail {
  tagline?: string;
  creditLine?: string;
  homepage?: string;
  servers?: Server[];
  cast?: CastMember[];
  providers?: WatchProvider[];
  providerLink?: string;
  seasons?: SeasonMeta[];
}

export interface Movie extends TitleSnapshot, TitleDetail {
  mediaType: "movie";
}

export interface TVShow extends TitleSnapshot, TitleDetail {
  mediaType: "tv";
}

export type Title = Movie | TVShow;

export interface Playback {
  title: Title;
  episode?: Episode;
  serverId: string;
  loading: boolean;
  error?: string;
}

/** Playable stream returned by /api/cinejoy/resolve. */
export interface ResolvedPlaybackStream {
  kind: "hls" | "mp4";
  src: string;
  /** Proxied path prefix every manifest/segment URL must stay inside. */
  proxyPrefix: string;
  cacheKey: string;
}

export interface BrowseSearch {
  shelf: Shelf;
  library: LibraryMode;
}

export function snapshotToTitle(snapshot: TitleSnapshot): Title {
  if (snapshot.mediaType === "tv") return { ...snapshot, mediaType: "tv" };
  return { ...snapshot, mediaType: "movie" };
}

export function toSnapshot(title: TitleSnapshot): TitleSnapshot {
  return {
    id: title.id,
    source: title.source,
    mediaType: title.mediaType,
    tmdbId: title.tmdbId,
    title: title.title,
    overview: title.overview,
    posterUrl: title.posterUrl,
    backdropUrl: title.backdropUrl,
    year: title.year,
    rating: title.rating,
    genres: title.genres ?? [],
    runtimeLabel: title.runtimeLabel,
  };
}

export function titleToRoute(title: TitleSnapshot): { kind: string; id: string } {
  if (title.source === "atelier" || title.id.startsWith("atelier:")) {
    return { kind: "atelier", id: title.id.replace(/^atelier:/, "") };
  }
  const numeric = title.tmdbId ?? title.id.split(":")[1] ?? "";
  return { kind: title.mediaType, id: String(numeric) };
}

export function parseBrowseSearch(search: Record<string, unknown>): BrowseSearch {
  const shelfValue = search.shelf;
  const shelf: Shelf =
    shelfValue === "movies" || shelfValue === "tv" || shelfValue === "favorites" || shelfValue === "trending"
      ? shelfValue
      : "trending";
  const library: LibraryMode = search.library === "atelier" ? "atelier" : "live";
  return { shelf, library };
}

export function isTitleSnapshot(value: unknown): value is TitleSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<TitleSnapshot>;
  return (
    typeof row.id === "string" &&
    typeof row.title === "string" &&
    (row.mediaType === "movie" || row.mediaType === "tv") &&
    (row.source === "atelier" || row.source === "tmdb")
  );
}
