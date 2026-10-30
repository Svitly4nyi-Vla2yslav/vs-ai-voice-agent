import type { Request } from "express";

/**
 * Бере лише перший елемент forwarded-заголовка, де проксі-вузли розділені комами.
 * @param value — необов’язковий рядок заголовка.
 * @returns Обрізане непорожнє перше значення або undefined; вхідний рядок не змінюється.
 */
const firstForwardedValue = (value: string | undefined): string | undefined =>
  value?.split(",", 1)[0]?.trim() || undefined;

/**
 * Перевіряє Origin браузерного запиту проти протоколу та ефективного Host backend.
 * @param request — Express-запит; X-Forwarded-Host має пріоритет над Host.
 * @returns true без Origin, для точного same-origin або вузького HTTP→HTTPS loopback-випадку Netlify Dev;
 * повертає false за відсутнього Host, некоректного URL чи будь-якої іншої невідповідності.
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
