import { safeRegion } from "@/lib/cine/regions";
import type {
  CastMember,
  Episode,
  Movie,
  SeasonMeta,
  Server,
  Title,
  TVShow,
  WatchProvider,
} from "@/lib/cine/types";

export class TmdbError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TmdbError";
    this.status = status;
  }
}

export function formatTmdbError(error: unknown): string {
  if (error instanceof TmdbError) return error.message;
  return "Couldn't reach TMDb. Check your connection and try again.";
}

export interface ShelfPage {
  titles: Title[];
  page: number;
  totalPages: number;
}

const GENRES: Record<number, string> = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Science Fiction",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
  10759: "Action & Adventure",
  10762: "Kids",
  10763: "News",
  10764: "Reality",
  10765: "Sci-Fi & Fantasy",
  10766: "Soap",
  10767: "Talk",
  10768: "War & Politics",
};

const VIDEO_RANK = ["Trailer", "Teaser", "Clip", "Featurette"];
const YOUTUBE_KEY = /^[\w-]{6,20}$/;

interface TmdbListItem {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
  adult?: boolean;
}

interface TmdbPage {
  page: number;
  total_pages: number;
  results: TmdbListItem[];
}

interface TmdbVideo {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official?: boolean;
}

interface TmdbCast {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
}

interface TmdbCrew {
  name: string;
  job: string;
}

interface TmdbProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
}

interface TmdbCountry {
  link?: string;
  flatrate?: TmdbProvider[];
  free?: TmdbProvider[];
  ads?: TmdbProvider[];
  rent?: TmdbProvider[];
  buy?: TmdbProvider[];
}

interface TmdbMovieDetail {
  id: number;
  title?: string;
  overview?: string | null;
  tagline?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  release_date?: string;
  runtime?: number | null;
  homepage?: string | null;
  genres?: { id: number; name: string }[];
  videos?: { results: TmdbVideo[] };
  credits?: { cast: TmdbCast[]; crew: TmdbCrew[] };
  "watch/providers"?: { results?: Record<string, TmdbCountry> };
}

interface TmdbTvDetail {
  id: number;
  name?: string;
  overview?: string | null;
  tagline?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  first_air_date?: string;
  episode_run_time?: number[];
  homepage?: string | null;
  genres?: { id: number; name: string }[];
  created_by?: { name: string }[];
  seasons?: {
    season_number: number;
    name: string;
    episode_count: number;
    poster_path: string | null;
  }[];
  videos?: { results: TmdbVideo[] };
  credits?: { cast: TmdbCast[]; crew: TmdbCrew[] };
  "watch/providers"?: { results?: Record<string, TmdbCountry> };
}

interface TmdbSeasonPayload {
  episodes?: {
    episode_number: number;
    name?: string;
    overview?: string;
    still_path?: string | null;
    runtime?: number | null;
    air_date?: string | null;
  }[];
}

function tmdbImage(path: string | null | undefined, size: "w185" | "w500" | "w780" | "w1280"): string | null {
  if (!path || !path.startsWith("/")) return null;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

function roundRating(value: number): number {
  return Math.round(value * 10) / 10;
}

export function formatRuntime(minutes?: number | null): string | undefined {
  if (!minutes || minutes <= 0) return undefined;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function safeHttp(value?: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    return undefined;
  }
  return undefined;
}

async function tmdb<T>(key: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  const headers = new Headers({ accept: "application/json" });
  const trimmed = key.trim();
  if (trimmed.startsWith("eyJ")) headers.set("authorization", `Bearer ${trimmed}`);
  else url.searchParams.set("api_key", trimmed);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch {
    throw new TmdbError(0, "Couldn't reach TMDb. Check your connection and try again.");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new TmdbError(response.status, "TMDb refused this key. Check it in Settings.");
    }
    if (response.status === 404) throw new TmdbError(404, "TMDb doesn't have this title.");
    throw new TmdbError(response.status, "TMDb didn't respond. Try again in a moment.");
  }

  return (await response.json()) as T;
}

