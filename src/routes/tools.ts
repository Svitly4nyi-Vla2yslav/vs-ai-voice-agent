import { Router } from "express";
import { z } from "zod";

import { isSameOriginRequest } from "../http/same-origin.js";
import { env } from "../config/env.js";
import { getLeadFlowClient } from "../services/leadflow.js";
import { resolveLeadFlowToolContext } from "../services/leadflow-session.js";
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
      .object({
        leadFlowSession: z.string().trim().min(1).max(65_536).optional(),
        devLeadId: z.string().trim().min(1).max(200).optional(),
      })
      .strict()
      .refine(
        (value) => !(value.leadFlowSession && value.devLeadId),
        "Use handoff context or developer fallback, not both",
      )
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

  const resolvedContext = resolveLeadFlowToolContext(
    parsedRequest.data.context ?? {},
    {
      secret: env.LEADFLOW_INTEGRATION_TOKEN,
      allowManualLeadId: env.LEADFLOW_ALLOW_MANUAL_LEAD_ID,
    },
  );
  const result = await executeAgentTool(
    parsedRequest.data.name,
    parsedRequest.data.arguments,
    {
      leadId: resolvedContext?.leadId,
      ...(
        resolvedContext && "callTaskId" in resolvedContext
          ? { callTaskId: resolvedContext.callTaskId }
          : {}
      ),
    },
  );
  response.set("Cache-Control", "no-store");
  response.status(200).json(result);
});
