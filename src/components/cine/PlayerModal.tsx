import * as Dialog from "@radix-ui/react-dialog";
import { Play, X } from "lucide-react";
import { useCine } from "@/lib/cine/store";

export function PlayerModal() {
  const playing = useCine((state) => state.playing);
  const closePlayer = useCine((state) => state.closePlayer);

  const title = playing?.title;

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
              <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
                <Play className="size-8 text-muted" />
                <p className="font-medium">Streaming embeds removed</p>
                <p className="max-w-md text-sm text-muted">
                  This build only uses TMDb for catalog data. Third-party streaming providers have been
                  removed; use the trailer or browse TMDb titles for details.
                </p>
              </div>
              {playing.loading ? (
                <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-2 text-sm text-white backdrop-blur-xl">
                  Loading title details…
                </div>
              ) : null}
            </div>
          </div>

          <div className="px-3 pb-5 sm:px-6 sm:pb-7">
            {playing.error ? <p className="mx-auto mb-3 max-w-5xl text-center text-sm text-muted" role="status">{playing.error}</p> : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
