import { useInfiniteQuery } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { GridSkeleton, MovieGrid } from "@/components/cine/MovieGrid";
import { HeroBanner } from "@/components/cine/HeroBanner";
import { atelierShelf, resolveTitle } from "@/lib/cine/catalog";
import { useCine } from "@/lib/cine/store";
import { fetchShelf, formatTmdbError } from "@/lib/cine/tmdb";
import type { LibraryMode, Shelf } from "@/lib/cine/types";
import { hasLiveKey } from "@/lib/cine/use-play";
import { cn } from "@/lib/cn";

const COPY: Record<Shelf, { heading: string; live: string; atelier: string }> = {
  trending: {
    heading: "Trending",
    live: "This week, via TMDb.",
    atelier: "Original pictures, screening in the Atelier.",
  },
  movies: {
    heading: "Movies",
    live: "Popular films right now.",
    atelier: "Atelier features.",
  },
  tv: {
    heading: "TV Shows",
    live: "Popular series right now.",
    atelier: "Atelier series.",
  },
  favorites: {
    heading: "Favorites",
    live: "Saved on this device.",
    atelier: "Saved on this device.",
  },
};

export function Browse({ shelf, library }: { shelf: Shelf; library: LibraryMode }) {
  const hydrated = useCine((state) => state.hydrated);
  const apiKey = useCine((state) => state.apiKey);
  const favorites = useCine((state) => state.favorites);
  const navigate = useNavigate();
  const liveShelf = shelf === "movies" || shelf === "tv" ? shelf : "trending";
  const live = hasLiveKey(apiKey) && library !== "atelier" && shelf !== "favorites";

  const query = useInfiniteQuery({
    queryKey: ["shelf", liveShelf, apiKey],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchShelf(apiKey, liveShelf, pageParam),
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: live,
  });

  if (!hydrated) {
    return (
      <main>
        <div className="mx-auto max-w-6xl px-3">
          <div className="hero-stage skeleton" />
        </div>
        <div className="mx-auto mt-10 max-w-6xl px-3">
          <GridSkeleton />
        </div>
      </main>
    );
  }

  const remote = query.data?.pages.flatMap((page) => page.titles) ?? [];
  const titles =
    shelf === "favorites"
      ? favorites.map(resolveTitle)
      : live
        ? remote
        : atelierShelf(shelf === "tv" ? "tv" : shelf === "movies" ? "movies" : "trending");
  const loading = live && query.isLoading;
  const failed = live && query.isError;
  const usingAtelier = !live && shelf !== "favorites";
  const copy = COPY[shelf];
  const hero = titles[0];

  function setLibrary(next: LibraryMode) {
    void navigate({ to: "/", search: { shelf, library: next } });
  }

  const toggle = hasLiveKey(apiKey) ? (
    <div className="flex gap-2">
      <button
        type="button"
        className={cn("chip", library !== "atelier" && "chip-active")}
        onClick={() => setLibrary("live")}
      >
        Live
      </button>
      <button
        type="button"
        className={cn("chip", library === "atelier" && "chip-active")}
        onClick={() => setLibrary("atelier")}
      >
        Atelier
      </button>
    </div>
  ) : null;

  return (
    <main className="pb-4">
      {loading ? (
        <div className="mx-auto max-w-6xl px-3">
          <div className="hero-stage skeleton" />
        </div>
      ) : hero ? (
        <HeroBanner title={hero} />
      ) : shelf === "favorites" ? (
        <section className="mx-auto max-w-6xl px-3">
          <div className="glass rounded-3xl px-6 py-16 text-center">
            <Heart className="mx-auto size-8 text-rating" />
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">Nothing saved yet</h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              Tap the heart on a title and it will wait here, on this device.
            </p>
            <Link to="/" search={{ shelf: "trending", library }} className="btn btn-solid mt-5">
              Browse trending
            </Link>
          </div>
        </section>
      ) : null}

      {failed ? (
        <section className="mx-auto mt-8 max-w-6xl px-3">
          <div className="glass rounded-3xl px-6 py-10 text-center">
            <h2 className="text-xl font-semibold">The live shelf didn't load</h2>
            <p className="mt-2 text-sm text-muted">{formatTmdbError(query.error)}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button type="button" className="btn btn-solid" onClick={() => void query.refetch()}>
                Try again
              </button>
              <button type="button" className="btn btn-glass" onClick={() => setLibrary("atelier")}>
                Browse the Atelier
              </button>
            </div>
          </div>
        </section>
      ) : loading ? (
        <div className="mx-auto mt-10 max-w-6xl px-3">
          <GridSkeleton />
        </div>
      ) : titles.length > 0 ? (
        <>
          <MovieGrid
            heading={copy.heading}
            subtitle={usingAtelier || shelf === "favorites" ? copy.atelier : copy.live}
            titles={titles}
            action={shelf === "favorites" ? null : toggle}
          />
          {live && query.hasNextPage ? (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                className="btn btn-glass"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? "Loading…" : "More titles"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
