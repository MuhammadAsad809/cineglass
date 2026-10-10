import { Heart, Play, Star } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Poster } from "@/components/cine/Poster";
import { cn } from "@/lib/cn";
import { useCine } from "@/lib/cine/store";
import { titleToRoute, toSnapshot, type Title } from "@/lib/cine/types";
import { usePlayTitle } from "@/lib/cine/use-play";

export function MovieCard({ title }: { title: Title }) {
  const play = usePlayTitle();
  const toggleFavorite = useCine((state) => state.toggleFavorite);
  const loved = useCine((state) => state.favorites.some((item) => item.id === title.id));
  const params = titleToRoute(title);
  const score = title.rating > 0 ? title.rating.toFixed(1) : "NR";

  return (
    <article className="group relative min-w-0">
      <div className="card-tilt shine relative aspect-poster overflow-hidden rounded-2xl bg-bg">
        <Poster src={title.posterUrl} title={title.title} className="absolute inset-0 h-full w-full" />
        <Link
          to="/title/$kind/$id"
          params={params}
          tabIndex={-1}
          aria-hidden="true"
          className="absolute inset-0 z-10"
        />
        <span className="badge-rating pointer-events-none absolute top-2 left-2 z-20">
          <Star className="size-3 fill-current" aria-hidden="true" />
          <span className="tabular-nums">{score}</span>
        </span>
        <button
          type="button"
          className="btn btn-glass btn-icon absolute top-2 right-2 z-20"
          aria-pressed={loved}
          aria-label={loved ? `Remove ${title.title} from favorites` : `Save ${title.title}`}
          onClick={() => toggleFavorite(toSnapshot(title))}
        >
          <Heart className={cn("size-4", loved && "fill-current text-rating")} />
        </button>
        <button
          type="button"
          className="btn btn-solid btn-icon absolute right-2 bottom-2 z-20"
          aria-label={`Play trailer for ${title.title}`}
          onClick={() => play(title)}
        >
          <Play className="ml-px size-4 fill-current" />
        </button>
      </div>
      <h3 className="mt-2 truncate text-sm font-medium">
        <Link
          to="/title/$kind/$id"
          params={params}
          className="rounded-sm group-hover:text-accent focus-visible:text-accent"
        >
          {title.title}
        </Link>
      </h3>
      <p className="truncate text-xs text-muted">
        {title.year || "—"} · {title.mediaType === "tv" ? "Series" : "Film"}
      </p>
    </article>
  );
}
