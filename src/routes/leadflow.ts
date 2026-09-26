import { Router } from "express";
import { z } from "zod";

import { env, runtimeEnvironment } from "../config/env.js";
import { isSameOriginRequest } from "../http/same-origin.js";
import {
  getLeadFlowClient,
  safeHandoffFailureReason,
} from "../services/leadflow.js";
import {
  createLeadFlowSessionToken,
  sanitizeCallBrief,
} from "../services/leadflow-session.js";

export const leadFlowRouter = Router();

const handoffRequestSchema = z
  .object({ handoffToken: z.string().trim().min(1).max(8_192) })
  .strict();

leadFlowRouter.get("/api/leadflow/status", (_request, response) => {
  response.set("Cache-Control", "no-store");
  const configuration = getLeadFlowClient().configurationStatus();
  response.status(200).json({
    ...configuration,
    manualFallbackEnabled: env.LEADFLOW_ALLOW_MANUAL_LEAD_ID,
    environment: runtimeEnvironment(),
  });
});

leadFlowRouter.get("/api/leadflow/diagnostic", async (request, response) => {
  response.set("Cache-Control", "no-store");
  if (!isSameOriginRequest(request)) {
    response.status(403).json({ error: "Unexpected request origin" });
    return;
  }
  response.status(200).json(await getLeadFlowClient().diagnose());
});

leadFlowRouter.post("/api/leadflow/handoff", async (request, response) => {
  response.set("Cache-Control", "no-store");
  if (!isSameOriginRequest(request)) {
    response.status(403).json({ error: "Unexpected request origin" });
    return;
  }
  const parsed = handoffRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "LeadFlow connection failed",
      reason: "handoff_invalid",
    });
    return;
  }

  const result = await getLeadFlowClient().resolveHandoff(
    parsed.data.handoffToken,
  );
  if (
    !result.ok ||
    !env.LEADFLOW_INTEGRATION_TOKEN ||
    !("callTask" in result.data)
  ) {
    const safeReason = safeHandoffFailureReason(result.ok
      ? env.LEADFLOW_INTEGRATION_TOKEN
        ? "task_context_missing"
        : "configuration_missing"
      : result.error);
    console.info("[LeadFlow] handoff resolution failed", {
      reason: safeReason,
    });
    response.status(401).json({
      error: "LeadFlow connection failed",
      reason: safeReason,
    });
    return;
  }

  const sessionToken = createLeadFlowSessionToken(
    {
      leadId: result.data.lead.id,
      callTaskId: result.data.callTask.id,
      company: result.data.lead.company,
      contactPerson: result.data.lead.contactPerson,
      callBrief: sanitizeCallBrief(result.data.callBrief),
    },
    env.LEADFLOW_INTEGRATION_TOKEN,
  );
  console.info("[LeadFlow] handoff resolved");
  response.status(200).json({
    ok: true,
    sessionToken,
    context: {
      company: result.data.lead.company,
      contactPerson: result.data.lead.contactPerson,
      callStatus: "Ready",
      callObjective: result.data.callBrief.callObjective.slice(0, 240),
    },
  });
});
