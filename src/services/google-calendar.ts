import { createHash } from "node:crypto";

import { OAuth2Client } from "google-auth-library";
import { DateTime } from "luxon";

export const CALENDAR_TIMEZONE = "Europe/Berlin" as const;

export interface CalendarSettings {
  calendarId: string;
  timezone: typeof CALENDAR_TIMEZONE;
  workingHoursStart: string;
  workingHoursEnd: string;
  defaultDurationMinutes: number;
  bufferMinutes: number;
}

export interface CalendarCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface CalendarSlot {
  start: string;
  end: string;
}

export interface BusyPeriod {
  start: string;
  end: string;
}

export interface StoredCalendarEvent {
  id: string;
  start?: string;
  end?: string;
  timezone?: string;
  privateProperties: Record<string, string>;
}

export interface CalendarEventToInsert {
  id: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  timezone: string;
  privateProperties: Record<string, string>;
}

export interface CalendarGateway {
  getBusyPeriods(timeMin: string, timeMax: string): Promise<BusyPeriod[]>;
  getEvent(eventId: string): Promise<StoredCalendarEvent | null>;
  insertEvent(event: CalendarEventToInsert): Promise<StoredCalendarEvent>;
}

export type AvailabilityInput = {
  date: string;
  startTime?: string | undefined;
  endTime?: string | undefined;
  timeWindow?: "morning" | "afternoon" | "evening" | undefined;
  durationMinutes: number;
  timezone: typeof CALENDAR_TIMEZONE;
};

export type AvailabilityResult =
  | {
      status: "available" | "unavailable";
      requestedSlot: CalendarSlot | null;
      alternatives: CalendarSlot[];
      externalActionPerformed: false;
    }
  | {
      status: "outside_working_hours";
      requestedSlot: CalendarSlot | null;
      alternatives: CalendarSlot[];
      externalActionPerformed: false;
    }
  | CalendarFailureResult;

export type BookingInput = {
  contactName?: string | undefined;
  companyName?: string | undefined;
  start: string;
  end: string;
  timezone: typeof CALENDAR_TIMEZONE;
  customerEmail?: string | undefined;
  phone?: string | undefined;
  reason?: string | undefined;
  notes?: string | undefined;
  confirmation?: boolean | undefined;
  idempotencyKey: string;
};

export type BookingResult =
  | {
      status: "confirmed";
      externalActionPerformed: true;
      calendarEventId: string;
      start: string;
      end: string;
      timezone: typeof CALENDAR_TIMEZONE;
      duplicate: boolean;
    }
  | {
      status: "confirmation_required" | "duplicate_conflict";
      externalActionPerformed: false;
    }
  | {
      status: "slot_no_longer_available";
      alternatives: CalendarSlot[];
      externalActionPerformed: false;
    }
  | CalendarFailureResult;

export type CalendarFailureResult = {
  status: "calendar_error";
  reason: "configuration" | "authentication" | "rate_limited" | "unavailable";
  externalActionPerformed: false;
};

export class CalendarProviderError extends Error {
  constructor(
    public readonly reason: CalendarFailureResult["reason"],
    message = "Calendar provider request failed",
  ) {
    super(message);
    this.name = "CalendarProviderError";
  }
}

const readStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    code?: unknown;
    response?: { status?: unknown };
  };
  if (typeof candidate.response?.status === "number") {
    return candidate.response.status;
  }
  return typeof candidate.code === "number" ? candidate.code : undefined;
};

const providerReason = (
  error: unknown,
): CalendarFailureResult["reason"] => {
  const status = readStatus(error);
  const responseData =
    error && typeof error === "object"
      ? (error as { response?: { data?: unknown } }).response?.data
      : undefined;
  const providerCode = JSON.stringify(responseData ?? "").toLowerCase();
  if (
    status === 429 ||
    providerCode.includes("ratelimit") ||
    providerCode.includes("quota")
  ) {
    return "rate_limited";
  }
  if (
    status === 401 ||
    status === 403 ||
    providerCode.includes("invalid_grant") ||
    providerCode.includes("unauthorized")
  ) {
    return "authentication";
  }
  return "unavailable";
};

interface GoogleEventResponse {
  id?: string | null;
  start?: { dateTime?: string | null; timeZone?: string | null };
  end?: { dateTime?: string | null };
  extendedProperties?: { private?: Record<string, string> | null };
}

