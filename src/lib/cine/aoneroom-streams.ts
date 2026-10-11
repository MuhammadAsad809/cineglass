/**
 * Client-side resolver for AoneRoom (MovieBox) playable streams.
 *
 * The public H5 catalog endpoints (proxied same-origin through
 * /api/aoneroom/*) embed directly-playable CDN MP4 URLs inside every
 * subject's `trailer.videoAddress.url` field — no auth, no HMAC required.
 * Full episodes additionally appear in `/subject/play` responses once a
 * session bearer token is attached by the server proxy.
 *
 * All returned `src` values are rewritten to the same-origin passthrough
 * (/api/aoneroom/media/<base64url>) so the <video> element never touches a
 * cross-origin URL and the server can attach the CDN Referer/UA headers.
 */

import { toSameOriginMediaUrl } from "./aoneroom-media-url";

export interface AoneRoomStream {
  id: string;
  name: string;
  kind: "mp4" | "hls";
  /** Same-origin playable path, e.g. /api/aoneroom/media/<ref>. */
  src: string;
  duration?: number;
  width?: number;
  height?: number;
}

const API_PREFIX = "/api/aoneroom";
const REQUEST_TIMEOUT_MS = 20_000;

async function fetchJson(path: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_PREFIX}/${path}`, {
      headers: { Accept: "application/json" },
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`AoneRoom API HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function collectVideoAddresses(node: unknown, out: Map<string, Record<string, unknown>>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectVideoAddresses(item, out);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const record = node as Record<string, unknown>;
  const address = record.videoAddress;
  if (address && typeof address === "object") {
    const url = (address as Record<string, unknown>).url;
    if (typeof url === "string" && /^https:\/\/[^/]+\.aoneroom\.com\/media\//.test(url)) {
      if (!out.has(url)) out.set(url, address as Record<string, unknown>);
    }
  }
  for (const value of Object.values(record)) collectVideoAddresses(value, out);
}

function qualityLabel(definition: unknown, url: string): string {
  if (typeof definition === "string" && definition.trim()) return definition.trim().toUpperCase();
  const suffix = /-(ld|sd|hd|fhd|uhd|4k)\.mp4$/i.exec(url)?.[1]?.toLowerCase();
  switch (suffix) {
    case "ld":
      return "Low (360p)";
    case "sd":
      return "SD (480p)";
    case "hd":
      return "HD (720p)";
    case "fhd":
      return "Full HD (1080p)";
    case "uhd":
    case "4k":
      return "4K";
    default:
      return "Auto";
  }
}

function toStreams(addresses: Map<string, Record<string, unknown>>, namePrefix: string): AoneRoomStream[] {
  const streams: AoneRoomStream[] = [];
  let index = 0;
  for (const [url, address] of addresses) {
    const src = toSameOriginMediaUrl(url);
    if (!src) continue;
    index += 1;
    streams.push({
      id: `aoneroom-${index}`,
      name: `${namePrefix} · ${qualityLabel(address.definition, url)}`,
      kind: url.includes(".m3u8") ? "hls" : "mp4",
      src,
      duration: typeof address.duration === "number" ? address.duration : undefined,
      width: typeof address.width === "number" ? address.width : undefined,
      height: typeof address.height === "number" ? address.height : undefined,
    });
  }
  return streams;
}

/**
 * Walks a /subject/play (or preview) payload and collects every playable URL:
 * `videoAddress.url` objects AND plain string arrays such as `m3u8List`,
 * `mp4List`, or `urls`.
 */
function collectPlayPayload(node: unknown, out: Map<string, Record<string, unknown>>): void {
  collectVideoAddresses(node, out);
  if (Array.isArray(node)) {
    for (const item of node) {
      if (typeof item === "string" && /^https:\/\/[^/]+\.aoneroom\.com\/media\//.test(item)) {
        if (!out.has(item)) out.set(item, {});
      } else {
        collectPlayPayload(item, out);
      }
    }
    return;
  }
  if (typeof node !== "object" || node === null) return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (/^(m3u8|mp4|url|stream|video|play)[-_]?(list|s|urls)?$/i.test(key) && Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && /^https:\/\/[^/]+\.aoneroom\.com\/media\//.test(item)) {
          if (!out.has(item)) out.set(item, {});
        }
      }
    }
    collectPlayPayload(value, out);
  }
}

/**
 * Finds all playable CDN MP4 references embedded anonymously in the catalog
 * payload for a given AoneRoom subjectId (detail endpoint first, home/trending
 * as fallback), plus any authenticated full-episode streams from /subject/play.
 */
