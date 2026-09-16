import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";

import { healthRouter } from "./routes/health.js";
import { liveRouter } from "./routes/live.js";
import { realtimeRouter } from "./routes/realtime.js";

const app = express();

// Both the local reverse-proxy case and Netlify have one trusted proxy hop.
// This lets Express derive request.protocol from X-Forwarded-Proto.
app.set("trust proxy", 1);

app.use(express.json());
app.use(healthRouter);
app.use(realtimeRouter);
app.use(liveRouter);
app.use(express.static("public"));

const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({ error: "Not found" });
};

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error("Unhandled request error", error);
  response.status(500).json({ error: "Internal server error" });
};

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
