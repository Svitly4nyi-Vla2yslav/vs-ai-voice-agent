import { Router } from "express";
import { APIError } from "openai";
import { z } from "zod";

import { env, realtimeVoices } from "../config/env.js";
import { isSameOriginRequest } from "../http/same-origin.js";
import { openAIClient, voiceAgentConfiguration } from "../services/openai.js";
import {
  leadFlowConversationContext,
  readLeadFlowSessionToken,
} from "../services/leadflow-session.js";

export const realtimeRouter = Router();

const voiceSelectionSchema = z
  .object({
    voice: z.enum(realtimeVoices).optional(),
    leadFlowSession: z.string().trim().min(1).max(65_536).optional(),
  })
  .strict();

realtimeRouter.post("/api/realtime/client-secret", async (request, response) => {
  if (!isSameOriginRequest(request)) {
    response.status(403).json({ error: "Unexpected request origin" });
    return;
  }

  const parsedRequest = voiceSelectionSchema.safeParse(request.body ?? {});
  if (!parsedRequest.success) {
    response.status(400).json({ error: "Unsupported Realtime voice" });
    return;
  }

  const selectedVoice =
    parsedRequest.data.voice ?? voiceAgentConfiguration.voice;
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
  const contextInstructions = leadFlowContext
    ? `\n\n${leadFlowConversationContext(leadFlowContext)}`
    : "";

  try {
    const clientSecret = await openAIClient.realtime.clientSecrets.create({
      expires_after: {
        anchor: "created_at",
        seconds: 60,
      },
      session: {
        type: "realtime",
        model: voiceAgentConfiguration.model,
        instructions: `${voiceAgentConfiguration.instructions}${contextInstructions}`,
        output_modalities: ["audio"],
        audio: {
          input: {
            noise_reduction: { type: "near_field" },
            transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: {
              type: "server_vad",
              create_response: false,
              interrupt_response: true,
            },
          },
          output: {
            voice: selectedVoice,
          },
        },
      },
    });

    response.set("Cache-Control", "no-store");
    response.status(201).json({ clientSecret: clientSecret.value });
  } catch (error: unknown) {
    if (error instanceof APIError) {
      console.error("Realtime client secret creation failed", {
        status: error.status,
        code: error.code,
      });
    } else {
      console.error("Realtime client secret creation failed: unexpected error");
    }

    response
      .status(502)
      .json({ error: "Unable to create Realtime client secret" });
  }
});
