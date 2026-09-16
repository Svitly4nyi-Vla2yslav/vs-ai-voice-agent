import type { Request } from "express";

const firstForwardedValue = (value: string | undefined): string | undefined =>
  value?.split(",", 1)[0]?.trim() || undefined;

export const isSameOriginRequest = (request: Request): boolean => {
  const origin = request.get("Origin");
  if (!origin) return true;

  const host =
    firstForwardedValue(request.get("X-Forwarded-Host")) ??
    request.get("Host");

  if (!host) return false;

  if (origin === `${request.protocol}://${host}`) return true;

  // Netlify Dev represents the function invocation as HTTPS internally while
  // its browser-facing development server is HTTP. Limit that exception to
  // loopback hosts; deployed Netlify origins must still match HTTPS exactly.
  try {
    const parsedOrigin = new URL(origin);
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
      parsedOrigin.hostname,
    );

    return (
      isLoopback &&
      parsedOrigin.protocol === "http:" &&
      request.protocol === "https" &&
      parsedOrigin.host === host
    );
  } catch {
    return false;
  }
};
