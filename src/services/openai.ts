import OpenAI from "openai";

import { VS_WEB_STUDIO_AGENT_INSTRUCTIONS } from "../agent/instructions.js";
import type { VoiceAgentConfiguration } from "../agent/types.js";
import { env } from "../config/env.js";

export const openAIClient = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

export const voiceAgentConfiguration: VoiceAgentConfiguration = {
  model: env.OPENAI_REALTIME_MODEL,
  instructions: VS_WEB_STUDIO_AGENT_INSTRUCTIONS,
};
