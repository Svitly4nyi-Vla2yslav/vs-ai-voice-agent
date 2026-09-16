import { Router } from "express";
import { APIError } from "openai";
import { z } from "zod";

import { realtimeVoices } from "../config/env.js";
import { openAIClient, voiceAgentConfiguration } from "../services/openai.js";

export const realtimeRouter = Router();

const voiceSelectionSchema = z
  .object({
    voice: z.enum(realtimeVoices).optional(),
  })
  .strict();

realtimeRouter.post("/api/realtime/client-secret", async (request, response) => {
  const origin = request.get("Origin");
  const host = request.get("Host");

  if (origin && (!host || origin !== `${request.protocol}://${host}`)) {
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

  try {
    const clientSecret = await openAIClient.realtime.clientSecrets.create({
      expires_after: {
        anchor: "created_at",
        seconds: 60,
      },
      session: {
        type: "realtime",
        model: voiceAgentConfiguration.model,
        instructions: voiceAgentConfiguration.instructions,
        output_modalities: ["audio"],
        audio: {
          input: {
            noise_reduction: { type: "near_field" },
            turn_detection: {
              type: "server_vad",
              create_response: true,
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
