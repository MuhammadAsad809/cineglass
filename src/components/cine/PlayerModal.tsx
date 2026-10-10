import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import Hls, { type ErrorData, type ErrorTypes } from "hls.js";
import {
  AlertTriangle,
  LoaderCircle,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCine } from "@/lib/cine/store";
import { resolveStream, ResolveError } from "@/lib/cine/resolve-stream";
import type { ResolvedPlaybackStream, Title } from "@/lib/cine/types";

const RESOLVE_TIMEOUT_MS = 30_000;
const MAX_RESOLVE_ATTEMPTS = 2;
const NETWORK_ERROR_TYPES: string[] = ["networkError"];
const MEDIA_ERROR_TYPES: string[] = ["mediaError"];

type Phase = "idle" | "resolving" | "loading" | "playing" | "error";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function describeHlsError(type: ErrorTypes | string, details: string, fatal: boolean): string {
  if (NETWORK_ERROR_TYPES.includes(type)) {
    return fatal
      ? "The stream could not be loaded. The link may have expired — try again."
      : "A segment request failed; retrying…";
  }
  if (MEDIA_ERROR_TYPES.includes(type)) {
    return fatal
      ? "This stream uses a format the player cannot decode."
      : "A media segment failed to decode; recovering…";
  }
  return fatal ? `Playback failed (${details}).` : "The stream reported a problem; retrying…";
}

