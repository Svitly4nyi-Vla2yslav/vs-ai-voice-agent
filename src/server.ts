import app from "./app.js";
import { env } from "./config/env.js";

// Запуск прослуховування є побічним ефектом імпорту entrypoint; порт надходить із перевіреної конфігурації.
const server = app.listen(env.PORT, () => {
  console.log(`VS AI Voice Agent listening on port ${env.PORT}`);
});

// Помилки запуску переводять процес у ненульовий exitCode; зайнятий порт отримує окреме зрозуміле повідомлення.
server.on("error", (error) => {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "EADDRINUSE"
  ) {
    console.error(
      `Port ${env.PORT} is already in use. Stop the existing development server before starting another instance.`,
    );
    process.exitCode = 1;
    return;
  }
  console.error("Server failed to start", error);
  process.exitCode = 1;
});

/**
 * Приймає сигнал завершення, припиняє приймати нові з'єднання й виставляє exitCode після закриття сервера.
 * Побічні ефекти: журналює стан і асинхронно закриває HTTP-сервер.
 */
const shutDown = (signal: NodeJS.Signals): void => {
  console.log(`${signal} received; closing server`);
  server.close((error) => {
    if (error) {
      console.error("Server shutdown failed", error);
      process.exitCode = 1;
      return;
    }

    process.exitCode = 0;
  });
};

// Одноразові слухачі гарантують спільний graceful-shutdown для Ctrl+C і штатного SIGTERM.
process.once("SIGINT", () => shutDown("SIGINT"));
process.once("SIGTERM", () => shutDown("SIGTERM"));
