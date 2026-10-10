import type { Server, Title } from "@/lib/cine/types";

export const PRELUDE_SERVER: Server = {
  id: "prelude",
  name: "Motion still",
  kind: "prelude",
};

const YOUTUBE_KEY = /^[\w-]{6,20}$/;

export function serversFor(title: Pick<Title, "servers">): Server[] {
  const listed = (title.servers ?? []).filter((server) => {
    if (server.kind === "prelude") return false;
    if (server.youtubeKey && !YOUTUBE_KEY.test(server.youtubeKey)) return false;
    if (server.src && !server.src.startsWith("/trailers/")) return false;
    return true;
  });
  return [...listed, PRELUDE_SERVER];
}

export function youtubeEmbed(key: string): string | null {
  if (!YOUTUBE_KEY.test(key)) return null;
  return `https://www.youtube-nocookie.com/embed/${key}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
}
