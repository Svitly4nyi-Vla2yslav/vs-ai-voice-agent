import OpenAI from "openai";

import {
  VS_WEB_STUDIO_AGENT_INSTRUCTIONS,
  VS_WEB_STUDIO_LIVE_INSTRUCTIONS,
} from "../agent/instructions.js";
import type {
  LiveAgentConfiguration,
  VoiceAgentConfiguration,
} from "../agent/types.js";
import { env } from "../config/env.js";

export const openAIClient = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

export const voiceAgentConfiguration: VoiceAgentConfiguration = {
  model: env.OPENAI_REALTIME_MODEL,
  voice: env.OPENAI_REALTIME_VOICE,
  instructions: VS_WEB_STUDIO_AGENT_INSTRUCTIONS,
};

export const liveAgentConfiguration: LiveAgentConfiguration = {
  model: env.OPENAI_LIVE_MODEL,
  instructions: VS_WEB_STUDIO_LIVE_INSTRUCTIONS,
};
