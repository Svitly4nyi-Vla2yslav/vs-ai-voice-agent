import { z } from "zod";

export const BACKEND_MODEL_BASELINE = "gpt-5.4-mini";
export const BACKEND_MODEL_EXPERIMENT = "gpt-6-luna";

export const backendModelTestConfigurations = [
  BACKEND_MODEL_BASELINE,
  BACKEND_MODEL_EXPERIMENT,
] as const;

/**
 * Zod-схема приймає текст OPENAI_AGENT_MODEL, обрізає пробіли й повертає непорожню назву моделі.
 * Вона не обмежує runtime лише двома A/B-конфігураціями та не перевіряє мережевий доступ;
 * baseline і experiment окремо використовуються діагностикою check:prompt-cache.
 */
export const backendModelEnvironmentSchema = z
  .string()
  .trim()
  .min(1, "OPENAI_AGENT_MODEL is required");
