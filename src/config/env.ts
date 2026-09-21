import "dotenv/config";
import { z } from "zod";

const optionalEnvironmentValue = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

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
  OPENAI_AGENT_MODEL: z
    .string()
    .trim()
    .min(1, "OPENAI_AGENT_MODEL is required")
    .default("gpt-5.4-mini"),
  GOOGLE_CALENDAR_ID: optionalEnvironmentValue,
  GOOGLE_CLIENT_ID: optionalEnvironmentValue,
  GOOGLE_CLIENT_SECRET: optionalEnvironmentValue,
  GOOGLE_REFRESH_TOKEN: optionalEnvironmentValue,
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
