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

// Клієнт створюється один раз під час імпорту модуля та використовує лише перевірений server-side API key.
export const openAIClient = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

// Конфігурація Realtime поєднує модель, голос і незмінні системні інструкції для fallback-сесій.
export const voiceAgentConfiguration: VoiceAgentConfiguration = {
  model: env.OPENAI_REALTIME_MODEL,
  voice: env.OPENAI_REALTIME_VOICE,
  instructions: VS_WEB_STUDIO_AGENT_INSTRUCTIONS,
};

// Live-конфігурація окремо фіксує голосову модель, інструкції та backend-модель для агентної логіки.
export const liveAgentConfiguration: LiveAgentConfiguration = {
  model: env.OPENAI_LIVE_MODEL,
  instructions: VS_WEB_STUDIO_LIVE_INSTRUCTIONS,
  backendModel: env.OPENAI_AGENT_MODEL,
};
