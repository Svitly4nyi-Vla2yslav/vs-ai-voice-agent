import { DateTime } from "luxon";
import { z } from "zod";

import { env } from "../config/env.js";
import {
  CALENDAR_TIMEZONE,
  MEETING_MODES,
  createGoogleCalendarGateway,
  GoogleCalendarService,
  type AvailabilityResult,
  type BookingResult,
  type CancelMeetingResult,
  type CalendarSettings,
  type FindEmmaMeetingsResult,
  type RescheduleMeetingResult,
  type UpdateMeetingDetailsResult,
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
const phoneSchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .min(7)
    .max(32)
    .regex(/^\+?[0-9][0-9 ()/.-]{5,30}$/)
    .optional(),
);

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
    meetingMode: z.enum(MEETING_MODES),
    phone: phoneSchema,
    useCurrentCallNumber: z.preprocess(
      emptyToUndefined,
      z.boolean().optional(),
    ),
    location: optionalString(300),
    reason: optionalString(500),
    currentSituation: optionalString(1_000),
    desiredOutcome: optionalString(1_000),
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
    if (input.meetingMode === "PHONE" && !input.phone) {
      context.addIssue({
        code: "custom",
        path: ["phone"],
        message: "A confirmed callback number is required in the browser MVP",
      });
    }
    if (input.useCurrentCallNumber) {
      context.addIssue({
        code: "custom",
        path: ["useCurrentCallNumber"],
        message: "The browser MVP has no verified current caller number",
      });
    }
    if (input.meetingMode === "IN_PERSON" && !input.location) {
      context.addIssue({
        code: "custom",
        path: ["location"],
        message: "A confirmed location is required for an in-person meeting",
      });
    }
  });

export type BookMeetingInput = z.infer<typeof bookMeetingInputSchema>;

export const findEmmaMeetingsInputSchema = z
  .object({
    dateFrom: z.preprocess(emptyToUndefined, dateSchema.optional()),
    dateTo: z.preprocess(emptyToUndefined, dateSchema.optional()),
    contactName: optionalString(120),
    companyName: optionalString(160),
    approximateDate: z.preprocess(emptyToUndefined, dateSchema.optional()),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.dateFrom && input.dateTo) {
      const from = DateTime.fromISO(input.dateFrom);
      const to = DateTime.fromISO(input.dateTo);
      if (to < from) {
        context.addIssue({
          code: "custom",
          path: ["dateTo"],
          message: "dateTo must not be before dateFrom",
        });
      } else if (to.diff(from, "days").days > 366) {
        context.addIssue({
          code: "custom",
          path: ["dateTo"],
          message: "Search window must not exceed 366 days",
        });
      }
    }
  });

export type FindEmmaMeetingsInput = z.infer<typeof findEmmaMeetingsInputSchema>;

