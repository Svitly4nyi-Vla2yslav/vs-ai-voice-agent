import { Router } from "express";

/**
 * Експортує маршрутизатор із легкою перевіркою доступності процесу.
 * Endpoint не перевіряє OpenAI, календар, LeadFlow або інші зовнішні залежності.
 */
export const healthRouter = Router();

/**
 * Обробляє `GET /health`: повертає HTTP 200 і сталу назву сервісу.
 * Не читає параметри чи тіло запиту, не кешує власний стан і не змінює дані.
 */
healthRouter.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "vs-ai-voice-agent",
  });
});

