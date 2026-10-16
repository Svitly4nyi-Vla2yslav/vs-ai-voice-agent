import { Router } from "express";

/** Маршрутизатор із легкою перевіркою доступності сервісу без зовнішніх залежностей. */
export const healthRouter = Router();

/** Повертає HTTP 200 та сталий JSON-стан, не читаючи тіло запиту й не змінюючи дані. */
healthRouter.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "vs-ai-voice-agent",
  });
});

