import { Router } from "express";
import { z } from "zod";

import { isSameOriginRequest } from "../http/same-origin.js";
import { getLeadFlowClient } from "../services/leadflow.js";
import { executeAgentTool } from "../tools/index.js";

export const toolsRouter = Router();

toolsRouter.get("/api/tools/leadflow-status", (_request, response) => {
  response.set("Cache-Control", "no-store");
  response.status(200).json({ configured: getLeadFlowClient().isConfigured() });
});

const toolExecutionRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    arguments: z.unknown(),
    context: z
      .object({ leadId: z.string().trim().min(1).max(200) })
      .strict()
      .optional(),
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
    parsedRequest.data.context ?? {},
  );
  response.set("Cache-Control", "no-store");
  response.status(200).json(result);
});
