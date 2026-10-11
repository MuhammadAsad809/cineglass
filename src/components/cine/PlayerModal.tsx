import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Languages, Loader2, Play, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCine } from "@/lib/cine/store";
import {
  resolveAoneRoomStreams,
  resolveAoneRoomStreamsByTitle,
  type AoneRoomStream,
} from "@/lib/cine/aoneroom-streams";
import type { MediaType, Title } from "@/lib/cine/types";

export type AudioTrackInfo = {
  id: number;
  name: string;
  lang: string;
};

type PlayerServer = {
  id: string;
  name: string;
  url: string;
  kind?: "hls" | "mp4";
  available?: boolean;
};

/** Extracts the numeric AoneRoom subjectId embedded in a title's external id. */
function aoneRoomSubjectId(title: Title): string | null {
  const match = /(?:aoneroom|moviebox)[:/-](\d{6,})/i.exec(title.id);
  if (match) return match[1] ?? null;
  const raw = (title as { subjectId?: unknown }).subjectId;
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : null;
}

function Mp4Video({
  url,
  onAudioTracks,
  activeAudioTrack,
  onAudioTrackSwitched,
}: {
  url: string;
  onAudioTracks?: (tracks: AudioTrackInfo[]) => void;
  activeAudioTrack?: number;
  onAudioTrackSwitched?: (id: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.src = url;
    void video.play().catch(() => {});
    // Surface native multi-audio tracks (Safari / Chrome report them after
    // loadedmetadata) so the language switcher works for MP4 streams too.
    const reportTracks = () => {
      if (!onAudioTracks) return;
      const list = video.audioTracks;
      if (!list || list.length === 0) {
        onAudioTracks([]);
        return;
      }
      const tracks: AudioTrackInfo[] = Array.from(list).map((track, index) => ({
        id: index,
        name: track.label || track.language || `Audio ${index + 1}`,
        lang: track.language || "und",
      }));
      onAudioTracks(tracks);
    };
    video.addEventListener("loadedmetadata", reportTracks);
    return () => {
      video.removeEventListener("loadedmetadata", reportTracks);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [url, onAudioTracks]);

  // Apply the selected audio track whenever it changes.
  useEffect(() => {
    const list = videoRef.current?.audioTracks;
    if (!list || list.length === 0) return;
    for (let i = 0; i < list.length; i += 1) {
      const track = list[i];
      if (track) track.enabled = i === (activeAudioTrack ?? 0);
    }
    onAudioTrackSwitched?.(activeAudioTrack ?? 0);
  }, [activeAudioTrack, onAudioTrackSwitched]);

  return (
    <video
      ref={videoRef}
      className="h-full w-full bg-black"
      controls
      autoPlay
      playsInline
      preload="metadata"
    />
  );
}

function cineJoyMovieUrl(
  tmdbId: string,
  title: string,
  year: string,
  serverCluster?: string
): string {
  const query = new URLSearchParams();
  if (title) query.set("title", title);
  if (year) query.set("year", year);
  if (serverCluster) query.set("server", serverCluster);
  const q = query.toString();
  return `/api/cinejoy/resolve/${tmdbId}/master.m3u8${q ? `?${q}` : ""}`;
}

function cineJoyTvUrl(
  tmdbId: string,
  season: number,
  episode: number,
  title: string,
  serverCluster?: string
): string {
  const query = new URLSearchParams();
  if (title) query.set("title", title);
  if (serverCluster) query.set("server", serverCluster);
  const q = query.toString();
  return `/api/cinejoy/resolve-tv/${tmdbId}/${season}/${episode}/master.m3u8${q ? `?${q}` : ""}`;
}

export function tmdbIdForPlayer(title: Title): number | null {
  if (title.source !== "tmdb") return null;
  const id = title.tmdbId ?? Number(title.id.split(":").pop());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function getTmdbId(title: { tmdbId?: number; id: string; source: string }): string | null {
  const id = tmdbIdForPlayer(title as Title);
  return id !== null ? String(id) : null;
}

function HlsVideo({
  url,
  onFailure,
  onAudioTracks,
  activeAudioTrack,
  onAudioTrackSwitched,
}: {
  url: string;
  onFailure: () => void;
  onAudioTracks?: (tracks: AudioTrackInfo[]) => void;
  activeAudioTrack?: number;
  onAudioTrackSwitched?: (id: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<import("hls.js").default | null>(null);

  useEffect(() => {
    if (
      hlsRef.current &&
      activeAudioTrack !== undefined &&
      hlsRef.current.audioTrack !== activeAudioTrack
    ) {
      hlsRef.current.audioTrack = activeAudioTrack;
    }
  }, [activeAudioTrack]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let hls: import("hls.js").default | null = null;

    const startPlayback = async () => {
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;

      if (Hls.isSupported()) {
        hls = new Hls({
          capLevelToPlayerSize: true,
          maxBufferLength: 30,
        });
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
        });

        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
          if (cancelled) return;
          const tracks: AudioTrackInfo[] = (data.audioTracks || []).map((t, idx) => ({
            id: idx,
            name: t.name || t.lang || `Track ${idx + 1}`,
            lang: (t.lang || "").toLowerCase(),
          }));
          onAudioTracks?.(tracks);
        });

        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
          if (cancelled) return;
          onAudioTrackSwitched?.(data.id);
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal && !cancelled) onFailure();
        });

        hls.loadSource(url);
        hls.attachMedia(video);
        return;
      }

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.play().catch(() => {});
        return;
      }

      onFailure();
    };

    void startPlayback().catch(() => {
      if (!cancelled) onFailure();
    });

    return () => {
      cancelled = true;
      hlsRef.current = null;
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [url, onFailure, onAudioTracks, onAudioTrackSwitched]);

  return (
    <video
      ref={videoRef}
      className="h-full w-full bg-black"
      controls
      autoPlay
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
  const setEpisode = useCine((state) => state.setEpisode);

  const [frameFailed, setFrameFailed] = useState(false);
  const markFrameFailed = useCallback(() => setFrameFailed(true), []);

  const [audioTracks, setAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState<number>(0);

  const title = playing?.title;
  const mediaType: MediaType | undefined = title?.mediaType;
  const tmdbId = title ? getTmdbId(title) : null;
  const movieTitle = title?.title ?? "";
  const movieYear = title?.year ?? "";

  // MovieBox (AoneRoom) direct CDN streams. When the title carries an
  // AoneRoom subjectId we resolve it directly; otherwise we search the
  // public AoneRoom H5 API by title name so EVERY movie/TV show in the
  // catalog surfaces a "MovieBox" server button in the player.
  const subjectId = title ? aoneRoomSubjectId(title) : null;
  const [aoneStreams, setAoneStreams] = useState<AoneRoomStream[]>([]);
  useEffect(() => {
    if (!title) {
      setAoneStreams([]);
      return;
    }
    let cancelled = false;
    const onStreams = (streams: AoneRoomStream[]) => {
      if (!cancelled) setAoneStreams(streams);
    };
    if (subjectId) {
      resolveAoneRoomStreams(subjectId, {
        se: playing?.episode?.seasonNumber,
        ep: playing?.episode?.number,
      })
        .then(onStreams)
        .catch(() => onStreams([]));
    } else {
      resolveAoneRoomStreamsByTitle(movieTitle, {
        mediaType,
      })
        .then(({ streams }) => onStreams(streams))
        .catch(() => onStreams([]));
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId, movieTitle, mediaType, playing?.episode?.seasonNumber, playing?.episode?.number]);

  const seasonNumber = playing?.episode?.seasonNumber ?? playing?.episode?.season ?? 1;
  const episodeNumber = playing?.episode?.number ?? playing?.episode?.episode ?? 1;

  const servers = useMemo<PlayerServer[]>(() => {
    const aoneServers: PlayerServer[] = aoneStreams.map((stream) => ({
      id: stream.id,
      name: stream.name,
      url: stream.src,
      kind: stream.kind,
      available: true,
    }));
    if (!tmdbId || !mediaType) return aoneServers;
    if (mediaType === "tv") {
      return [
        ...aoneServers,
        {
          id: "vidlink",
          name: "VidLink Pro",
          url: `https://vidlink.pro/tv/${tmdbId}/${seasonNumber}/${episodeNumber}`,
        },
        {
          id: "embed-su",
          name: "Embed.su",
          url: `https://embed.su/embed/tv/${tmdbId}/${seasonNumber}/${episodeNumber}`,
        },
        {
          id: "vidsrc",
          name: "VidSrc.cc",
          url: `https://vidsrc.cc/v2/embed/tv/${tmdbId}/${seasonNumber}/${episodeNumber}`,
        },
        {
          id: "cinejoy-auto",
          name: "CineJoy (Auto)",
          url: cineJoyTvUrl(tmdbId, seasonNumber, episodeNumber, movieTitle),
          kind: "hls",
          available: true,
        },
        {
          id: "cinejoy-lisbon",
          name: "CineJoy (Lisbon - Multi-Audio)",
          url: cineJoyTvUrl(tmdbId, seasonNumber, episodeNumber, movieTitle, "lisbon"),
          kind: "hls",
          available: true,
        },
        {
          id: "cinejoy-nebula",
          name: "CineJoy (Nebula)",
          url: cineJoyTvUrl(tmdbId, seasonNumber, episodeNumber, movieTitle, "nebula"),
          kind: "hls",
          available: true,
        },
        {
          id: "cinejoy-solara",
          name: "CineJoy (Solara)",
          url: cineJoyTvUrl(tmdbId, seasonNumber, episodeNumber, movieTitle, "solara"),
          kind: "hls",
          available: true,
        },
      ];
    }

    return [
      ...aoneServers,
      { id: "vidlink", name: "VidLink Pro", url: `https://vidlink.pro/movie/${tmdbId}` },
      { id: "embed-su", name: "Embed.su", url: `https://embed.su/embed/movie/${tmdbId}` },
      { id: "vidsrc", name: "VidSrc.cc", url: `https://vidsrc.cc/v2/embed/movie/${tmdbId}` },
      {
        id: "cinejoy-auto",
        name: "CineJoy (Auto)",
        url: cineJoyMovieUrl(tmdbId, movieTitle, movieYear),
        kind: "hls",
        available: true,
      },
      {
        id: "cinejoy-lisbon",
        name: "CineJoy (Lisbon - Multi-Audio)",
        url: cineJoyMovieUrl(tmdbId, movieTitle, movieYear, "lisbon"),
        kind: "hls",
        available: true,
      },
      {
        id: "cinejoy-nebula",
        name: "CineJoy (Nebula)",
        url: cineJoyMovieUrl(tmdbId, movieTitle, movieYear, "nebula"),
        kind: "hls",
        available: true,
      },
      {
        id: "cinejoy-solara",
        name: "CineJoy (Solara)",
        url: cineJoyMovieUrl(tmdbId, movieTitle, movieYear, "solara"),
        kind: "hls",
        available: true,
      },
    ];
  }, [tmdbId, mediaType, seasonNumber, episodeNumber, movieTitle, movieYear, aoneStreams]);

  const activeServerId =
    playing?.serverId === "cinejoy" ? "cinejoy-auto" : playing?.serverId;

  const active =
    servers.find((server) => server.id === activeServerId && server.available !== false) ??
    servers.find((server) => server.available !== false) ??
    servers[0];

  useEffect(() => {
    setFrameFailed(false);
    setAudioTracks([]);
    setActiveAudioTrack(0);
  }, [active?.url]);

  // Auto-select the first AoneRoom direct stream as soon as it resolves.
  useEffect(() => {
    if (playing && !playing.serverId && aoneStreams.length > 0) {
      setServer(aoneStreams[0]!.id);
    }
  }, [aoneStreams, playing, setServer]);

  if (!playing || !title) return null;

  const heading = playing.episode ? playing.episode.title : title.title;
  const kicker =
    title.mediaType === "tv"
      ? `${title.title} · Season ${seasonNumber}, Episode ${episodeNumber}`
      : "Movie player";

  const handlePrevEpisode = () => {
    if (episodeNumber <= 1) return;
    const prevEp = episodeNumber - 1;
    setEpisode({
      season: seasonNumber,
      episode: prevEp,
      seasonNumber,
      number: prevEp,
      title: `Season ${seasonNumber}, Episode ${prevEp}`,
    });
  };

  const handleNextEpisode = () => {
    const nextEp = episodeNumber + 1;
    setEpisode({
      season: seasonNumber,
      episode: nextEp,
      seasonNumber,
      number: nextEp,
      title: `Season ${seasonNumber}, Episode ${nextEp}`,
    });
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && closePlayer()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-bg/85" />
        <Dialog.Content className="fixed inset-0 z-[80] flex flex-col outline-none">
          <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-6">
            <div className="min-w-0">
              <Dialog.Description className="kicker">{kicker}</Dialog.Description>
              <Dialog.Title className="mt-1 truncate text-lg font-semibold sm:text-2xl">
                {heading}
              </Dialog.Title>
            </div>

            <div className="flex items-center gap-2">
              {/* TV Episode navigation controls */}
              {mediaType === "tv" ? (
                <div className="flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2 py-1 text-xs text-white shadow-lg backdrop-blur-xl">
                  <button
                    type="button"
                    disabled={episodeNumber <= 1}
                    onClick={handlePrevEpisode}
                    className="rounded-full p-1 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Previous Episode"
                    aria-label="Previous Episode"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <span className="px-1.5 font-medium tracking-wide">
                    S{seasonNumber} : E{episodeNumber}
                  </span>
                  <button
                    type="button"
                    onClick={handleNextEpisode}
                    className="rounded-full p-1 transition hover:bg-white/20"
                    title="Next Episode"
                    aria-label="Next Episode"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              ) : null}

              {/* Multi-language audio switcher for HLS */}
              {audioTracks.length > 1 ? (
                <div className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur-xl">
                  <Languages className="size-3.5 text-white/70" />
                  <span className="font-medium text-white/70">Audio:</span>
                  <select
                    value={activeAudioTrack}
                    onChange={(e) => setActiveAudioTrack(Number(e.target.value))}
                    className="cursor-pointer bg-transparent font-semibold text-white outline-none"
                    aria-label="Select audio language"
                  >
                    {audioTracks.map((track) => (
                      <option
                        key={track.id}
                        value={track.id}
                        className="bg-neutral-900 text-white"
                      >
                        {track.name} {track.lang ? `(${track.lang.toUpperCase()})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <Dialog.Close
                className="btn btn-glass btn-icon shrink-0 rounded-full border border-white/20 bg-white/10 shadow-lg backdrop-blur-xl transition hover:bg-white/20"
                aria-label="Close player"
              >
                <X className="size-5" />
              </Dialog.Close>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 items-center px-3 py-4 sm:px-6 sm:py-5">
            <div className="stage-frame relative overflow-hidden rounded-3xl border border-white/10 bg-black/80 shadow-2xl">
              {active?.kind === "hls" ? (
                <HlsVideo
                  key={active.url}
                  url={active.url}
                  onFailure={markFrameFailed}
                  onAudioTracks={setAudioTracks}
                  activeAudioTrack={activeAudioTrack}
                  onAudioTrackSwitched={setActiveAudioTrack}
                />
              ) : active?.kind === "mp4" ? (
                <Mp4Video key={active.url} url={active.url} />
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
                  <p className="max-w-md text-sm text-muted">
                    A TMDb movie/show ID is required. Select a TMDb title and, for TV, choose an episode.
                  </p>
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
            {playing.error ? (
              <p className="mx-auto mb-3 max-w-5xl text-center text-sm text-muted" role="status">
                {playing.error}
              </p>
            ) : null}
            {frameFailed ? (
              <p className="mx-auto mb-3 max-w-5xl text-center text-sm text-muted" role="status">
                {active?.kind === "hls"
                  ? "CineJoy could not resolve a stream for this title on the selected cluster. Try switching to CineJoy (Lisbon) or another server."
                  : "The selected player reported a load error. Try another server."}
              </p>
            ) : null}
            {servers.length ? (
              <div className="mx-auto flex w-fit max-w-full gap-2 overflow-x-auto rounded-full border border-white/15 bg-white/[0.08] p-2 shadow-2xl backdrop-blur-2xl">
                {servers.map((server) => (
                  <button
                    key={server.id}
                    type="button"
                    disabled={server.available === false}
                    title={
                      server.available === false
                        ? "No stream is mapped for this title yet"
                        : undefined
                    }
                    className={cn(
                      "btn shrink-0 rounded-full",
                      server.id === active?.id ? "btn-solid" : "btn-glass",
                      server.available === false && "cursor-not-allowed opacity-50"
                    )}
                    aria-pressed={server.id === active?.id}
                    onClick={() => {
                      setFrameFailed(false);
                      setServer(server.id);
                    }}
                  >
                    <Play className="size-4" />
                    <span className="max-w-48 truncate">
                      {server.available === false ? `${server.name} — unavailable` : server.name}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <p className="mt-3 text-center text-xs text-muted">
              Playback availability and languages depend on the selected provider and cluster.
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
