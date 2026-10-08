import { Router } from "express";
import { z } from "zod";

import { isSameOriginRequest } from "../http/same-origin.js";
import { env } from "../config/env.js";
import { getLeadFlowClient } from "../services/leadflow.js";
import { resolveLeadFlowToolContext } from "../services/leadflow-session.js";
import { executeAgentTool } from "../tools/index.js";
import type { AgentToolResult } from "../tools/types.js";

type ExecuteTool = (
  name: string,
  argumentsValue: unknown,
  context: {
    leadId?: string | undefined;
    callTaskId?: string | undefined;
    conversationId?: string | undefined;
  },
) => Promise<AgentToolResult>;

type ToolsRouterOptions = {
  executeTool?: ExecuteTool | undefined;
  leadFlowIntegrationToken?: string | undefined;
  allowManualLeadId?: boolean | undefined;
};

export const toolExecutionRequestSchema = z
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

export const createToolsRouter = (
  options: ToolsRouterOptions = {},
): Router => {
  const router = Router();
  const executeTool = options.executeTool ?? executeAgentTool;
  const leadFlowIntegrationToken =
    options.leadFlowIntegrationToken ?? env.LEADFLOW_INTEGRATION_TOKEN;
  const allowManualLeadId =
    options.allowManualLeadId ?? env.LEADFLOW_ALLOW_MANUAL_LEAD_ID;

  // GET повертає лише ознаку готовності LeadFlow, забороняє кешування й не розкриває значення конфігурації.
  router.get("/api/tools/leadflow-status", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.status(200).json({ configured: getLeadFlowClient().isConfigured() });
  });

  // POST приймає назву й аргументи інструмента, перевіряє same-origin та схему, відновлює серверний LeadFlow-контекст і запускає dispatcher.
  // Результат завжди позначається no-store; зовнішні побічні ефекти залежать від обраного інструмента й відбуваються лише після успішної валідації.
  router.post("/api/tools/execute", async (request, response) => {
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
        secret: leadFlowIntegrationToken,
        allowManualLeadId,
      },
    );
    const result = await executeTool(
      parsedRequest.data.name,
      parsedRequest.data.arguments,
      {
        leadId: resolvedContext?.leadId,
        ...(
          resolvedContext && "callTaskId" in resolvedContext
            ? {
                callTaskId: resolvedContext.callTaskId,
                conversationId: resolvedContext.conversationId,
              }
            : {}
        ),
      },
    );
    response.set("Cache-Control", "no-store");
    response.status(200).json(result);
  });

  return router;
};

export const toolsRouter = createToolsRouter();
