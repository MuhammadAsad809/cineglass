import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { serversFor } from "@/lib/cine/servers";
import {
  isTitleSnapshot,
  toSnapshot,
  type Episode,
  type Playback,
  type Title,
  type TitleSnapshot,
} from "@/lib/cine/types";

interface CineState {
  apiKey: string;
  region: string;
  favorites: TitleSnapshot[];
  hydrated: boolean;
  playing: Playback | null;
  settingsOpen: boolean;
  setApiKey: (apiKey: string) => void;
  setRegion: (region: string) => void;
  toggleFavorite: (title: TitleSnapshot) => void;
  openPlayer: (title: Title, episode?: Episode) => void;
  upgradePlayer: (title: Title) => void;
  failPlayer: (error: string) => void;
  setServer: (serverId: string) => void;
  closePlayer: () => void;
  setSettingsOpen: (open: boolean) => void;
}

const memory = new Map<string, string>();

const safeStorage = {
  getItem: (name: string) => {
    if (typeof window === "undefined") return memory.get(name) ?? null;
    return localStorage.getItem(name);
  },
  setItem: (name: string, value: string) => {
    if (typeof window === "undefined") memory.set(name, value);
    else localStorage.setItem(name, value);
  },
  removeItem: (name: string) => {
    if (typeof window === "undefined") memory.delete(name);
    else localStorage.removeItem(name);
  },
};

function normalizeFavorite(value: TitleSnapshot): TitleSnapshot {
  return {
    ...toSnapshot(value),
    overview: typeof value.overview === "string" ? value.overview : "",
    posterUrl: typeof value.posterUrl === "string" ? value.posterUrl : null,
    backdropUrl: typeof value.backdropUrl === "string" ? value.backdropUrl : null,
    year: typeof value.year === "string" ? value.year : "",
    rating: typeof value.rating === "number" ? value.rating : 0,
    genres: Array.isArray(value.genres) ? value.genres.filter((genre) => typeof genre === "string") : [],
  };
}

export const useCine = create<CineState>()(
  persist(
    (set, get) => ({
      apiKey: "",
      region: "US",
      favorites: [],
      hydrated: false,
      playing: null,
      settingsOpen: false,
      setApiKey: (apiKey) => set({ apiKey: apiKey.trim() }),
      setRegion: (region) => set({ region }),
      toggleFavorite: (title) => {
        const snapshot = normalizeFavorite(toSnapshot(title));
        const current = get().favorites;
        const exists = current.some((item) => item.id === snapshot.id);
        set({
          favorites: exists
            ? current.filter((item) => item.id !== snapshot.id)
            : [snapshot, ...current].slice(0, 60),
        });
      },
      openPlayer: (title, episode) => {
        const servers = serversFor(title);
        const hasPreview = servers.some((server) => server.kind !== "prelude");
        set({
          playing: {
            title,
            episode,
            serverId: servers[0]?.id ?? "prelude",
            loading: title.source === "tmdb" && !hasPreview,
          },
        });
      },
      upgradePlayer: (title) =>
        set((state) => {
          if (!state.playing || state.playing.title.id !== title.id) return state;
          const servers = serversFor(title);
          const current = state.playing.serverId;
          const keep = current !== "prelude" && servers.some((server) => server.id === current);
          const next = keep
            ? current
            : (servers.find((server) => server.kind !== "prelude")?.id ?? "prelude");
          return {
            playing: { ...state.playing, title, serverId: next, loading: false, error: undefined },
          };
        }),
      failPlayer: (error) =>
        set((state) => (state.playing ? { playing: { ...state.playing, loading: false, error } } : state)),
      setServer: (serverId) =>
        set((state) => (state.playing ? { playing: { ...state.playing, serverId } } : state)),
      closePlayer: () => set({ playing: null }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    }),
    {
      name: "cineglass",
      version: 1,
      skipHydration: true,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({
        apiKey: state.apiKey,
        region: state.region,
        favorites: state.favorites,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<CineState>;
        const favorites = Array.isArray(saved.favorites)
          ? saved.favorites.filter(isTitleSnapshot).map(normalizeFavorite)
          : [];
        return {
          ...current,
          apiKey: typeof saved.apiKey === "string" ? saved.apiKey : "",
          region: typeof saved.region === "string" && /^[A-Z]{2}$/.test(saved.region) ? saved.region : "US",
          favorites,
        };
      },
    },
  ),
);
