/**
 * Client-safe mirror of the same-origin media passthrough mapping used by
 * src/lib/cine/aoneroom-proxy.server.ts (which is `.server` only and must not
 * be imported from browser code). Keep both MEDIA host allowlists in sync.
 */

export const AONEROOM_MEDIA_PREFIX = "/api/aoneroom/media";

const MEDIA_HOSTS = new Set(["macdn.aoneroom.com", "cdn.aoneroom.com", "pbcdnw.aoneroom.com"]);

/** Rewrites an upstream AoneRoom CDN URL to its same-origin playable path. */
export function toSameOriginMediaUrl(upstreamUrl: string): string | null {
  try {
    const parsed = new URL(upstreamUrl);
    if (parsed.protocol !== "https:") return null;
    if (!MEDIA_HOSTS.has(parsed.hostname)) return null;
    if (!/^\/media\//.test(parsed.pathname)) return null;
    const bytes = new TextEncoder().encode(parsed.toString());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const base64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `${AONEROOM_MEDIA_PREFIX}/${base64}`;
  } catch {
    return null;
  }
}