interface GoogleFreeBusyResponse {
  calendars?: Record<
    string,
    {
      errors?: unknown[];
      busy?: Array<{ start?: string | null; end?: string | null }>;
    }
  >;
}

const asStoredEvent = (event: GoogleEventResponse): StoredCalendarEvent => ({
  id: event.id ?? "",
  ...(event.start?.dateTime ? { start: event.start.dateTime } : {}),
  ...(event.end?.dateTime ? { end: event.end.dateTime } : {}),
  ...(event.start?.timeZone ? { timezone: event.start.timeZone } : {}),
  privateProperties: event.extendedProperties?.private ?? {},
});

export const createGoogleCalendarGateway = (
  settings: CalendarSettings,
  credentials: CalendarCredentials,
): CalendarGateway => {
  const auth = new OAuth2Client(
    credentials.clientId,
    credentials.clientSecret,
  );
  auth.setCredentials({ refresh_token: credentials.refreshToken });
  const calendarBaseUrl = "https://www.googleapis.com/calendar/v3";
  const encodedCalendarId = encodeURIComponent(settings.calendarId);

  return {
    async getBusyPeriods(timeMin, timeMax) {
      try {
        const response = await auth.request<GoogleFreeBusyResponse>({
          url: `${calendarBaseUrl}/freeBusy`,
          method: "POST",
          data: {
            timeMin,
            timeMax,
            timeZone: settings.timezone,
            items: [{ id: settings.calendarId }],
          },
        });
        const calendars = response.data.calendars ?? {};
        const calendarResult =
          calendars[settings.calendarId] ?? Object.values(calendars)[0];
        if (calendarResult?.errors?.length) {
          throw new CalendarProviderError("unavailable");
        }
        return (calendarResult?.busy ?? []).flatMap((period) =>
          period.start && period.end
            ? [{ start: period.start, end: period.end }]
            : [],
        );
      } catch (error) {
        if (error instanceof CalendarProviderError) throw error;
        throw new CalendarProviderError(providerReason(error));
      }
    },

    async getEvent(eventId) {
      try {
        const response = await auth.request<GoogleEventResponse>({
          url: `${calendarBaseUrl}/calendars/${encodedCalendarId}/events/${encodeURIComponent(eventId)}`,
          method: "GET",
        });
        return asStoredEvent(response.data);
      } catch (error) {
        if (readStatus(error) === 404) return null;
        throw new CalendarProviderError(providerReason(error));
      }
    },

    async insertEvent(event) {
      try {
        const response = await auth.request<GoogleEventResponse>({
          url: `${calendarBaseUrl}/calendars/${encodedCalendarId}/events`,
          method: "POST",
          params: { sendUpdates: "none" },
          data: {
            id: event.id,
            summary: event.summary,
            description: event.description,
            visibility: "private",
            transparency: "opaque",
            start: { dateTime: event.start, timeZone: event.timezone },
            end: { dateTime: event.end, timeZone: event.timezone },
            extendedProperties: { private: event.privateProperties },
          },
        });
        return asStoredEvent(response.data);
      } catch (error) {
        if (readStatus(error) === 409) throw error;
        throw new CalendarProviderError(providerReason(error));
      }
    },
  };
};

const requireIso = (value: string | null): string => {
  if (!value) throw new Error("Unable to format calendar time");
  return value;
};

const toIso = (value: DateTime): string =>
  requireIso(value.toISO({ suppressMilliseconds: true }));

const timeOnDate = (date: string, time: string, zone: string): DateTime =>
  DateTime.fromFormat(`${date} ${time}`, "yyyy-MM-dd HH:mm", {
    zone,
    setZone: true,
  });

const intervalsOverlap = (
  start: DateTime,
  end: DateTime,
  busy: BusyPeriod,
  bufferMinutes: number,
): boolean => {
  const busyStart = DateTime.fromISO(busy.start, { setZone: true }).minus({
    minutes: bufferMinutes,
  });
  const busyEnd = DateTime.fromISO(busy.end, { setZone: true }).plus({
    minutes: bufferMinutes,
  });
  return start.toMillis() < busyEnd.toMillis() && end.toMillis() > busyStart.toMillis();
};

const isSlotFree = (
  start: DateTime,
  end: DateTime,
  busyPeriods: BusyPeriod[],
  bufferMinutes: number,
): boolean =>
  !busyPeriods.some((busy) =>
    intervalsOverlap(start, end, busy, bufferMinutes),
  );

