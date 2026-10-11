import { readRawBody, type H3Event } from "h3";
import { handleAoneRoomProxyRequest } from "@/lib/cine/aoneroom-proxy.server";

const MAX_BODY_BYTES = 32 * 1024;

export default async function aoneroomProxyMiddleware(
  event: H3Event,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  if (!event.url.pathname.startsWith("/api/aoneroom/")) return next();

  const method = event.req.method.toUpperCase();
  let body: string | undefined;
  if (method === "POST") {
    const declaredLength = Number(event.req.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: "Request body too large" }), {
        status: 413,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
    body = await readRawBody(event);
    if (body && new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: "Request body too large" }), {
        status: 413,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
  }

  const host =
    event.req.headers.get("x-forwarded-host") ??
    event.req.headers.get("host") ??
    event.url.host;
  const proto =
    event.req.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const request = new Request(`${proto}://${host}${event.url.pathname}${event.url.search}`, {
    method,
    headers: event.req.headers,
    ...(body ? { body } : {}),
  });

  const response = await handleAoneRoomProxyRequest(request);
  if (response) return response;
  return next();
}
