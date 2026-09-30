import { Router } from "express";
import { APIError } from "openai";
import { z } from "zod";

import { composeBackendInstructions } from "../agent/instructions.js";
import { voiceLabVoices } from "../agent/types.js";
import { env } from "../config/env.js";
import { isSameOriginRequest } from "../http/same-origin.js";
import { liveAgentConfiguration, openAIClient } from "../services/openai.js";
import {
  leadFlowConversationContext,
  readLeadFlowSessionToken,
} from "../services/leadflow-session.js";
import {
  logPromptCacheTelemetry,
  promptCacheTelemetry,
} from "../services/prompt-cache.js";
import { agentTools } from "../tools/index.js";

export const liveRouter = Router();

const liveSessionRequestSchema = z
  .object({
    sdp: z.string().min(1).max(200_000),
    voice: z.enum(voiceLabVoices),
    leadFlowSession: z.string().trim().min(1).max(65_536).optional(),
  })
  .strict();

const promptCacheUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    cachedTokens: z.number().int().nonnegative().optional(),
    cacheWriteTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

liveRouter.post("/api/live/cache-usage", (request, response) => {
  if (!isSameOriginRequest(request)) {
    response.status(403).json({ error: "Unexpected request origin" });
    return;
  }

  const parsedUsage = promptCacheUsageSchema.safeParse(request.body);
  if (!parsedUsage.success) {
    response.status(400).json({ error: "Invalid cache usage" });
    return;
  }

  logPromptCacheTelemetry(parsedUsage.data);
  const telemetry = promptCacheTelemetry(parsedUsage.data);
  response.set("Cache-Control", "no-store");
  response.status(202).json({
    hitRate: telemetry.hitRate ?? null,
  });
});

liveRouter.post("/api/live/session", async (request, response) => {
  if (!isSameOriginRequest(request)) {
    response.status(403).json({ error: "Unexpected request origin" });
    return;
  }

  const parsedRequest = liveSessionRequestSchema.safeParse(request.body);
  if (!parsedRequest.success) {
    response.status(400).json({ error: "Invalid Live session request" });
    return;
  }

  try {
    const leadFlowContext = parsedRequest.data.leadFlowSession
      ? env.LEADFLOW_INTEGRATION_TOKEN
        ? readLeadFlowSessionToken(
            parsedRequest.data.leadFlowSession,
            env.LEADFLOW_INTEGRATION_TOKEN,
          )
        : undefined
      : undefined;
    if (parsedRequest.data.leadFlowSession && !leadFlowContext) {
      response.status(400).json({ error: "Invalid LeadFlow session" });
      return;
    }
    const sessionContext = leadFlowContext
      ? leadFlowConversationContext(leadFlowContext)
      : undefined;
    const liveContextInstructions = sessionContext ? `\n\n${sessionContext}` : "";
    const liveSession = await openAIClient.live.create({
      session: {
        model: liveAgentConfiguration.model,
        instructions: `${liveAgentConfiguration.instructions}${liveContextInstructions}`,
        store: false,
        delegation: {
          type: "responses",
          responses: {
            model: liveAgentConfiguration.backendModel,
            instructions: composeBackendInstructions(sessionContext),
            tools: agentTools,
            tool_choice: "auto",
            parallel_tool_calls: false,
            reasoning: { effort: "low" },
            text: { verbosity: "low" },
          },
        },
        audio: {
          output: {
            voice: parsedRequest.data.voice,
          },
        },
        client: {
          data_channel: {
            allowed_client_events: [
              "response.item.create",
              "response.create",
              "session.close",
            ],
            allowed_server_events: [
              { type: "session.started" },
              { type: "session.closed" },
              { type: "session.input_transcript.delta" },
              { type: "session.output_transcript.delta" },
              { type: "session.delegation.created" },
              {
                type: "response.event",
                response_event: "response.output_item.done",
              },
              {
                type: "response.event",
                response_event: "response.completed",
              },
              {
                type: "response.event",
                response_event: "response.failed",
              },
              { type: "error" },
              { type: "info" },
            ],
          },
        },
      },
      transport: {
        type: "webrtc",
        sdp: parsedRequest.data.sdp,
      },
    });

    response.set("Cache-Control", "no-store");
    response.type("application/sdp");
    response.status(201).send(liveSession.transport.sdp);
  } catch (error: unknown) {
    if (error instanceof APIError) {
      console.error("Live session creation failed", {
        status: error.status,
        code: error.code,
      });
    } else {
      console.error("Live session creation failed: unexpected error");
    }

    response.status(502).json({ error: "Unable to create Live session" });
  }
});
