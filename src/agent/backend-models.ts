import { z } from "zod";

export const BACKEND_MODEL_BASELINE = "gpt-5.4-mini";
export const BACKEND_MODEL_EXPERIMENT = "gpt-6-luna";

export const backendModelTestConfigurations = [
  BACKEND_MODEL_BASELINE,
  BACKEND_MODEL_EXPERIMENT,
] as const;

/**
 * Перевіряє змінну OPENAI_AGENT_MODEL як непорожній рядок після trim.
 * Runtime залишається конфігурованим для інших підтримуваних Responses-моделей,
 * а дві рекомендовані A/B-конфігурації окремо перевіряє check:prompt-cache.
 */
export const backendModelEnvironmentSchema = z
  .string()
  .trim()
  .min(1, "OPENAI_AGENT_MODEL is required");
