import { Router } from "express";
import { z } from "zod";

import { isSameOriginRequest } from "../http/same-origin.js";
import { executeAgentTool } from "../tools/index.js";

export const toolsRouter = Router();

const toolExecutionRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    arguments: z.unknown(),
  })
  .strict();

toolsRouter.post("/api/tools/execute", async (request, response) => {
  if (!isSameOriginRequest(request)) {
    response.status(403).json({ error: "Unexpected request origin" });
    return;
  }

  const parsedRequest = toolExecutionRequestSchema.safeParse(request.body);
  if (!parsedRequest.success) {
    response.status(400).json({ error: "Invalid tool execution request" });
    return;
  }

  const result = await executeAgentTool(
    parsedRequest.data.name,
    parsedRequest.data.arguments,
  );
  response.set("Cache-Control", "no-store");
  response.status(200).json(result);
});
