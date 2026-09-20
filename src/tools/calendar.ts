import { DateTime } from "luxon";
import { z } from "zod";

import { env } from "../config/env.js";
import {
  CALENDAR_TIMEZONE,
  createGoogleCalendarGateway,
  GoogleCalendarService,
  type AvailabilityResult,
  type BookingResult,
  type CalendarSettings,
} from "../services/google-calendar.js";

const emptyToUndefined = (value: unknown): unknown =>
  value === null || (typeof value === "string" && value.trim() === "")
    ? undefined
    : value;

const optionalString = (maximum: number) =>
  z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1).max(maximum).optional(),
  );

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (date) =>
      DateTime.fromFormat(date, "yyyy-MM-dd", {
        zone: CALENDAR_TIMEZONE,
      }).isValid,
    "Invalid calendar date",
  );

const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const getCalendarAvailabilityInputSchema = z
  .object({
    date: dateSchema,
    startTime: z.preprocess(emptyToUndefined, timeSchema.optional()),
    endTime: z.preprocess(emptyToUndefined, timeSchema.optional()),
    timeWindow: z.preprocess(
      emptyToUndefined,
      z.enum(["morning", "afternoon", "evening"]).optional(),
    ),
    durationMinutes: z.preprocess(
      emptyToUndefined,
      z
        .number()
        .int()
        .min(15)
        .max(120)
        .default(env.CALENDAR_DEFAULT_DURATION_MINUTES),
    ),
    timezone: z.literal(CALENDAR_TIMEZONE).default(CALENDAR_TIMEZONE),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.endTime && !input.startTime) {
      context.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "endTime requires startTime",
      });
    }
    if (input.startTime && input.timeWindow) {
      context.addIssue({
        code: "custom",
        path: ["timeWindow"],
        message: "Use an exact time or a time window, not both",
      });
    }
    if (input.startTime && input.endTime && input.endTime <= input.startTime) {
      context.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "endTime must be after startTime",
      });
    }
  });

export type GetCalendarAvailabilityInput = z.infer<
  typeof getCalendarAvailabilityInputSchema
>;

const zonedDateTimeSchema = z.string().refine((value) => {
  const parsed = DateTime.fromISO(value, { setZone: true });
  if (!parsed.isValid || !parsed.isOffsetFixed) return false;
  return parsed.offset === parsed.setZone(CALENDAR_TIMEZONE).offset;
}, "Date-time must be valid RFC3339 with the Europe/Berlin offset");

export const bookMeetingInputSchema = z
  .object({
    contactName: optionalString(120),
    companyName: optionalString(160),
    start: zonedDateTimeSchema,
    end: zonedDateTimeSchema,
    timezone: z.literal(CALENDAR_TIMEZONE),
    customerEmail: z.preprocess(
      emptyToUndefined,
      z.string().trim().email().max(254).optional(),
    ),
    phone: optionalString(50),
    reason: optionalString(500),
    notes: optionalString(1_000),
    confirmation: z.boolean().optional(),
    idempotencyKey: z
      .string()
      .trim()
      .min(8)
      .max(160)
      .regex(/^[A-Za-z0-9._:-]+$/),
  })
  .strict()
  .superRefine((input, context) => {
    const start = DateTime.fromISO(input.start, { setZone: true });
    const end = DateTime.fromISO(input.end, { setZone: true });
    const duration = end.diff(start, "minutes").minutes;
    if (!start.isValid || !end.isValid || duration < 15 || duration > 120) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "Meeting duration must be between 15 and 120 minutes",
      });
    }
    if (start.toFormat("yyyy-MM-dd") !== end.toFormat("yyyy-MM-dd")) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "Meeting must start and end on the same local date",
      });
    }
  });

export type BookMeetingInput = z.infer<typeof bookMeetingInputSchema>;

let calendarService: GoogleCalendarService | undefined;

const getConfiguredCalendarService = (): GoogleCalendarService | undefined => {
  if (calendarService) return calendarService;
  if (
    !env.GOOGLE_CALENDAR_ID ||
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REFRESH_TOKEN
  ) {
    return undefined;
  }

  const settings: CalendarSettings = {
    calendarId: env.GOOGLE_CALENDAR_ID,
    timezone: env.CALENDAR_TIMEZONE,
    workingHoursStart: env.CALENDAR_WORKING_HOURS_START,
    workingHoursEnd: env.CALENDAR_WORKING_HOURS_END,
    defaultDurationMinutes: env.CALENDAR_DEFAULT_DURATION_MINUTES,
    bufferMinutes: env.CALENDAR_BUFFER_MINUTES,
  };
  if (settings.workingHoursStart >= settings.workingHoursEnd) return undefined;

  calendarService = new GoogleCalendarService(
    createGoogleCalendarGateway(settings, {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      refreshToken: env.GOOGLE_REFRESH_TOKEN,
    }),
    settings,
  );
  return calendarService;
};

const notConfigured = () => ({
  status: "calendar_error" as const,
  reason: "configuration" as const,
  externalActionPerformed: false as const,
});

export const getCalendarAvailability = async (
  input: GetCalendarAvailabilityInput,
): Promise<AvailabilityResult> => {
  const service = getConfiguredCalendarService();
  if (!service) return notConfigured();
  const result = await service.getAvailability(input);
  console.info("[Calendar] availability checked", { status: result.status });
  return result;
};

export const bookMeeting = async (
  input: BookMeetingInput,
): Promise<BookingResult> => {
  if (input.confirmation !== true) {
    return {
      status: "confirmation_required",
      externalActionPerformed: false,
    };
  }
  const service = getConfiguredCalendarService();
  if (!service) return notConfigured();
  return service.bookMeeting(input);
};
