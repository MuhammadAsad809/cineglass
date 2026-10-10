import { Play } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Poster } from "@/components/cine/Poster";
import { cn } from "@/lib/cn";
import type { Episode, SeasonMeta } from "@/lib/cine/types";

function airLabel(value?: string): string | null {
  if (!value) return null;
  const date = parseISO(value);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, "MMM d, yyyy");
}

export function SeasonSelector({
  seasons,
  active,
  episodes,
  loading,
  error,
  onSeason,
  onPlayEpisode,
}: {
  seasons: SeasonMeta[];
  active: number;
  episodes: Episode[];
  loading: boolean;
  error?: string;
  onSeason: (season: number) => void;
  onPlayEpisode: (episode: Episode) => void;
}) {
  if (seasons.length === 0) return null;

  return (
    <section className="mt-10">
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Episodes</h2>
        <p className="text-sm text-muted">Series preview, not a full episode stream.</p>
      </div>
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-3">
        {seasons.map((season) => (
          <button
            key={season.number}
            type="button"
            className={cn("chip shrink-0", season.number === active && "chip-active")}
            aria-pressed={season.number === active}
            onClick={() => onSeason(season.number)}
          >
            {season.name || `Season ${season.number}`}
          </button>
        ))}
      </div>
      {error ? (
        <p className="glass rounded-2xl px-4 py-3 text-sm text-muted" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <div className="grid gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="skeleton h-28 rounded-2xl" />
          ))}
        </div>
      ) : (
        <ol className="grid gap-3">
          {episodes.map((episode) => {
            const aired = airLabel(episode.airDate);
            return (
              <li key={episode.id} className="glass overflow-hidden rounded-2xl">
                <div className="grid sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:items-center">
                  <Poster
                    src={episode.stillUrl}
                    title={episode.title}
                    decorative
                    focus={episode.stillFocus}
                    className="aspect-still sm:aspect-auto sm:h-full sm:min-h-28"
                  />
                  <div className="min-w-0 p-3 sm:p-4">
                    <p className="text-xs font-medium tracking-wide text-accent uppercase">
                      Episode {episode.number}
                      {aired ? ` · ${aired}` : ""}
                      {episode.runtime ? ` · ${episode.runtime}m` : ""}
                    </p>
                    <h3 className="mt-1 truncate text-base font-medium">{episode.title}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-muted">{episode.overview}</p>
                  </div>
                  <div className="px-3 pb-3 sm:px-4 sm:pb-0">
                    <button
                      type="button"
                      className="btn btn-glass w-full sm:w-auto"
                      onClick={() => onPlayEpisode(episode)}
                    >
                      <Play className="ml-px size-4 fill-current" />
                      Preview
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