const windowBounds = (
  input: AvailabilityInput,
  workStart: DateTime,
  workEnd: DateTime,
): { start: DateTime; end: DateTime } => {
  if (input.timeWindow === "morning") {
    return {
      start: workStart,
      end: DateTime.min(workEnd, workStart.set({ hour: 12, minute: 0 })),
    };
  }
  if (input.timeWindow === "afternoon") {
    return {
      start: DateTime.max(workStart, workStart.set({ hour: 12, minute: 0 })),
      end: workEnd,
    };
  }
  if (input.timeWindow === "evening") {
    return {
      start: DateTime.max(workStart, workStart.set({ hour: 17, minute: 0 })),
      end: workEnd,
    };
  }
  return { start: workStart, end: workEnd };
};

const findAlternatives = (
  rangeStart: DateTime,
  rangeEnd: DateTime,
  durationMinutes: number,
  busyPeriods: BusyPeriod[],
  bufferMinutes: number,
  excludedStart?: DateTime,
): CalendarSlot[] => {
  const alternatives: CalendarSlot[] = [];
  let candidate = rangeStart;
  while (
    candidate.plus({ minutes: durationMinutes }).toMillis() <=
      rangeEnd.toMillis() &&
    alternatives.length < 3
  ) {
    const end = candidate.plus({ minutes: durationMinutes });
    if (
      candidate.toMillis() !== excludedStart?.toMillis() &&
      isSlotFree(candidate, end, busyPeriods, bufferMinutes)
    ) {
      alternatives.push({ start: toIso(candidate), end: toIso(end) });
    }
    candidate = candidate.plus({ minutes: 15 });
  }
  return alternatives;
};

const calendarFailure = (error: unknown): CalendarFailureResult => ({
  status: "calendar_error",
  reason:
    error instanceof CalendarProviderError ? error.reason : "unavailable",
  externalActionPerformed: false,
});

const bookingHash = (input: BookingInput): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        contactName: input.contactName ?? null,
        companyName: input.companyName ?? null,
        start: input.start,
        end: input.end,
        timezone: input.timezone,
        customerEmail: input.customerEmail ?? null,
        phone: input.phone ?? null,
        reason: input.reason ?? null,
        notes: input.notes ?? null,
      }),
    )
    .digest("hex");

const deterministicEventId = (
  calendarId: string,
  idempotencyKey: string,
): string =>
  `vsai${createHash("sha256")
    .update(`${calendarId}:${idempotencyKey}`)
    .digest("hex")}`;

