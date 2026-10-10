import { useCallback } from "react";
import { getAtelier } from "@/lib/cine/catalog";
import { useCine } from "@/lib/cine/store";
import { fetchTitleDetail, formatTmdbError } from "@/lib/cine/tmdb";
import type { Episode, Title } from "@/lib/cine/types";

export function usePlayTitle() {
  const apiKey = useCine((state) => state.apiKey);
  const region = useCine((state) => state.region);
  const openPlayer = useCine((state) => state.openPlayer);
  const upgradePlayer = useCine((state) => state.upgradePlayer);
  const failPlayer = useCine((state) => state.failPlayer);

  return useCallback(
    (title: Title, episode?: Episode) => {
      const resolved = title.source === "atelier" ? (getAtelier(title.id) ?? title) : title;
      openPlayer(resolved, episode);
      if (resolved.source !== "tmdb" || !resolved.tmdbId) return;
      if ((resolved.servers?.length ?? 0) > 0) return;
      void fetchTitleDetail(apiKey, resolved.mediaType, resolved.tmdbId, region)
        .then((full) => upgradePlayer(full))
        .catch((error: unknown) => failPlayer(formatTmdbError(error)));
    },
    [apiKey, region, openPlayer, upgradePlayer, failPlayer],
  );
}

export function hasLiveKey(apiKey: string): boolean {
  return apiKey.trim().length >= 16;
}
