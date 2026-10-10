import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Play, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCine } from "@/lib/cine/store";
import type { MediaType, Title } from "@/lib/cine/types";

type PlayerServer = {
  id: string;
  name: string;
  url: string;
  kind?: "hls";
  available?: boolean;
};

const CINEJOY_TMDB_ID = "969681";
const CINEJOY_PROXY_HLS_URL =
  "/api/cinejoy/hls/eeea82d4-605b-4469-a754-f19d1c443ad6/master.m3u8";

function cineJoyUrl(tmdbId: string, title: string, year: string): string {
  if (tmdbId === CINEJOY_TMDB_ID) return CINEJOY_PROXY_HLS_URL;
  const query = new URLSearchParams({ title, year });
  return `/api/cinejoy/resolve/${tmdbId}/master.m3u8?${query.toString()}`;
}

function getTmdbId(title: { tmdbId?: number; id: string; source: string }): string | null {
  if (title.source !== "tmdb") return null;
  const id = title.tmdbId ?? Number(title.id.split(":").pop());
  return Number.isSafeInteger(id) && id > 0 ? String(id) : null;
}

function HlsVideo({ url, onFailure }: { url: string; onFailure: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let hls: import("hls.js").default | null = null;
    const startPlayback = async () => {
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;

      if (Hls.isSupported()) {
        hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 30 });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal && !cancelled) onFailure();
        });
        hls.loadSource(url);
        hls.attachMedia(video);
        return;
      }

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        return;
      }
      onFailure();
    };

    void startPlayback().catch(() => {
      if (!cancelled) onFailure();
    });
    return () => {
      cancelled = true;
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [url, onFailure]);

  return (
    <video
      ref={videoRef}
      className="h-full w-full bg-black"
      controls
      playsInline
      preload="metadata"
      onError={onFailure}
    />
  );
}

