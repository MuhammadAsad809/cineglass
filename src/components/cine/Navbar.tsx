import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Film, Loader2, Search, Settings } from "lucide-react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Poster } from "@/components/cine/Poster";
import { searchAtelier } from "@/lib/cine/catalog";
import { useCine } from "@/lib/cine/store";
import { searchTitles } from "@/lib/cine/tmdb";
import { titleToRoute, type LibraryMode, type Shelf, type Title } from "@/lib/cine/types";
import { useDebounced } from "@/lib/cine/use-debounced";
import { hasLiveKey } from "@/lib/cine/use-play";
import { cn } from "@/lib/cn";

const SHELVES: { id: Shelf; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "movies", label: "Movies" },
  { id: "tv", label: "TV Shows" },
  { id: "favorites", label: "Favorites" },
];

function useBrowseQuery() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const params = new URLSearchParams(searchStr);
  const shelfValue = params.get("shelf");
  const shelf: Shelf =
    shelfValue === "movies" || shelfValue === "tv" || shelfValue === "favorites" || shelfValue === "trending"
      ? shelfValue
      : "trending";
  const library: LibraryMode = params.get("library") === "atelier" ? "atelier" : "live";
  return { pathname, shelf, library, onHome: pathname === "/" };
}

export function Navbar() {
  const { shelf, library, onHome } = useBrowseQuery();
  const navigate = useNavigate();
  const apiKey = useCine((state) => state.apiKey);
  const setSettingsOpen = useCine((state) => state.setSettingsOpen);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const debounced = useDebounced(query.trim(), 280);
  const live = hasLiveKey(apiKey);

  const remote = useQuery({
    queryKey: ["search", apiKey, debounced],
    queryFn: () => searchTitles(apiKey, debounced),
    enabled: live && debounced.length >= 2,
  });

  const local = searchAtelier(query);
  const remoteHits = live && debounced.length >= 2 ? (remote.data ?? []) : [];
  const results = [...local, ...remoteHits].filter(
    (title, index, all) => all.findIndex((item) => item.id === title.id) === index,
  ).slice(0, 8);
  const show = open && query.trim().length > 0;

  useEffect(() => setActive(0), [query, remote.data]);

  useEffect(() => {
    function onPointer(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!show || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      const params = titleToRoute(results[active]);
      setOpen(false);
      setQuery("");
      void navigate({ to: "/title/$kind/$id", params });
    }
  }

  return (
    <header className="sticky top-3 z-50 mt-3 px-3">
      <div className="mx-auto max-w-6xl">
        <div ref={wrapRef} className="relative">
          <nav className="glass flex items-center gap-2 rounded-full py-2 pr-2 pl-3" aria-label="Primary">
            <Link
              to="/"
              search={{ shelf: "trending", library }}
              className="flex shrink-0 items-center gap-2 rounded-full pr-1"
              aria-label="CineGlass home"
            >
              <span className="grid size-9 place-items-center rounded-full bg-fg text-bg">
                <Film className="size-4" aria-hidden="true" />
              </span>
              <span className="hidden text-sm font-semibold tracking-tight sm:inline">CineGlass</span>
            </Link>

            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <input
                className="field pr-3 pl-10"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={onKeyDown}
                placeholder="Search"
                aria-label="Search titles"
                aria-expanded={show}
                aria-controls={listId}
                role="combobox"
                aria-autocomplete="list"
              />
            </div>

            <div className="hidden items-center gap-1 lg:flex">
              <Chips shelf={shelf} library={library} onHome={onHome} />
            </div>

            <button
              type="button"
              className="btn btn-glass btn-icon shrink-0"
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="size-4" />
            </button>
          </nav>

          {show ? (
            <div id={listId} role="listbox" className="glass absolute inset-x-0 top-full z-50 mt-2 rounded-3xl p-2">
              {results.length === 0 && remote.isFetching ? (
                <p className="flex items-center gap-2 px-3 py-4 text-sm text-muted">
                  <Loader2 className="size-4 animate-spin" />
                  Searching TMDb…
                </p>
              ) : results.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted">No titles match “{query.trim()}”.</p>
              ) : (
                results.map((title, index) => (
                  <SearchRow
                    key={title.id}
                    title={title}
                    active={index === active}
                    onPick={() => {
                      setOpen(false);
                      setQuery("");
                    }}
                  />
                ))
              )}
            </div>
          ) : null}
        </div>

        <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto lg:hidden">
          <Chips shelf={shelf} library={library} onHome={onHome} />
        </div>
      </div>
    </header>
  );
}

function Chips({ shelf, library, onHome }: { shelf: Shelf; library: LibraryMode; onHome: boolean }) {
  return (
    <>
      {SHELVES.map((item) => {
        const current = onHome && shelf === item.id;
        return (
          <Link
            key={item.id}
            to="/"
            search={{ shelf: item.id, library }}
            className={cn("chip", current && "chip-active")}
            aria-current={current ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

function SearchRow({ title, active, onPick }: { title: Title; active: boolean; onPick: () => void }) {
  const params = titleToRoute(title);
  return (
    <Link
      to="/title/$kind/$id"
      params={params}
      role="option"
      aria-selected={active}
      onClick={onPick}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-2xl px-2 py-2",
        active ? "bg-fg/10" : "hover:bg-fg/10",
      )}
    >
      <Poster src={title.posterUrl} title={title.title} decorative className="h-12 w-8 shrink-0 rounded-md" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{title.title}</span>
        <span className="block truncate text-xs text-muted">
          {title.year || "—"} · {title.mediaType === "tv" ? "Series" : "Film"}
          {title.source === "atelier" ? " · Atelier" : ""}
        </span>
      </span>
    </Link>
  );
}
