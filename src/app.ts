import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";

import { healthRouter } from "./routes/health.js";
import { liveRouter } from "./routes/live.js";
import { leadFlowRouter } from "./routes/leadflow.js";
import { realtimeRouter } from "./routes/realtime.js";
import { toolsRouter } from "./routes/tools.js";

const app = express();

// Both the local reverse-proxy case and Netlify have one trusted proxy hop.
// This lets Express derive request.protocol from X-Forwarded-Proto.
app.set("trust proxy", 1);

app.use(express.json());
app.use(healthRouter);
app.use(leadFlowRouter);
app.use(realtimeRouter);
app.use(liveRouter);
app.use(toolsRouter);
app.use(express.static("public"));

// notFoundHandler завершує запити, які не обробили API-роутери або static middleware, стабільною JSON-відповіддю 404.
const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({ error: "Not found" });
};

// errorHandler є останнім запобіжником Express: журналює необроблену помилку та повертає клієнту узагальнену JSON-відповідь 500.
// Аргумент _next навмисно присутній, щоб Express розпізнав функцію як error middleware.
const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error("Unhandled request error", error);
  response.status(500).json({ error: "Internal server error" });
};

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
