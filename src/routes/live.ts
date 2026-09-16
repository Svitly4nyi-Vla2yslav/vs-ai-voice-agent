import { Router } from "express";
import { APIError } from "openai";
import { z } from "zod";

import { voiceLabVoices } from "../agent/types.js";
import { isSameOriginRequest } from "../http/same-origin.js";
import { liveAgentConfiguration, openAIClient } from "../services/openai.js";

export const liveRouter = Router();

const liveSessionRequestSchema = z
  .object({
    sdp: z.string().min(1).max(200_000),
    voice: z.enum(voiceLabVoices),
  })
  .strict();

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
    const liveSession = await openAIClient.live.create({
      session: {
        model: liveAgentConfiguration.model,
        instructions: liveAgentConfiguration.instructions,
        store: false,
        audio: {
          output: {
            voice: parsedRequest.data.voice,
          },
        },
        client: {
          data_channel: {
            allowed_client_events: ["session.close"],
            allowed_server_events: [
              { type: "session.started" },
              { type: "session.closed" },
              { type: "session.input_transcript.delta" },
              { type: "session.output_transcript.delta" },
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
