/**
 * Global Nitro middleware that mounts the server-only CineJoy proxy.
 * Auto-registered because vite.config.ts sets `serverDir: "./server"` (nitro()
 * plugin is only applied for build/preview; dev traffic is served by the
 * matching Vite middleware registered in vite.config.ts).
 */
import { handleCineJoyProxyRequest } from "@/lib/cine/cinejoy-proxy";

interface CineJoyEvent {
  url: URL;
  req: { method: string; headers: Headers };
}

export default async function cinejoyProxyMiddleware(
  event: CineJoyEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  if (!event.url.pathname.startsWith("/api/cinejoy/")) return next();

  const host =
    event.req.headers.get("x-forwarded-host") ?? event.req.headers.get("host") ?? event.url.host;
  const proto =
    event.req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const request = new Request(`${proto}://${host}${event.url.pathname}${event.url.search}`, {
    method: event.req.method,
    headers: event.req.headers,
  });

  const response = await handleCineJoyProxyRequest(request);
  if (response) return response;
  return next();
}
