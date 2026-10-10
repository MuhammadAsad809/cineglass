import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { HeroBanner } from "@/components/cine/HeroBanner";
import { SeasonSelector } from "@/components/cine/SeasonSelector";
import { getAtelier } from "@/lib/cine/catalog";
import { regionName } from "@/lib/cine/regions";
import { useCine } from "@/lib/cine/store";
import { fetchSeason, fetchTitleDetail, formatTmdbError } from "@/lib/cine/tmdb";
import type { Episode, Title, WatchProvider } from "@/lib/cine/types";
import { hasLiveKey, usePlayTitle } from "@/lib/cine/use-play";

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

export function DetailView({ kind, id }: { kind: string; id: string }) {
  const hydrated = useCine((state) => state.hydrated);
  const apiKey = useCine((state) => state.apiKey);
  const region = useCine((state) => state.region);
  const setSettingsOpen = useCine((state) => state.setSettingsOpen);
  const play = usePlayTitle();
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const validKind = kind === "movie" || kind === "tv" || kind === "atelier";
  const atelier = kind === "atelier" ? getAtelier(`atelier:${id}`) : undefined;
  const liveId = kind === "movie" || kind === "tv" ? Number(id) : NaN;
  const canFetch = kind !== "atelier" && Number.isInteger(liveId) && hasLiveKey(apiKey);

  const detail = useQuery({
    queryKey: ["title", apiKey, kind, id, region],
    queryFn: () => fetchTitleDetail(apiKey, kind === "tv" ? "tv" : "movie", liveId, region),
    enabled: canFetch,
  });

  const title: Title | undefined = atelier ?? detail.data;
  const [seasonNo, setSeasonNo] = useState<number | null>(null);
  const seasons = title?.seasons ?? [];
  const activeSeason = seasonNo ?? seasons.find((season) => season.number === 1)?.number ?? seasons[0]?.number ?? 1;
  const embedded = seasons.find((season) => season.number === activeSeason)?.episodes;

  const seasonQuery = useQuery({
    queryKey: ["season", apiKey, liveId, activeSeason],
    queryFn: () => fetchSeason(apiKey, liveId, activeSeason),
    enabled: canFetch && kind === "tv" && Boolean(title) && !embedded,
  });

  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title.title} · CineGlass`;
    return () => {
      document.title = previous;
    };
  }, [title]);

  function goBack() {
    if (canGoBack) router.history.back();
    else void navigate({ to: "/", search: { shelf: "trending", library: "live" } });
  }

  if (!validKind) return <Missing onBack={goBack} message="That address doesn't match a title." />;
  if (!hydrated) {
    return (
      <main className="mx-auto max-w-6xl px-3">
        <div className="hero-stage skeleton" />
      </main>
    );
  }
  if (kind === "atelier" && !atelier) {
    return <Missing onBack={goBack} message="This Atelier title isn't on the shelf." />;
  }
  if (kind !== "atelier" && !hasLiveKey(apiKey)) {
    return (
      <Missing
        onBack={goBack}
        message="This title lives in the TMDb catalog. Add your key to open it."
        actionLabel="Open settings"
        onAction={() => setSettingsOpen(true)}
      />
    );
  }
  if (kind !== "atelier" && detail.isLoading) {
    return (
      <main className="mx-auto max-w-6xl px-3">
        <div className="hero-stage skeleton" />
      </main>
    );
  }
  if (kind !== "atelier" && detail.isError) {
    return <Missing onBack={goBack} message={formatTmdbError(detail.error)} />;
  }
  if (!title) return <Missing onBack={goBack} message="This title isn't available." />;

  const episodes: Episode[] = embedded ?? seasonQuery.data ?? [];
  const groups: Array<{ type: WatchProvider["type"]; label: string }> = [
    { type: "stream", label: "Stream" },
    { type: "rent", label: "Rent" },
    { type: "buy", label: "Buy" },
  ];

  return (
    <main className="pb-8">
      <div className="mx-auto mb-4 w-full max-w-6xl px-3">
        <button type="button" className="btn btn-glass" onClick={goBack}>
          <ChevronLeft className="size-4" />
          Browse
        </button>
      </div>
      <HeroBanner title={title} mode="detail" />
      <div className="mx-auto mt-8 w-full max-w-6xl px-3">
        <p className="max-w-3xl text-base text-fg/90">{title.overview}</p>
        {title.genres.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-2">
            {title.genres.map((genre) => (
              <li key={genre} className="pill">
                {genre}
              </li>
            ))}
          </ul>
        ) : null}

        {title.cast && title.cast.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight">Cast</h2>
            <ul className="no-scrollbar mt-4 flex gap-4 overflow-x-auto pb-2">
              {title.cast.map((person) => (
                <li key={`${title.id}-${person.id}`} className="w-28 shrink-0 text-center">
                  <div className="mx-auto grid size-16 place-items-center overflow-hidden rounded-full bg-fg/10">
                    {person.profileUrl ? (
                      <img src={person.profileUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-sm font-medium">{initials(person.name)}</span>
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm font-medium">{person.name}</p>
                  <p className="line-clamp-2 text-xs text-muted">{person.character}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {title.mediaType === "tv" ? (
          <SeasonSelector
            seasons={seasons}
            active={activeSeason}
            episodes={episodes}
            loading={seasonQuery.isLoading && !embedded}
            error={seasonQuery.isError ? formatTmdbError(seasonQuery.error) : undefined}
            onSeason={setSeasonNo}
            onPlayEpisode={(episode) => play(title, { ...episode, seasonNumber: activeSeason })}
          />
        ) : null}

        <section className="mt-10">
          <h2 className="text-xl font-semibold tracking-tight">Where to watch</h2>
          {title.source === "atelier" ? (
            <p className="mt-2 max-w-2xl text-sm text-muted">
              Atelier pictures screen here as trailers and motion stills. Connect a TMDb key to see storefronts for
              released films in {regionName(region)}.
            </p>
          ) : (title.providers?.length ?? 0) === 0 ? (
            <p className="mt-2 max-w-2xl text-sm text-muted">
              Nothing is listed for {regionName(region)} right now. You can change region in Settings.
            </p>
          ) : (
            <div className="mt-4 grid gap-5">
              <p className="text-sm text-muted">Opens the TMDb watch guide for {regionName(region)}.</p>
              {groups.map((group) => {
                const items = (title.providers ?? []).filter((provider) => provider.type === group.type);
                if (items.length === 0) return null;
                return (
                  <div key={group.type}>
                    <h3 className="text-xs font-semibold tracking-widest text-muted uppercase">{group.label}</h3>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {items.map((provider) => (
                        <li key={provider.id}>
                          {title.providerLink ? (
                            <a
                              className="btn btn-glass"
                              href={title.providerLink}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {provider.logoUrl ? (
                                <img src={provider.logoUrl} alt="" className="size-6 rounded-md object-cover" />
                              ) : null}
                              {provider.name}
                              <ExternalLink className="size-3.5 opacity-70" />
                            </a>
                          ) : (
                            <span className="btn btn-glass">{provider.name}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
          {title.homepage ? (
            <a
              className="btn btn-glass mt-4"
              href={title.homepage}
              target="_blank"
              rel="noopener noreferrer"
            >
              Official site
              <ExternalLink className="size-3.5" />
            </a>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function Missing({
  message,
  onBack,
  actionLabel,
  onAction,
}: {
  message: string;
  onBack: () => void;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <div className="glass rounded-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Title unavailable</h1>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" className="btn btn-solid" onClick={onBack}>
            <ChevronLeft className="size-4" />
            Browse
          </button>
          {actionLabel && onAction ? (
            <button type="button" className="btn btn-glass" onClick={onAction}>
              {actionLabel}
            </button>
          ) : null}
        </div>
      </div>
    </main>
  );
}
