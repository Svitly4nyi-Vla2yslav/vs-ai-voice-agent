import "dotenv/config";
import { z } from "zod";

export const realtimeVoices = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;

const environmentSchema = z.object({
  OPENAI_API_KEY: z.string().trim().min(1, "OPENAI_API_KEY is required"),
  OPENAI_REALTIME_MODEL: z
    .string()
    .trim()
    .min(1, "OPENAI_REALTIME_MODEL is required")
    .default("gpt-realtime-2.1-mini"),
  OPENAI_REALTIME_VOICE: z.enum(realtimeVoices).default("shimmer"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  const details = parsedEnvironment.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = parsedEnvironment.data;
