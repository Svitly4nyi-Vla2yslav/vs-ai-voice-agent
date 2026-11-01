import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";

import { healthRouter } from "./routes/health.js";
import { liveRouter } from "./routes/live.js";
import { leadFlowRouter } from "./routes/leadflow.js";
import { realtimeRouter } from "./routes/realtime.js";
import { toolsRouter } from "./routes/tools.js";

/**
 * Складає Express-застосунок голосового агента: JSON parser, API-маршрути,
 * статичний frontend і фінальні 404/500 middleware. Порядок монтування визначає,
 * чи запит обробляється API, public-файлом або контрольованим fallback.
 */
const app = express();

// Локальний reverse proxy і Netlify мають один довірений hop, тому Express відновлює protocol з X-Forwarded-Proto.
app.set("trust proxy", 1);

app.use(express.json());
app.use(healthRouter);
app.use(leadFlowRouter);
app.use(realtimeRouter);
app.use(liveRouter);
app.use(toolsRouter);
app.use(express.static("public"));

/** Завершує необроблений API/static запит сталою JSON-відповіддю 404 без зміни даних. */
const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({ error: "Not found" });
};

/**
 * Журналює необроблену помилку й повертає узагальнену JSON-відповідь 500.
 * Четвертий аргумент _next навмисно зберігає сигнатуру Express error middleware.
 */
const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error("Unhandled request error", error);
  response.status(500).json({ error: "Internal server error" });
};

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