function mapListItem(item: TmdbListItem, forced?: "movie" | "tv"): Title | null {
  if (item.adult) return null;
  const media =
    forced ?? (item.media_type === "movie" || item.media_type === "tv" ? item.media_type : null);
  if (!media) return null;
  const title = media === "movie" ? item.title : item.name;
  if (!title || !item.id) return null;
  const year = ((media === "movie" ? item.release_date : item.first_air_date) ?? "").slice(0, 4);
  const shared = {
    id: `${media}:${item.id}`,
    source: "tmdb" as const,
    tmdbId: item.id,
    title,
    overview: item.overview?.trim() || "No overview has been published yet.",
    posterUrl: tmdbImage(item.poster_path, "w500"),
    backdropUrl: tmdbImage(item.backdrop_path, "w1280"),
    year,
    rating: roundRating(item.vote_average ?? 0),
    genres: (item.genre_ids ?? [])
      .map((id) => GENRES[id])
      .filter((name): name is string => Boolean(name))
      .slice(0, 3),
  };
  if (media === "tv") return { ...shared, mediaType: "tv" };
  return { ...shared, mediaType: "movie" };
}

function mapServers(videos?: { results: TmdbVideo[] }): Server[] {
  return (videos?.results ?? [])
    .filter((video) => video.site === "YouTube" && YOUTUBE_KEY.test(video.key) && VIDEO_RANK.includes(video.type))
    .sort((a, b) => VIDEO_RANK.indexOf(a.type) - VIDEO_RANK.indexOf(b.type) || Number(b.official) - Number(a.official))
    .slice(0, 5)
    .map((video) => ({
      id: video.id,
      name: video.type === "Trailer" && video.official ? "Official trailer" : video.name || video.type,
      kind: video.type === "Trailer" ? "trailer" : video.type === "Teaser" ? "teaser" : video.type === "Featurette" ? "featurette" : "clip",
      youtubeKey: video.key,
    }));
}

function mapCast(cast?: TmdbCast[]): CastMember[] {
  return (cast ?? []).slice(0, 12).map((person) => ({
    id: person.id,
    name: person.name,
    character: person.character || "Cast",
    profileUrl: tmdbImage(person.profile_path, "w185"),
  }));
}

function mapProviders(country?: TmdbCountry): { providers: WatchProvider[]; link?: string } {
  if (!country) return { providers: [] };
  const groups: Array<[WatchProvider["type"], TmdbProvider[] | undefined]> = [
    ["stream", country.flatrate],
    ["stream", country.free],
    ["stream", country.ads],
    ["rent", country.rent],
    ["buy", country.buy],
  ];
  const seen = new Set<number>();
  const providers: WatchProvider[] = [];
  for (const [type, list] of groups) {
    for (const provider of list ?? []) {
      if (seen.has(provider.provider_id)) continue;
      seen.add(provider.provider_id);
      providers.push({
        id: provider.provider_id,
        name: provider.provider_name,
        logoUrl: tmdbImage(provider.logo_path, "w185"),
        type,
      });
    }
  }
  return { providers: providers.slice(0, 12), link: safeHttp(country.link) };
}

export async function testApiKey(key: string): Promise<void> {
  await tmdb(key, "/configuration");
}

export async function fetchShelf(
  key: string,
  shelf: "trending" | "movies" | "tv",
  page: number,
): Promise<ShelfPage> {
  const path = shelf === "movies" ? "/movie/popular" : shelf === "tv" ? "/tv/popular" : "/trending/all/week";
  const forced = shelf === "movies" ? "movie" : shelf === "tv" ? "tv" : undefined;
  const data = await tmdb<TmdbPage>(key, path, { page: String(page), language: "en-US" });
  const titles = data.results
    .map((item) => mapListItem(item, forced))
    .filter((title): title is Title => title !== null);
  return {
    titles,
    page: data.page || page,
    totalPages: Math.min(data.total_pages || page, 12),
  };
}

export async function searchTitles(key: string, query: string): Promise<Title[]> {
  const data = await tmdb<TmdbPage>(key, "/search/multi", {
    query,
    language: "en-US",
    include_adult: "false",
    page: "1",
  });
  return data.results
    .map((item) => mapListItem(item))
    .filter((title): title is Title => title !== null)
    .slice(0, 8);
}