const meetingReferenceSchema = z
  .string()
  .trim()
  .min(10)
  .max(1024)
  .regex(/^emma_[A-Za-z0-9_-]+$/);

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const rescheduleMeetingInputSchema = z
  .object({
    meetingRef: meetingReferenceSchema,
    newStart: zonedDateTimeSchema,
    newEnd: zonedDateTimeSchema,
    timezone: z.literal(CALENDAR_TIMEZONE),
    confirmation: z.literal(true),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((input, context) => {
    const start = DateTime.fromISO(input.newStart, { setZone: true });
    const end = DateTime.fromISO(input.newEnd, { setZone: true });
    const duration = end.diff(start, "minutes").minutes;
    if (duration < 15 || duration > 120) {
      context.addIssue({
        code: "custom",
        path: ["newEnd"],
        message: "Meeting duration must be between 15 and 120 minutes",
      });
    }
    if (start.toFormat("yyyy-MM-dd") !== end.toFormat("yyyy-MM-dd")) {
      context.addIssue({
        code: "custom",
        path: ["newEnd"],
        message: "Meeting must start and end on the same local date",
      });
    }
  });

export type RescheduleMeetingInput = z.infer<typeof rescheduleMeetingInputSchema>;

export const cancelMeetingInputSchema = z
  .object({
    meetingRef: meetingReferenceSchema,
    confirmation: z.literal(true),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export type CancelMeetingInput = z.infer<typeof cancelMeetingInputSchema>;

export const updateMeetingDetailsInputSchema = z
  .object({
    meetingRef: meetingReferenceSchema,
    contactName: optionalString(120),
    companyName: optionalString(160),
    meetingMode: z.preprocess(
      emptyToUndefined,
      z.enum(MEETING_MODES).optional(),
    ),
    phone: phoneSchema,
    location: optionalString(300),
    reason: optionalString(500),
    currentSituation: optionalString(1_000),
    desiredOutcome: optionalString(1_000),
    notes: optionalString(1_000),
  })
  .strict()
  .superRefine((input, context) => {
    const hasUpdate = Object.entries(input).some(
      ([key, value]) => key !== "meetingRef" && value !== undefined,
    );
    if (!hasUpdate) {
      context.addIssue({
        code: "custom",
        path: [],
        message: "At least one meeting detail must be supplied",
      });
    }
    if (input.meetingMode === "PHONE" && !input.phone) {
      context.addIssue({
        code: "custom",
        path: ["phone"],
        message: "A phone number is required when changing to PHONE",
      });
    }
    if (input.meetingMode === "IN_PERSON" && !input.location) {
      context.addIssue({
        code: "custom",
        path: ["location"],
        message: "A location is required when changing to IN_PERSON",
      });
    }
  });

export type UpdateMeetingDetailsInput = z.infer<
  typeof updateMeetingDetailsInputSchema
>;

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

const withCalendarDiagnostic = <T extends { status: string }>(
  operation: string,
  result: T,
): T => {
  const reason =
    "reason" in result && typeof result.reason === "string"
      ? result.reason
      : undefined;
  const category =
    result.status === "calendar_error"
      ? reason === "unavailable"
        ? "provider_unavailable"
        : reason === "configuration"
          ? "configuration_error"
          : reason === "authentication"
            ? "authentication_error"
            : reason
      : result.status === "unavailable" ||
          result.status === "slot_no_longer_available"
        ? "slot_unavailable"
        : result.status === "outside_working_hours"
          ? "outside_working_hours"
          : result.status;
  console.info("[Calendar] diagnostic", { operation, category });
  return result;
};

export const getCalendarAvailability = async (
  input: GetCalendarAvailabilityInput,
): Promise<AvailabilityResult> => {
  const service = getConfiguredCalendarService();
  if (!service) return withCalendarDiagnostic("availability", notConfigured());
  const result = await service.getAvailability(input);
  return withCalendarDiagnostic("availability", result);
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
  if (!service) return withCalendarDiagnostic("booking", notConfigured());
  return withCalendarDiagnostic("booking", await service.bookMeeting(input));
};

export const findEmmaMeetings = async (
  input: FindEmmaMeetingsInput,
): Promise<FindEmmaMeetingsResult> => {
  const service = getConfiguredCalendarService();
  if (!service) return withCalendarDiagnostic("find", notConfigured());
  return withCalendarDiagnostic("find", await service.findEmmaMeetings(input));
};

export const rescheduleMeeting = async (
  input: RescheduleMeetingInput,
): Promise<RescheduleMeetingResult> => {
  const service = getConfiguredCalendarService();
  if (!service) return withCalendarDiagnostic("reschedule", notConfigured());
  return withCalendarDiagnostic("reschedule", await service.rescheduleMeeting(input));
};

export const cancelMeeting = async (
  input: CancelMeetingInput,
): Promise<CancelMeetingResult> => {
  const service = getConfiguredCalendarService();
  if (!service) return withCalendarDiagnostic("cancel", notConfigured());
  return withCalendarDiagnostic("cancel", await service.cancelMeeting(input));
};

export const updateMeetingDetails = async (
  input: UpdateMeetingDetailsInput,
): Promise<UpdateMeetingDetailsResult> => {
  const service = getConfiguredCalendarService();
  if (!service) return withCalendarDiagnostic("update_details", notConfigured());
  return withCalendarDiagnostic(
    "update_details",
    await service.updateMeetingDetails(input),
  );
};
