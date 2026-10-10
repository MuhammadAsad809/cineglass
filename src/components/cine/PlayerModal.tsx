import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LoaderCircle, Play, X } from "lucide-react";
import { useCine } from "@/lib/cine/store";
import { fetchWingMovieInfo, type WingMovieInfo } from "@/lib/cine/wing";
import type { Title } from "@/lib/cine/types";

function getTmdbMovieId(title: Title): number | null {
  if (title.mediaType !== "movie" || title.source !== "tmdb") return null;
  const id = title.tmdbId ?? Number(title.id.split(":").pop());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function PlayerModal() {
  const playing = useCine((state) => state.playing);
  const closePlayer = useCine((state) => state.closePlayer);
  const title = playing?.title;
  const tmdbId = title ? getTmdbMovieId(title) : null;
  const [wingInfo, setWingInfo] = useState<WingMovieInfo | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  useEffect(() => {
    setWingInfo(null);
    setLookupError(null);

    if (!playing || !title) {
      setLookupLoading(false);
      return;
    }
    if (title.mediaType !== "movie") {
      setLookupLoading(false);
      setLookupError("The supplied Wing endpoint is for movies only. TV-season and episode playback is not documented.");
      return;
    }
    if (tmdbId === null) {
      setLookupLoading(false);
      setLookupError("A valid TMDb movie ID is required for the Wing lookup.");
      return;
    }

    let active = true;
    setLookupLoading(true);
    void fetchWingMovieInfo(tmdbId)
      .then((info) => {
        if (active) setWingInfo(info);
      })
      .catch((error: unknown) => {
        if (active) {
          setLookupError(error instanceof Error ? error.message : "Wing API lookup failed.");
        }
      })
      .finally(() => {
        if (active) setLookupLoading(false);
      });

    return () => {
      active = false;
    };
  }, [playing, title, tmdbId]);

  if (!playing || !title) return null;

  const heading = playing.episode ? playing.episode.title : title.title;
  const kicker = playing.episode
    ? `${title.title} · season ${playing.episode.seasonNumber}, episode ${playing.episode.number}`
    : title.mediaType === "tv" ? "Series player" : "Movie player";

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

          <div className="flex min-h-0 flex-1 items-center px-3 py-4 sm:px-6 sm:py-5">
            <div className="stage-frame relative overflow-hidden rounded-3xl border border-white/10 bg-black/80 shadow-2xl">
              {lookupLoading || playing.loading ? (
                <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-6 text-center" role="status" aria-live="polite">
                  <LoaderCircle className="size-8 animate-spin text-muted" />
                  <p className="font-medium">Checking playback availability…</p>
                  <p className="max-w-md text-sm text-muted">Looking up this movie with the Wing API.</p>
                </div>
              ) : lookupError ? (
                <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
                  <Play className="size-8 text-muted" />
                  <p className="font-medium">Playback information unavailable</p>
                  <p className="max-w-md text-sm text-muted">{lookupError}</p>
                </div>
              ) : wingInfo ? (
                <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-6 text-center" role="status">
                  <Play className="size-8 text-muted" />
                  <p className="font-medium">{wingInfo.title}</p>
                  <p className="text-sm text-muted">
                    {[wingInfo.year, wingInfo.runtime ? `${wingInfo.runtime} min` : null, wingInfo.quality]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="max-w-md text-sm text-muted">
                    The Wing response contains movie metadata but no documented playback URL. No HLS stream was loaded.
                  </p>
                </div>
              ) : (
                <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-6 text-center" role="status">
                  <Play className="size-8 text-muted" />
                  <p className="font-medium">No playback source available</p>
                </div>
              )}
            </div>
          </div>

          <div className="px-3 pb-5 sm:px-6 sm:pb-7">
            {playing.error ? <p className="mx-auto mb-3 max-w-5xl text-center text-sm text-muted" role="status">{playing.error}</p> : null}
            <p className="mt-2 text-center text-xs text-muted">
              HLS playback can be enabled when the provider supplies a documented, authorized stream URL.
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
