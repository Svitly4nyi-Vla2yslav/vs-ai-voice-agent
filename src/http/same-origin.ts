import type { Request } from "express";

/**
 * Бере перше значення з proxy-заголовка, де кілька вузлів розділені комами.
 *
 * @param value — необов'язковий вміст forwarded-заголовка.
 * @returns Перше непорожнє значення або undefined.
 */
const firstForwardedValue = (value: string | undefined): string | undefined =>
  value?.split(",", 1)[0]?.trim() || undefined;

/**
 * Перевіряє, що браузерний запит походить із того самого origin, що й backend.
 *
 * @param request — Express-запит із Origin, Host та proxy-заголовками.
 * @returns true для same-origin або дозволеного loopback-випадку Netlify Dev.
 */
export const isSameOriginRequest = (request: Request): boolean => {
  const origin = request.get("Origin");
  if (!origin) return true;

  const host =
    firstForwardedValue(request.get("X-Forwarded-Host")) ??
    request.get("Host");

  if (!host) return false;

  if (origin === `${request.protocol}://${host}`) return true;

  // Netlify Dev передає виклик функції як HTTPS, хоча локальний браузер працює через HTTP.
  // Виняток обмежений loopback-хостами; production-origin усе одно має точно збігатися.
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