const eventDescription = (input: BookingInput): string =>
  [
    input.contactName ? `Contact: ${input.contactName}` : undefined,
    input.companyName ? `Company: ${input.companyName}` : undefined,
    input.reason ? `Reason: ${input.reason}` : undefined,
    input.notes ? `Notes: ${input.notes}` : undefined,
    "Source: VS AI Voice Agent / Emma",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

export class GoogleCalendarService {
  constructor(
    private readonly gateway: CalendarGateway,
    private readonly settings: CalendarSettings,
  ) {}

  async getAvailability(input: AvailabilityInput): Promise<AvailabilityResult> {
    const workStart = timeOnDate(
      input.date,
      this.settings.workingHoursStart,
      input.timezone,
    );
    const workEnd = timeOnDate(
      input.date,
      this.settings.workingHoursEnd,
      input.timezone,
    );
    const exactStart = input.startTime
      ? timeOnDate(input.date, input.startTime, input.timezone)
      : undefined;
    const exactEnd = exactStart
      ? input.endTime
        ? timeOnDate(input.date, input.endTime, input.timezone)
        : exactStart.plus({ minutes: input.durationMinutes })
      : undefined;
    const requestedSlot =
      exactStart && exactEnd
        ? { start: toIso(exactStart), end: toIso(exactEnd) }
        : null;

    if (workStart.weekday > 5) {
      return {
        status: "outside_working_hours",
        requestedSlot,
        alternatives: [],
        externalActionPerformed: false,
      };
    }

    const { start: rangeStart, end: rangeEnd } = windowBounds(
      input,
      workStart,
      workEnd,
    );
    if (
      rangeStart.toMillis() >= rangeEnd.toMillis() ||
      (exactStart &&
        exactEnd &&
        (exactStart.toMillis() < workStart.toMillis() ||
          exactEnd.toMillis() > workEnd.toMillis()))
    ) {
      return {
        status: "outside_working_hours",
        requestedSlot,
        alternatives: [],
        externalActionPerformed: false,
      };
    }

    try {
      const busyPeriods = await this.gateway.getBusyPeriods(
        toIso(workStart.minus({ minutes: this.settings.bufferMinutes })),
        toIso(workEnd.plus({ minutes: this.settings.bufferMinutes })),
      );
      const alternatives = findAlternatives(
        rangeStart,
        rangeEnd,
        input.durationMinutes,
        busyPeriods,
        this.settings.bufferMinutes,
        exactStart,
      );

      if (!exactStart || !exactEnd) {
        return {
          status: alternatives.length > 0 ? "available" : "unavailable",
          requestedSlot: null,
          alternatives,
          externalActionPerformed: false,
        };
      }

      const available = isSlotFree(
        exactStart,
        exactEnd,
        busyPeriods,
        this.settings.bufferMinutes,
      );
      return {
        status: available ? "available" : "unavailable",
        requestedSlot,
        alternatives: available ? [] : alternatives,
        externalActionPerformed: false,
      };
    } catch (error) {
      return calendarFailure(error);
    }
  }

  async bookMeeting(
    input: BookingInput,
    options: { testTitle?: boolean } = {},
  ): Promise<BookingResult> {
    if (input.confirmation !== true) {
      return {
        status: "confirmation_required",
        externalActionPerformed: false,
      };
    }

    const requestHash = bookingHash(input);
    const eventId = deterministicEventId(
      this.settings.calendarId,
      input.idempotencyKey,
    );

    try {
      const existing = await this.gateway.getEvent(eventId);
      if (existing) {
        if (existing.privateProperties.vsAiRequestHash !== requestHash) {
          return {
            status: "duplicate_conflict",
            externalActionPerformed: false,
          };
        }
        return {
          status: "confirmed",
          externalActionPerformed: true,
          calendarEventId: existing.id,
          start: existing.start ?? input.start,
          end: existing.end ?? input.end,
          timezone: CALENDAR_TIMEZONE,
          duplicate: true,
        };
      }

      const start = DateTime.fromISO(input.start, { setZone: true }).setZone(
        input.timezone,
      );
      const end = DateTime.fromISO(input.end, { setZone: true }).setZone(
        input.timezone,
      );
      const availability = await this.getAvailability({
        date: start.toFormat("yyyy-MM-dd"),
        startTime: start.toFormat("HH:mm"),
        endTime: end.toFormat("HH:mm"),
        durationMinutes: Math.round(end.diff(start, "minutes").minutes),
        timezone: input.timezone,
      });
      if (availability.status !== "available") {
        if (
          availability.status === "unavailable" ||
          availability.status === "outside_working_hours"
        ) {
          return {
            status: "slot_no_longer_available",
            alternatives: availability.alternatives,
            externalActionPerformed: false,
          };
        }
        if (availability.status === "calendar_error") return availability;
        return {
          status: "calendar_error",
          reason: "unavailable",
          externalActionPerformed: false,
        };
      }

      const label = input.companyName ?? input.contactName ?? "Customer";
      const event = await this.gateway.insertEvent({
        id: eventId,
        summary: options.testTitle
          ? "[TEST] VS Web Studio – AI Agent"
          : `VS Web Studio – Beratung – ${label}`,
        description: eventDescription(input),
        start: input.start,
        end: input.end,
        timezone: input.timezone,
        privateProperties: {
          vsAiRequestHash: requestHash,
          vsAiSource: "emma",
        },
      });
      console.info("[Calendar] meeting created");
      return {
        status: "confirmed",
        externalActionPerformed: true,
        calendarEventId: event.id,
        start: event.start ?? input.start,
        end: event.end ?? input.end,
        timezone: CALENDAR_TIMEZONE,
        duplicate: false,
      };
    } catch (error) {
      if (readStatus(error) === 409) {
        try {
          const existing = await this.gateway.getEvent(eventId);
          if (
            existing &&
            existing.privateProperties.vsAiRequestHash === requestHash
          ) {
            return {
              status: "confirmed",
              externalActionPerformed: true,
              calendarEventId: existing.id,
              start: existing.start ?? input.start,
              end: existing.end ?? input.end,
              timezone: CALENDAR_TIMEZONE,
              duplicate: true,
            };
          }
          return {
            status: "duplicate_conflict",
            externalActionPerformed: false,
          };
        } catch (lookupError) {
          return calendarFailure(lookupError);
        }
      }
      return calendarFailure(error);
    }
  }
}
