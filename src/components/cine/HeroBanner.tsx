import { Heart, Play, Star } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Poster } from "@/components/cine/Poster";
import { cn } from "@/lib/cn";
import { useCine } from "@/lib/cine/store";
import { titleToRoute, toSnapshot, type Title } from "@/lib/cine/types";
import { usePlayTitle } from "@/lib/cine/use-play";

export function HeroBanner({ title, mode = "feature" }: { title: Title; mode?: "feature" | "detail" }) {
  const play = usePlayTitle();
  const navigate = useNavigate();
  const toggleFavorite = useCine((state) => state.toggleFavorite);
  const loved = useCine((state) => state.favorites.some((item) => item.id === title.id));
  const wide = Boolean(title.backdropUrl);
  const score = title.rating > 0 ? title.rating.toFixed(1) : "NR";
  const meta = [
    title.year,
    title.runtimeLabel,
    title.mediaType === "tv" ? "Series" : "Film",
    ...title.genres.slice(0, 2),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="mx-auto w-full max-w-6xl px-3">
      <div className="hero-stage">
        {title.backdropUrl ? (
          <img
            src={title.backdropUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : title.posterUrl ? (
          <img
            src={title.posterUrl}
            alt=""
            className="absolute inset-0 h-full w-full scale-110 object-cover blur-3xl"
          />
        ) : null}
        <div className="hero-shade absolute inset-0" />
        <span className="badge-rating absolute top-4 left-4 z-20">
          <Star className="size-3 fill-current" aria-hidden="true" />
          <span className="tabular-nums">{score}</span>
        </span>
        <div className="relative z-10 mt-auto flex w-full flex-col gap-4 p-4 sm:flex-row sm:items-end sm:p-8">
          <Poster
            src={title.posterUrl}
            title={title.title}
            eager
            className={cn(
              "w-28 shrink-0 rounded-2xl shadow-2xl sm:w-40 md:w-48",
              wide ? "hidden sm:block" : "block",
            )}
          />
          <div className="glass w-full max-w-xl rounded-3xl p-5 sm:p-6">
            <p className="kicker">{title.source === "atelier" ? "Atelier" : "TMDb"}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title.title}</h1>
            {title.tagline ? <p className="mt-2 text-base text-fg">{title.tagline}</p> : null}
            <p className="mt-2 text-sm text-muted">{meta}</p>
            {title.creditLine ? <p className="mt-1 text-sm text-muted">{title.creditLine}</p> : null}
            {mode === "feature" ? (
              <p className="mt-3 line-clamp-3 text-sm text-muted">{title.overview}</p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" className="btn btn-solid" onClick={() => play(title)}>
                <Play className="ml-px size-4 fill-current" />
                Play trailer
              </button>
              {mode === "feature" ? (
                <button
                  type="button"
                  className="btn btn-glass"
                  onClick={() => {
                    const params = titleToRoute(title);
                    void navigate({ to: "/title/$kind/$id", params });
                  }}
                >
                  Details
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-glass btn-icon"
                aria-pressed={loved}
                aria-label={loved ? `Remove ${title.title} from favorites` : `Save ${title.title}`}
                onClick={() => toggleFavorite(toSnapshot(title))}
              >
                <Heart className={cn("size-4", loved && "fill-current text-rating")} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
