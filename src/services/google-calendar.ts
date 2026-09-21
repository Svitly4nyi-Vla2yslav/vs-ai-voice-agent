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
  summary?: string;
  description?: string;
  start?: string;
  end?: string;
  timezone?: string;
  recurring: boolean;
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
  authenticate(): Promise<void>;
  checkCalendarAccess(): Promise<void>;
  getBusyPeriods(timeMin: string, timeMax: string): Promise<BusyPeriod[]>;
  getBusyPeriodsExcludingEvent(
    timeMin: string,
    timeMax: string,
    excludedEventId: string,
  ): Promise<BusyPeriod[]>;
  getEvent(eventId: string): Promise<StoredCalendarEvent | null>;
  listManagedEvents(timeMin: string, timeMax: string): Promise<StoredCalendarEvent[]>;
  insertEvent(event: CalendarEventToInsert): Promise<StoredCalendarEvent>;
  updateEvent(
    eventId: string,
    update: Pick<CalendarEventToInsert, "start" | "end" | "timezone" | "privateProperties">,
  ): Promise<StoredCalendarEvent>;
  deleteEvent(eventId: string): Promise<void>;
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

export type FindEmmaMeetingsInput = {
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  contactName?: string | undefined;
  companyName?: string | undefined;
  approximateDate?: string | undefined;
};

export type EmmaMeetingCandidate = {
  meetingRef: string;
  start: string;
  end: string;
  timezone: typeof CALENDAR_TIMEZONE;
  contactName?: string | undefined;
  companyName?: string | undefined;
  reason?: string | undefined;
};

export type FindEmmaMeetingsResult =
  | {
      status: "no_meetings" | "meeting_found" | "multiple_meetings";
      meetings: EmmaMeetingCandidate[];
      externalActionPerformed: false;
    }
  | CalendarFailureResult;

export type RescheduleMeetingInput = {
  meetingRef: string;
  newStart: string;
  newEnd: string;
  timezone: typeof CALENDAR_TIMEZONE;
  confirmation?: boolean | undefined;
  idempotencyKey: string;
};

export type RescheduleMeetingResult =
  | {
      status: "rescheduled";
      externalActionPerformed: true;
      start: string;
      end: string;
      timezone: typeof CALENDAR_TIMEZONE;
      duplicate: boolean;
    }
  | {
      status:
        | "confirmation_required"
        | "not_found"
        | "not_managed_by_emma"
        | "recurring_event_not_supported"
        | "duplicate_conflict";
      externalActionPerformed: false;
    }
  | {
      status: "slot_no_longer_available";
      alternatives: CalendarSlot[];
      externalActionPerformed: false;
    }
  | CalendarFailureResult;

export type CancelMeetingInput = {
  meetingRef: string;
  confirmation?: boolean | undefined;
  idempotencyKey: string;
};

export type CancelMeetingResult =
  | { status: "cancelled"; externalActionPerformed: true }
  | {
      status:
        | "confirmation_required"
        | "not_found_or_already_cancelled"
        | "not_managed_by_emma"
        | "recurring_event_not_supported";
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
  summary?: string | null;
  description?: string | null;
  start?: { dateTime?: string | null; timeZone?: string | null };
  end?: { dateTime?: string | null };
  recurrence?: string[] | null;
  recurringEventId?: string | null;
  extendedProperties?: { private?: Record<string, string> | null };
}

interface GoogleEventsListResponse {
  items?: GoogleEventResponse[];
  nextPageToken?: string | null;
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
  ...(event.summary ? { summary: event.summary } : {}),
  ...(event.description ? { description: event.description } : {}),
  ...(event.start?.dateTime ? { start: event.start.dateTime } : {}),
  ...(event.end?.dateTime ? { end: event.end.dateTime } : {}),
  ...(event.start?.timeZone ? { timezone: event.start.timeZone } : {}),
  recurring: Boolean(event.recurringEventId || event.recurrence?.length),
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
    async authenticate() {
      try {
        await auth.getAccessToken();
      } catch (error) {
        throw new CalendarProviderError(providerReason(error));
      }
    },