export function PlayerModal() {
  const playing = useCine((state) => state.playing);
  const closePlayer = useCine((state) => state.closePlayer);
  const setServer = useCine((state) => state.setServer);
  const [frameFailed, setFrameFailed] = useState(false);
  const markFrameFailed = useCallback(() => setFrameFailed(true), []);

  const title = playing?.title;
  const mediaType: MediaType | undefined = title?.mediaType;
  const tmdbId = title ? getTmdbId(title) : null;
  const movieTitle = title?.title ?? "";
  const movieYear = title?.year ?? "";
  const seasonNumber = playing?.episode?.seasonNumber ?? 1;
  const episodeNumber = playing?.episode?.number;

  const servers = useMemo<PlayerServer[]>(() => {
    if (!tmdbId || !mediaType) return [];
    const cinejoyServer: PlayerServer[] =
      mediaType === "movie"
        ? [
            {
              id: "cinejoy",
              name: "CineJoy",
              url: cineJoyUrl(tmdbId, movieTitle, movieYear),
              kind: "hls",
              available: true,
            },
          ]
        : [];
    if (mediaType === "tv") {
      if (!episodeNumber) return [];
      return [
        { id: "vidlink", name: "VidLink Pro", url: `https://vidlink.pro/tv/${tmdbId}/${seasonNumber}/${episodeNumber}` },
        { id: "embed-su", name: "Embed.su", url: `https://embed.su/embed/tv/${tmdbId}/${seasonNumber}/${episodeNumber}` },
        { id: "vidsrc", name: "VidSrc.cc", url: `https://vidsrc.cc/v2/embed/tv/${tmdbId}/${seasonNumber}/${episodeNumber}` },
      ];
    }
    return [
      { id: "vidlink", name: "VidLink Pro", url: `https://vidlink.pro/movie/${tmdbId}` },
      { id: "embed-su", name: "Embed.su", url: `https://embed.su/embed/movie/${tmdbId}` },
      { id: "vidsrc", name: "VidSrc.cc", url: `https://vidsrc.cc/v2/embed/movie/${tmdbId}` },
      ...cinejoyServer,
    ];
  }, [tmdbId, mediaType, seasonNumber, episodeNumber, movieTitle, movieYear]);

  const active =
    servers.find((server) => server.id === playing?.serverId && server.available !== false) ??
    servers.find((server) => server.available !== false) ??
    servers[0];
  useEffect(() => setFrameFailed(false), [active?.url]);

  if (!playing || !title) return null;

  const heading = playing.episode ? playing.episode.title : title.title;
  const kicker = playing.episode
    ? `${title.title} · season ${seasonNumber}, episode ${playing.episode.number}`
    : title.mediaType === "tv" ? "Series player" : "Movie player";

  return (
    <Dialog.Root open onOpenChange={(open) => !open && closePlayer()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-bg/85" />
        <Dialog.Content className="fixed inset-0 z-[80] flex flex-col outline-none">
          <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-6">
            <div className="min-w-0">
              <Dialog.Description className="kicker">{kicker}</Dialog.Description>
              <Dialog.Title className="mt-1 truncate text-lg font-semibold sm:text-2xl">{heading}</Dialog.Title>
            </div>
            <Dialog.Close
              className="btn btn-glass btn-icon shrink-0 rounded-full border border-white/20 bg-white/10 shadow-lg backdrop-blur-xl transition hover:bg-white/20"
              aria-label="Close player"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 flex-1 items-center px-3 py-4 sm:px-6 sm:py-5">
            <div className="stage-frame relative overflow-hidden rounded-3xl border border-white/10 bg-black/80 shadow-2xl">
              {active?.kind === "hls" ? (
                <HlsVideo key={active.url} url={active.url} onFailure={markFrameFailed} />
              ) : active ? (
                <iframe
                  key={active.url}
                  src={active.url}
                  title={`${title.title} player`}
                  className="h-full w-full border-0 bg-black"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-modals allow-orientation-lock allow-pointer-lock"
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  onError={() => setFrameFailed(true)}
                />
              ) : (
                <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
                  <Play className="size-8 text-muted" />
                  <p className="font-medium">No stream ID available</p>
                  <p className="max-w-md text-sm text-muted">A TMDb movie/show ID is required. Select a TMDb title and, for TV, choose an episode.</p>
                </div>
              )}
              {playing.loading ? (
                <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-2 text-sm text-white backdrop-blur-xl">
                  <Loader2 className="size-4 animate-spin" /> Loading title details…
                </div>
              ) : null}
            </div>
          </div>

          <div className="px-3 pb-5 sm:px-6 sm:pb-7">
            {playing.error ? <p className="mx-auto mb-3 max-w-5xl text-center text-sm text-muted" role="status">{playing.error}</p> : null}
            {frameFailed ? <p className="mx-auto mb-3 max-w-5xl text-center text-sm text-muted" role="status">{active?.id === "cinejoy" ? "CineJoy could not resolve a stream for this movie, or playback failed. Try another server." : "The selected player reported a load error. Try another server."}</p> : null}
            {servers.length ? (
              <div className="mx-auto flex w-fit max-w-full gap-2 overflow-x-auto rounded-full border border-white/15 bg-white/[0.08] p-2 shadow-2xl backdrop-blur-2xl">
                {servers.map((server) => (
                  <button
                    key={server.id}
                    type="button"
                    disabled={server.available === false}
                    title={server.available === false ? "No CineJoy stream is mapped for this movie yet" : undefined}
                    className={cn(
                      "btn shrink-0 rounded-full",
                      server.id === active?.id ? "btn-solid" : "btn-glass",
                      server.available === false && "cursor-not-allowed opacity-50",
                    )}
                    aria-pressed={server.id === active?.id}
                    onClick={() => { setFrameFailed(false); setServer(server.id); }}
                  >
                    <Play className="size-4" />
                    <span className="max-w-40 truncate">
                      {server.available === false ? `${server.name} — unavailable` : server.name}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <p className="mt-3 text-center text-xs text-muted">Playback availability depends on the selected third-party provider and its permissions.</p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}


export function tmdbIdForPlayer(title: Title): number | null {
  if (title.source !== "tmdb") return null;
  const id = title.tmdbId ?? Number(title.id.split(":").pop());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
