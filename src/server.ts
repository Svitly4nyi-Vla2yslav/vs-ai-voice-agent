import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";

import { env } from "./config/env.js";
import { healthRouter } from "./routes/health.js";
import { liveRouter } from "./routes/live.js";
import { realtimeRouter } from "./routes/realtime.js";

const app = express();

app.use(express.json());
app.use(express.static("public"));
app.use(healthRouter);
app.use(realtimeRouter);
app.use(liveRouter);

const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({ error: "Not found" });
};

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error("Unhandled request error", error);
  response.status(500).json({ error: "Internal server error" });
};

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  console.log(`VS AI Voice Agent listening on port ${env.PORT}`);
});

server.on("error", (error) => {
  console.error("Server failed to start", error);
  process.exitCode = 1;
});

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

process.once("SIGINT", () => shutDown("SIGINT"));
process.once("SIGTERM", () => shutDown("SIGTERM"));
