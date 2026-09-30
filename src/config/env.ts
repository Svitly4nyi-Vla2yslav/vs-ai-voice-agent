import "dotenv/config";
import { z } from "zod";

import {
  BACKEND_MODEL_BASELINE,
  backendModelEnvironmentSchema,
} from "../agent/backend-models.js";

const optionalEnvironmentValue = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

const optionalBoolean = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

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
  OPENAI_REALTIME_VOICE: z.enum(realtimeVoices).default("marin"),
  OPENAI_LIVE_MODEL: z.literal("gpt-live-1").default("gpt-live-1"),
  OPENAI_AGENT_MODEL: backendModelEnvironmentSchema.default(
    BACKEND_MODEL_BASELINE,
  ),
  GOOGLE_CALENDAR_ID: optionalEnvironmentValue,
  GOOGLE_CLIENT_ID: optionalEnvironmentValue,
  GOOGLE_CLIENT_SECRET: optionalEnvironmentValue,
  GOOGLE_REFRESH_TOKEN: optionalEnvironmentValue,
  LEADFLOW_BASE_URL: optionalEnvironmentValue,
  LEADFLOW_INTEGRATION_TOKEN: optionalEnvironmentValue,
  LEADFLOW_ALLOW_MANUAL_LEAD_ID: optionalBoolean,
  CALENDAR_TIMEZONE: z.literal("Europe/Berlin").default("Europe/Berlin"),
  CALENDAR_WORKING_HOURS_START: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .default("09:00"),
  CALENDAR_WORKING_HOURS_END: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .default("17:00"),
  CALENDAR_DEFAULT_DURATION_MINUTES: z.coerce
    .number()
    .int()
    .min(15)
    .max(120)
    .default(30),
  CALENDAR_BUFFER_MINUTES: z.coerce
    .number()
    .int()
    .min(0)
    .max(120)
    .default(30),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  const details = parsedEnvironment.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = parsedEnvironment.data;

export type RuntimeEnvironment =
  | "production"
  | "deploy-preview"
  | "branch-deploy"
  | "development";

export const runtimeEnvironment = (): RuntimeEnvironment => {
  if (process.env.CONTEXT === "production" || process.env.NODE_ENV === "production") {
    return "production";
  }
  if (process.env.CONTEXT === "deploy-preview") return "deploy-preview";
  if (process.env.CONTEXT === "branch-deploy") return "branch-deploy";
  return "development";
};