    async checkCalendarAccess() {
      try {
        await auth.request<GoogleEventsListResponse>({
          url: `${calendarBaseUrl}/calendars/${encodedCalendarId}/events`,
          method: "GET",
          params: {
            maxResults: 1,
            showDeleted: false,
            fields: "nextPageToken",
          },
        });
      } catch (error) {
        throw new CalendarProviderError(providerReason(error));
      }
    },

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

    async getBusyPeriodsExcludingEvent(timeMin, timeMax, excludedEventId) {
      try {
        const events: GoogleEventResponse[] = [];
        let pageToken: string | undefined;
        do {
          const response = await auth.request<GoogleEventsListResponse>({
            url: `${calendarBaseUrl}/calendars/${encodedCalendarId}/events`,
            method: "GET",
            params: {
              timeMin,
              timeMax,
              singleEvents: true,
              showDeleted: false,
              maxResults: 250,
              ...(pageToken ? { pageToken } : {}),
            },
          });
          events.push(...(response.data.items ?? []));
          pageToken = response.data.nextPageToken ?? undefined;
        } while (pageToken);
        return events.flatMap((event) =>
          event.id !== excludedEventId && event.start?.dateTime && event.end?.dateTime
            ? [{ start: event.start.dateTime, end: event.end.dateTime }]
            : [],
        );
      } catch (error) {
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

    async listManagedEvents(timeMin, timeMax) {
      try {
        const events: GoogleEventResponse[] = [];
        let pageToken: string | undefined;
        do {
          const response = await auth.request<GoogleEventsListResponse>({
            url: `${calendarBaseUrl}/calendars/${encodedCalendarId}/events`,
            method: "GET",
            params: {
              timeMin,
              timeMax,
              privateExtendedProperty: "vsAiSource=emma",
              singleEvents: true,
              showDeleted: false,
              orderBy: "startTime",
              maxResults: 250,
              ...(pageToken ? { pageToken } : {}),
            },
          });
          events.push(...(response.data.items ?? []));
          pageToken = response.data.nextPageToken ?? undefined;
        } while (pageToken);
        return events.map(asStoredEvent);
      } catch (error) {
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

    async updateEvent(eventId, update) {
      try {
        const response = await auth.request<GoogleEventResponse>({
          url: `${calendarBaseUrl}/calendars/${encodedCalendarId}/events/${encodeURIComponent(eventId)}`,
          method: "PATCH",
          params: { sendUpdates: "none" },
          data: {
            start: { dateTime: update.start, timeZone: update.timezone },
            end: { dateTime: update.end, timeZone: update.timezone },
            extendedProperties: { private: update.privateProperties },
          },
        });
        return asStoredEvent(response.data);
      } catch (error) {
        if (readStatus(error) === 404) return Promise.reject(error);
        throw new CalendarProviderError(providerReason(error));
      }
    },

    async deleteEvent(eventId) {
      try {
        await auth.request({
          url: `${calendarBaseUrl}/calendars/${encodedCalendarId}/events/${encodeURIComponent(eventId)}`,
          method: "DELETE",
          params: { sendUpdates: "none" },
        });
      } catch (error) {
        if (readStatus(error) === 404) return;
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

const meetingReference = (eventId: string): string =>
  `emma_${Buffer.from(eventId, "utf8").toString("base64url")}`;

const eventIdFromMeetingReference = (reference: string): string | null => {
  if (!reference.startsWith("emma_")) return null;
  try {
    const eventId = Buffer.from(reference.slice(5), "base64url").toString("utf8");
    return eventId.length > 0 ? eventId : null;
  } catch {
    return null;
  }
};

const descriptionField = (
  event: StoredCalendarEvent,
  label: "Contact" | "Company" | "Reason",
): string | undefined => {
  const prefix = `${label}: `;
  return event.description
    ?.split(/\r?\n/u)
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
};

const mutationHash = (eventId: string, input: RescheduleMeetingInput): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        eventId,
        newStart: input.newStart,
        newEnd: input.newEnd,
        timezone: input.timezone,
      }),
    )
    .digest("hex");

const managedEventStatus = (
  event: StoredCalendarEvent,
): "managed" | "not_managed_by_emma" | "recurring_event_not_supported" => {
  if (event.privateProperties.vsAiSource !== "emma") {
    return "not_managed_by_emma";
  }
  if (event.recurring) return "recurring_event_not_supported";
  return "managed";
};

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

  async findEmmaMeetings(
    input: FindEmmaMeetingsInput,
    now = DateTime.now().setZone(CALENDAR_TIMEZONE),
  ): Promise<FindEmmaMeetingsResult> {
    const approximate = input.approximateDate
      ? DateTime.fromISO(input.approximateDate, { zone: CALENDAR_TIMEZONE })
      : undefined;
    const from = input.dateFrom
      ? DateTime.fromISO(input.dateFrom, { zone: CALENDAR_TIMEZONE }).startOf("day")
      : approximate
        ? approximate.minus({ days: 7 }).startOf("day")
        : now.minus({ days: 30 }).startOf("day");
    const to = input.dateTo
      ? DateTime.fromISO(input.dateTo, { zone: CALENDAR_TIMEZONE }).endOf("day")
      : approximate
        ? approximate.plus({ days: 7 }).endOf("day")
        : now.plus({ days: 180 }).endOf("day");

    try {
      const events = await this.gateway.listManagedEvents(toIso(from), toIso(to));
      const contactFilter = input.contactName?.toLocaleLowerCase("de");
      const companyFilter = input.companyName?.toLocaleLowerCase("de");
      const meetings = events
        .filter((event) => event.privateProperties.vsAiSource === "emma")
        .filter((event) => !event.recurring && event.start && event.end)
        .map((event) => ({
          event,
          contactName: descriptionField(event, "Contact"),
          companyName: descriptionField(event, "Company"),
          reason: descriptionField(event, "Reason"),
        }))
        .filter(({ contactName }) =>
          contactFilter
            ? contactName?.toLocaleLowerCase("de").includes(contactFilter)
            : true,
        )
        .filter(({ companyName }) =>
          companyFilter
            ? companyName?.toLocaleLowerCase("de").includes(companyFilter)
            : true,
        )
        .slice(0, 3)
        .map(({ event, contactName, companyName, reason }) => ({
          meetingRef: meetingReference(event.id),
          start: event.start as string,
          end: event.end as string,
          timezone: CALENDAR_TIMEZONE,
          ...(contactName ? { contactName } : {}),
          ...(companyName ? { companyName } : {}),
          ...(reason ? { reason } : {}),
        }));
      if (meetings.length > 0) console.info("[Calendar] managed meeting found");
      return {
        status:
          meetings.length === 0
            ? "no_meetings"
            : meetings.length === 1
              ? "meeting_found"
              : "multiple_meetings",
        meetings,
        externalActionPerformed: false,
      };
    } catch (error) {
      return calendarFailure(error);
    }
  }

  async rescheduleMeeting(
    input: RescheduleMeetingInput,
  ): Promise<RescheduleMeetingResult> {
    if (input.confirmation !== true) {
      return { status: "confirmation_required", externalActionPerformed: false };
    }
    const eventId = eventIdFromMeetingReference(input.meetingRef);
    if (!eventId) return { status: "not_found", externalActionPerformed: false };

    try {
      const existing = await this.gateway.getEvent(eventId);
      if (!existing) return { status: "not_found", externalActionPerformed: false };
      const ownership = managedEventStatus(existing);
      if (ownership !== "managed") {
        return { status: ownership, externalActionPerformed: false };
      }

      const requestHash = mutationHash(eventId, input);
      const previousKey = existing.privateProperties.vsAiLastMutationKey;
      const previousHash = existing.privateProperties.vsAiLastMutationHash;
      if (previousKey === input.idempotencyKey) {
        if (
          previousHash !== requestHash ||
          existing.start !== input.newStart ||
          existing.end !== input.newEnd
        ) {
          return { status: "duplicate_conflict", externalActionPerformed: false };
        }
        return {
          status: "rescheduled",
          externalActionPerformed: true,
          start: existing.start ?? input.newStart,
          end: existing.end ?? input.newEnd,
          timezone: CALENDAR_TIMEZONE,
          duplicate: true,
        };
      }

      const start = DateTime.fromISO(input.newStart, { setZone: true }).setZone(input.timezone);
      const end = DateTime.fromISO(input.newEnd, { setZone: true }).setZone(input.timezone);
      const workStart = timeOnDate(start.toFormat("yyyy-MM-dd"), this.settings.workingHoursStart, input.timezone);
      const workEnd = timeOnDate(start.toFormat("yyyy-MM-dd"), this.settings.workingHoursEnd, input.timezone);
      if (
        start.weekday > 5 ||
        start.toMillis() < workStart.toMillis() ||
        end.toMillis() > workEnd.toMillis()
      ) {
        return {
          status: "slot_no_longer_available",
          alternatives: [],
          externalActionPerformed: false,
        };
      }

      const busyPeriods = await this.gateway.getBusyPeriodsExcludingEvent(
        toIso(workStart.minus({ minutes: this.settings.bufferMinutes })),
        toIso(workEnd.plus({ minutes: this.settings.bufferMinutes })),
        eventId,
      );
      if (!isSlotFree(start, end, busyPeriods, this.settings.bufferMinutes)) {
        return {
          status: "slot_no_longer_available",
          alternatives: findAlternatives(
            workStart,
            workEnd,
            Math.round(end.diff(start, "minutes").minutes),
            busyPeriods,
            this.settings.bufferMinutes,
            start,
          ),
          externalActionPerformed: false,
        };
      }

      const updated = await this.gateway.updateEvent(eventId, {
        start: input.newStart,
        end: input.newEnd,
        timezone: input.timezone,
        privateProperties: {
          ...existing.privateProperties,
          vsAiSource: "emma",
          vsAiLastMutationKey: input.idempotencyKey,
          vsAiLastMutationHash: requestHash,
        },
      });
      console.info("[Calendar] meeting rescheduled");
      return {
        status: "rescheduled",
        externalActionPerformed: true,
        start: updated.start ?? input.newStart,
        end: updated.end ?? input.newEnd,
        timezone: CALENDAR_TIMEZONE,
        duplicate: false,
      };
    } catch (error) {
      if (readStatus(error) === 404) {
        return { status: "not_found", externalActionPerformed: false };
      }
      return calendarFailure(error);
    }
  }

  async cancelMeeting(input: CancelMeetingInput): Promise<CancelMeetingResult> {
    if (input.confirmation !== true) {
      return { status: "confirmation_required", externalActionPerformed: false };
    }
    const eventId = eventIdFromMeetingReference(input.meetingRef);
    if (!eventId) {
      return { status: "not_found_or_already_cancelled", externalActionPerformed: false };
    }
    try {
      const existing = await this.gateway.getEvent(eventId);
      if (!existing) {
        return { status: "not_found_or_already_cancelled", externalActionPerformed: false };
      }
      const ownership = managedEventStatus(existing);
      if (ownership !== "managed") {
        return { status: ownership, externalActionPerformed: false };
      }
      await this.gateway.deleteEvent(eventId);
      console.info("[Calendar] meeting cancelled");
      return { status: "cancelled", externalActionPerformed: true };
    } catch (error) {
      if (readStatus(error) === 404) {
        return { status: "not_found_or_already_cancelled", externalActionPerformed: false };
      }
      return calendarFailure(error);
    }
  }

  async bookMeeting(
    input: BookingInput,
    options: { testTitle?: boolean | string } = {},
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
        summary: typeof options.testTitle === "string"
          ? options.testTitle
          : options.testTitle
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