export function PlayerModal() {
  const playing = useCine((state) => state.playing);
  const closePlayer = useCine((state) => state.closePlayer);
  const title = playing?.title;
  const episode = playing?.episode;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const attemptRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [streamKey, setStreamKey] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const key = title ? `${title.id}|${episode ? `${episode.seasonNumber ?? 0}:${episode.number}` : ""}` : "";

  // ── Resolve + attach stream whenever the selected title/episode changes ──
  useEffect(() => {
    if (!title) return;

    let cancelled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const detach = () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    };

    detach();
    attemptRef.current = 0;
    setError(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setBuffered(0);
    setPhase("resolving");

    const attach = (stream: ResolvedPlaybackStream) => {
      if (cancelled) return;
      const video = videoRef.current;
      if (!video) return;
      setPhase("loading");

      if (stream.kind === "mp4") {
        video.src = stream.src;
        void video.play().catch(() => undefined);
        return;
      }

      if (Hls.isSupported()) {
        const hls = new Hls({
          capLevelToPlayerSize: true,
          maxBufferLength: 30,
          manifestLoadingTimeOut: 15_000,
          manifestLoadingMaxRetry: 2,
          levelLoadingTimeOut: 12_000,
          fragLoadingTimeOut: 20_000,
          fragLoadingMaxRetry: 4,
        });
        hlsRef.current = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          void video.play().catch(() => undefined);
        });
        hls.on(Hls.Events.ERROR, (_event, data: ErrorData) => {
          if (!data.fatal) return;
          if (attemptRef.current < MAX_RESOLVE_ATTEMPTS) {
            attemptRef.current += 1;
            // Expired/rotated stream: re-resolve through the proxy.
            hls.destroy();
            hlsRef.current = null;
            void start(true);
            return;
          }
          setError(describeHlsError(String(data.type), data.details, true));
          setPhase("error");
        });
        hls.loadSource(stream.src);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Native HLS (Safari / iOS).
        video.src = stream.src;
        void video.play().catch(() => undefined);
      } else {
        setError("This browser cannot play HLS streams.");
        setPhase("error");
      }
    };

    const start = async (isRetry: boolean) => {
      try {
        if (!isRetry) setPhase("resolving");
        const controller = new AbortController();
        timeoutHandle = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
        const stream = await resolveStream(title, episode, controller.signal);
        clearTimeout(timeoutHandle);
        attach(stream);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") {
          setError("Resolving this stream took too long. Try again.");
        } else if (err instanceof ResolveError) {
          setError(err.message);
        } else {
          setError("Something went wrong while resolving playback.");
        }
        setPhase("error");
      }
    };

    void start(false);

    return () => {
      cancelled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, streamKey]);

  // ── Video element events ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onLoadedMetadata = () => setDuration(video.duration);
    const onProgress = () => {
      if (video.buffered.length > 0) setBuffered(video.buffered.end(video.buffered.length - 1));
    };
    const onWaiting = () => setPhase((p) => (p === "playing" ? "loading" : p));
    const onPlaying = () => {
      setPhase("playing");
      attemptRef.current = 0;
    };
    const onError = () => {
      if (hlsRef.current) return; // hls.js reports its own errors
      setPhase((p) => {
        if (p === "error") return p;
        setError("The video element could not load this source.");
        return "error";
      });
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("progress", onProgress);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onError);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
    };
  }, []);

  // ── Fullscreen tracking ──
  const stageRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(Math.max(0, seconds), video.duration);
    setCurrentTime(video.currentTime);
  }, []);

  const changeVolume = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.min(Math.max(0, value), 1);
    video.muted = video.volume === 0;
    setVolume(video.volume);
    setMuted(video.muted);
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement === stage) void document.exitFullscreen().catch(() => undefined);
    else void stage.requestFullscreen().catch(() => undefined);
  }, []);

  const retry = useCallback(() => setStreamKey((k) => k + 1), []);

  if (!playing || !title) return null;

  const heading = episode ? episode.title : title.title;
  const kicker = episode
    ? `${title.title} · season ${episode.seasonNumber}, episode ${episode.number}`
    : title.mediaType === "tv"
      ? "Series player"
      : "Movie player";
  const showSpinner = phase === "resolving" || phase === "loading" || playing.loading;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && closePlayer()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-bg/75 backdrop-blur-2xl" />
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

          <div className="flex min-h-0 flex-1 items-center justify-center px-3 py-4 sm:px-6 sm:py-5">
            <div
              ref={stageRef}
              className="stage-frame relative overflow-hidden rounded-3xl border border-white/10 bg-black shadow-2xl"
            >
              <video
                ref={videoRef}
                className="absolute inset-0 size-full bg-black"
                playsInline
                autoPlay
              />

              {showSpinner && (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 p-6 text-center"
                  role="status"
                  aria-live="polite"
                >
                  <LoaderCircle className="size-9 animate-spin text-muted" />
                  <p className="font-medium">
                    {phase === "resolving" ? "Finding a playable stream…" : "Buffering…"}
                  </p>
                </div>
              )}

              {phase === "error" && error && (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 p-6 text-center"
                  role="alert"
                >
                  <AlertTriangle className="size-8 text-amber-400" />
                  <p className="font-medium">Playback unavailable</p>
                  <p className="max-w-md text-sm text-muted">{error}</p>
                  <button type="button" className="btn btn-primary mt-2" onClick={retry}>
                    <RotateCcw className="size-4" />
                    Try again
                  </button>
                </div>
              )}

              {!showSpinner && phase !== "error" && !isPlaying && (
                <button
                  type="button"
                  className="absolute inset-0 flex items-center justify-center bg-black/30 transition hover:bg-black/40"
                  onClick={togglePlay}
                  aria-label="Play"
                >
                  <span className="flex size-16 items-center justify-center rounded-full bg-white/15 backdrop-blur-md">
                    <Play className="size-8 translate-x-0.5" />
                  </span>
                </button>
              )}

              {/* Controls bar */}
              <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/85 to-transparent px-4 pb-3 pt-8">
                <input
                  type="range"
                  aria-label="Seek"
                  className="w-full accent-white"
                  min={0}
                  max={Math.max(duration, 0.1)}
                  step={0.1}
                  value={Math.min(currentTime, duration || 0)}
                  onChange={(e) => seekTo(Number(e.target.value))}
                />
                <div className="flex items-center gap-3 text-sm">
                  <button type="button" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
                    {isPlaying ? <Pause className="size-5" /> : <Play className="size-5" />}
                  </button>
                  <span className="tabular-nums text-xs text-white/80">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                  <span className="hidden text-[10px] text-white/40 sm:inline">
                    buffered {formatTime(buffered)}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
                      {muted || volume === 0 ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
                    </button>
                    <input
                      type="range"
                      aria-label="Volume"
                      className="w-20 accent-white"
                      min={0}
                      max={1}
                      step={0.05}
                      value={muted ? 0 : volume}
                      onChange={(e) => changeVolume(Number(e.target.value))}
                    />
                    <button type="button" onClick={toggleFullscreen} aria-label="Toggle fullscreen">
                      {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="px-3 pb-5 sm:px-6 sm:pb-7">
            {playing.error ? (
              <p className="mx-auto mb-3 max-w-5xl text-center text-sm text-muted" role="status">
                {playing.error}
              </p>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Keep the exported helper used by tests and future callers.
export function tmdbIdForPlayer(title: Title): number | null {
  if (title.source !== "tmdb") return null;
  const id = title.tmdbId ?? Number(title.id.split(":").pop());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
