import { z } from "zod";

export const BACKEND_MODEL_BASELINE = "gpt-5.4-mini";
export const BACKEND_MODEL_EXPERIMENT = "gpt-6-luna";

export const backendModelTestConfigurations = [
  BACKEND_MODEL_BASELINE,
  BACKEND_MODEL_EXPERIMENT,
] as const;

// The runtime remains configurable so additional supported Responses models can
// be evaluated without a code change. The two recommended A/B values are tested
// explicitly by check:prompt-cache.
export const backendModelEnvironmentSchema = z
  .string()
  .trim()
  .min(1, "OPENAI_AGENT_MODEL is required");