export async function resolveAoneRoomStreams(
  subjectId: string,
  options: { se?: number; ep?: number; detailPath?: string; signal?: AbortSignal } = {},
): Promise<AoneRoomStream[]> {
  const addresses = new Map<string, Record<string, unknown>>();

  // 1. Detail endpoint always carries the subject trailer videoAddress.
  try {
    const detail = await fetchJson(`detail?subjectId=${encodeURIComponent(subjectId)}`);
    collectVideoAddresses(detail, addresses);
  } catch {
    /* fall through to catalog search */
  }

  // 2. Home feed as a secondary source (banner + operating lists).
  if (addresses.size === 0) {
    try {
      const home = await fetchJson(`home?host=${encodeURIComponent("moviebox.ph")}`);
      collectVideoAddresses(home, addresses);
    } catch {
      /* ignore */
    }
  }

  // 3. Authenticated play endpoint (empty anonymously, populated with session).
  const playParams = new URLSearchParams({ subjectId });
  if (options.se != null) playParams.set("se", String(options.se));
  if (options.ep != null) playParams.set("ep", String(options.ep));
  if (options.detailPath) playParams.set("detailPath", options.detailPath);
  try {
    const play = await fetchJson(`subject/play?${playParams.toString()}`);
    const playData = (play as { data?: Record<string, unknown> })?.data;
    if (playData) {
      for (const key of ["streams", "dash", "hls"]) {
        collectPlayPayload(playData[key], addresses);
      }
      collectPlayPayload(playData, addresses);
    }
  } catch {
    /* ignore */
  }

  return toStreams(addresses, "MovieBox (AoneRoom)");
}

/**
 * Resolves MovieBox/AoneRoom streams by TITLE NAME via the public H5 search
 * endpoint — no subjectId required. This lets every catalog title (TMDB or
 * otherwise) surface a "MovieBox" server in the player: we search AoneRoom
 * for the exact title, pick the best-matching subject, then pull its
 * directly-playable CDN MP4/M3U8 links (trailer + anonymous preview streams).
 */
export async function resolveAoneRoomStreamsByTitle(
  query: string,
  options: { year?: number; mediaType?: "movie" | "tv"; signal?: AbortSignal } = {},
): Promise<{ streams: AoneRoomStream[]; subjectId: string | null }> {
  const empty = { streams: [] as AoneRoomStream[], subjectId: null };
  const trimmed = query.trim();
  if (!trimmed) return empty;

  let subjects: Record<string, unknown>[] = [];

  // 1. Primary keyword search: /subject/filter accepts an anonymous `keyword`
  //    body and returns matching subjects with their trailer videoAddress.
  try {
    const result = await fetchJson("subject/filter", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ keyword: trimmed, page: 1, perPage: 20 }),
      signal: options.signal,
    });
    const data = (result as { data?: Record<string, unknown> })?.data;
    const list =
      (data?.items as Record<string, unknown>[]) ??
      (data?.list as Record<string, unknown>[]) ??
      (data?.subjects as Record<string, unknown>[]) ??
      (Array.isArray(data) ? (data as Record<string, unknown>[]) : []);
    subjects = Array.isArray(list) ? list : [];
  } catch {
    /* fall through to trending scan */
  }

  if (subjects.length === 0) {
    // Fallback: scan the first trending pages for a name match.
    try {
      const trending = await fetchJson("subject/trending?page=1&perPage=50", {
        signal: options.signal,
      });
      const data = (trending as { data?: Record<string, unknown> })?.data;
      const list = (data?.list as Record<string, unknown>[]) ?? (Array.isArray(data) ? (data as Record<string, unknown>[]) : []);
      subjects = Array.isArray(list) ? list : [];
    } catch {
      return empty;
    }
  }

  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const wanted = normalize(trimmed);

  let best: Record<string, unknown> | null = null;
  let bestScore = 0;
  for (const subject of subjects) {
    const names = [subject.name, subject.title, subject.originalName, subject.englishTitle]
      .filter((v): v is string => typeof v === "string")
      .map(normalize);
    if (names.length === 0) continue;
    let score = 0;
    for (const name of names) {
      if (name === wanted) score = Math.max(score, 3);
      else if (name.includes(wanted) || wanted.includes(name)) score = Math.max(score, 2);
      else score = Math.max(score, 1);
    }
    // Prefer candidates that already carry a playable trailer URL.
    if (score >= 2 && subject.trailer) score += 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = subject;
    }
  }
  if (!best || bestScore < 2) return empty;

  const subjectId = String(best.subjectId ?? best.id ?? "");
  if (!/^\d{6,}$/.test(subjectId)) return empty;

  const streams = await resolveAoneRoomStreams(subjectId, { detailPath: `/detail/${subjectId}`, signal: options.signal });
  return { streams, subjectId };
}