export async function fetchTitleDetail(
  key: string,
  media: "movie" | "tv",
  id: number,
  region: string,
): Promise<Title> {
  const params = { language: "en-US", append_to_response: "videos,credits,watch/providers" };
  if (media === "movie") {
    const detail = await tmdb<TmdbMovieDetail>(key, `/movie/${id}`, params);
    const country = detail["watch/providers"]?.results?.[safeRegion(region)];
    const offers = mapProviders(country);
    const directors = (detail.credits?.crew ?? []).filter((person) => person.job === "Director").map((person) => person.name);
    const movie: Movie = {
      id: `movie:${detail.id}`,
      source: "tmdb",
      mediaType: "movie",
      tmdbId: detail.id,
      title: detail.title || "Untitled",
      tagline: detail.tagline || undefined,
      overview: detail.overview?.trim() || "No overview has been published yet.",
      posterUrl: tmdbImage(detail.poster_path, "w500"),
      backdropUrl: tmdbImage(detail.backdrop_path, "w1280"),
      year: (detail.release_date ?? "").slice(0, 4),
      rating: roundRating(detail.vote_average ?? 0),
      genres: (detail.genres ?? []).map((genre) => genre.name).slice(0, 4),
      runtimeLabel: formatRuntime(detail.runtime),
      creditLine: directors.length ? `Directed by ${directors.slice(0, 2).join(", ")}` : undefined,
      homepage: safeHttp(detail.homepage),
      servers: mapServers(detail.videos),
      cast: mapCast(detail.credits?.cast),
      providers: offers.providers,
      providerLink: offers.link,
    };
    return movie;
  }

  const detail = await tmdb<TmdbTvDetail>(key, `/tv/${id}`, params);
  const country = detail["watch/providers"]?.results?.[safeRegion(region)];
  const offers = mapProviders(country);
  const creators = (detail.created_by ?? []).map((person) => person.name);
  const seasons: SeasonMeta[] = (detail.seasons ?? [])
    .filter((item) => item.episode_count > 0)
    .map((item) => ({
      number: item.season_number,
      name: item.name || `Season ${item.season_number}`,
      episodeCount: item.episode_count,
      posterUrl: tmdbImage(item.poster_path, "w500"),
    }));
  const show: TVShow = {
    id: `tv:${detail.id}`,
    source: "tmdb",
    mediaType: "tv",
    tmdbId: detail.id,
    title: detail.name || "Untitled",
    tagline: detail.tagline || undefined,
    overview: detail.overview?.trim() || "No overview has been published yet.",
    posterUrl: tmdbImage(detail.poster_path, "w500"),
    backdropUrl: tmdbImage(detail.backdrop_path, "w1280"),
    year: (detail.first_air_date ?? "").slice(0, 4),
    rating: roundRating(detail.vote_average ?? 0),
    genres: (detail.genres ?? []).map((genre) => genre.name).slice(0, 4),
    runtimeLabel: formatRuntime(detail.episode_run_time?.[0]),
    creditLine: creators.length ? `Created by ${creators.slice(0, 2).join(", ")}` : undefined,
    homepage: safeHttp(detail.homepage),
    servers: mapServers(detail.videos),
    cast: mapCast(detail.credits?.cast),
    providers: offers.providers,
    providerLink: offers.link,
    seasons,
  };
  return show;
}

export async function fetchSeason(key: string, id: number, season: number): Promise<Episode[]> {
  const data = await tmdb<TmdbSeasonPayload>(key, `/tv/${id}/season/${season}`, { language: "en-US" });
  return (data.episodes ?? []).map((episode) => ({
    id: `${id}-s${season}e${episode.episode_number}`,
    number: episode.episode_number,
    title: episode.name?.trim() || `Episode ${episode.episode_number}`,
    overview: episode.overview?.trim() || "No overview has been published for this episode.",
    stillUrl: tmdbImage(episode.still_path, "w780"),
    runtime: episode.runtime ?? undefined,
    airDate: episode.air_date ?? undefined,
  }));
}
