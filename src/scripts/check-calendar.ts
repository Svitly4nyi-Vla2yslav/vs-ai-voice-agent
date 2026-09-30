import assert from "node:assert/strict";
import { DateTime } from "luxon";

import { validateBookingCalendarConfiguration } from "../config/booking-calendar.js";
import {
  GoogleCalendarService,
  type BusyPeriod,
  type CalendarEventToInsert,
  type CalendarEventDetailsUpdate,
  type CalendarGateway,
  type CalendarSettings,
  type StoredCalendarEvent,
} from "../services/google-calendar.js";
import {
  bookMeetingInputSchema,
  cancelMeetingInputSchema,
  findEmmaMeetingsInputSchema,
  rescheduleMeetingInputSchema,
  updateMeetingDetailsInputSchema,
} from "../tools/calendar.js";

const settings: CalendarSettings = {
  calendarId: "vs-web-studio-booking",
  timezone: "Europe/Berlin",
  workingHoursStart: "09:00",
  workingHoursEnd: "17:00",
  defaultDurationMinutes: 30,
  bufferMinutes: 30,
};

class MockCalendarGateway implements CalendarGateway {
  busyPeriods: Array<BusyPeriod & { eventId?: string }> = [];
  events = new Map<string, StoredCalendarEvent>();
  insertCount = 0;
  busyQueryCount = 0;
  exclusionQueryCount = 0;
  updateCount = 0;
  deleteCount = 0;
  detailsUpdateCount = 0;
  insertedEvents: CalendarEventToInsert[] = [];
  detailsUpdates: CalendarEventDetailsUpdate[] = [];
  failDetailsUpdate = false;
  includeUnmanagedInList = false;

  async authenticate(): Promise<void> {}

  async checkCalendarAccess(): Promise<{ summary: string; timezone: string }> {
    return { summary: "VS Web Studio Booking", timezone: "Europe/Berlin" };
  }

  async getBusyPeriods(): Promise<BusyPeriod[]> {
    this.busyQueryCount += 1;
    return this.busyPeriods;
  }

  async getBusyPeriodsExcludingEvent(
    _timeMin: string,
    _timeMax: string,
    excludedEventId: string,
  ): Promise<BusyPeriod[]> {
    this.exclusionQueryCount += 1;
    return this.busyPeriods.filter((period) => period.eventId !== excludedEventId);
  }

  async getEvent(eventId: string): Promise<StoredCalendarEvent | null> {
    return this.events.get(eventId) ?? null;
  }

  async listManagedEvents(): Promise<StoredCalendarEvent[]> {
    return [...this.events.values()].filter(
      (event) =>
        this.includeUnmanagedInList ||
        event.privateProperties.vsAiSource === "emma",
    );
  }

  async insertEvent(event: CalendarEventToInsert): Promise<StoredCalendarEvent> {
    this.insertCount += 1;
    this.insertedEvents.push(event);
    const stored: StoredCalendarEvent = {
      id: event.id,
      summary: event.summary,
      description: event.description,
      start: event.start,
      end: event.end,
      timezone: event.timezone,
      ...(event.location ? { location: event.location } : {}),
      ...(event.meetingMode === "GOOGLE_MEET"
        ? { meetUrl: `https://meet.google.com/${event.id.slice(0, 10)}` }
        : {}),
      hasConference: event.meetingMode === "GOOGLE_MEET",
      recurring: false,
      privateProperties: event.privateProperties,
    };
    this.events.set(event.id, stored);
    return stored;
  }

  async updateEventDetails(
    eventId: string,
    update: CalendarEventDetailsUpdate,
  ): Promise<StoredCalendarEvent> {
    if (this.failDetailsUpdate) throw new Error("simulated provider rejection");
    const existing = this.events.get(eventId);
    if (!existing) throw Object.assign(new Error("not found"), { code: 404 });
    this.detailsUpdateCount += 1;
    this.detailsUpdates.push(update);
    const hasConference =
      update.conferenceAction === "create"
        ? true
        : update.conferenceAction === "clear"
          ? false
          : existing.hasConference;
    const { location: _oldLocation, meetUrl: _oldMeetUrl, ...preserved } = existing;
    const stored: StoredCalendarEvent = {
      ...preserved,
      summary: update.summary,
      description: update.description,
      ...(update.location ? { location: update.location } : {}),
      ...(hasConference
        ? { meetUrl: _oldMeetUrl ?? `https://meet.google.com/${eventId.slice(0, 10)}` }
        : {}),
      hasConference,
      privateProperties: update.privateProperties,
    };
    this.events.set(eventId, stored);
    return stored;
  }

  async updateEvent(
    eventId: string,
    update: Pick<CalendarEventToInsert, "start" | "end" | "timezone" | "privateProperties">,
  ): Promise<StoredCalendarEvent> {
    const existing = this.events.get(eventId);
    if (!existing) throw Object.assign(new Error("not found"), { code: 404 });
    this.updateCount += 1;
    const stored: StoredCalendarEvent = {
      ...existing,
      start: update.start,
      end: update.end,
      timezone: update.timezone,
      privateProperties: update.privateProperties,
    };
    this.events.set(eventId, stored);
    return stored;
  }

  async deleteEvent(eventId: string): Promise<void> {
    if (!this.events.delete(eventId)) {
      throw Object.assign(new Error("not found"), { code: 404 });
    }
    this.deleteCount += 1;
  }
}

const availabilityInput = {
  date: "2026-09-25",
  startTime: "15:00",
  durationMinutes: 30,
  timezone: "Europe/Berlin",
} as const;

const gateway = new MockCalendarGateway();
const personalCalendarGateway = new MockCalendarGateway();
const service = new GoogleCalendarService(gateway, settings);

personalCalendarGateway.busyPeriods = [
  {
    start: "2026-09-25T14:00:00+02:00",
    end: "2026-09-25T14:30:00+02:00",
  },
];
personalCalendarGateway.events.set("private-duolingo", {
  id: "private-duolingo",
  summary: "Duolingo",
  description: "German voice practice",
  start: "2026-09-25T14:00:00+02:00",
  end: "2026-09-25T14:30:00+02:00",
  hasConference: false,
  recurring: false,
  privateProperties: {},
});
const personalConflictInput = {
  ...availabilityInput,
  startTime: "14:00",
} as const;
const available = await service.getAvailability(personalConflictInput);
assert.equal(available.status, "available");
assert.deepEqual(
  available.status === "available" ? available.requestedSlot : null,
  {
    start: "2026-09-25T14:00:00+02:00",
    end: "2026-09-25T14:30:00+02:00",
  },
);
assert.equal(gateway.busyQueryCount, 1, "configured booking calendar is queried once");
assert.equal(
  personalCalendarGateway.busyQueryCount,
  0,
  "an unrelated personal calendar gateway must never be queried",
);
assert.equal(
  JSON.stringify(available).includes("Duolingo") ||
    JSON.stringify(available).includes("German voice practice"),
  false,
  "personal titles and descriptions must never enter availability results",
);

gateway.busyPeriods = [
  {
    start: "2026-09-25T14:00:00+02:00",
    end: "2026-09-25T14:30:00+02:00",
  },
];
const unavailable = await service.getAvailability(personalConflictInput);
assert.equal(unavailable.status, "unavailable");
assert.ok(
  unavailable.status === "unavailable" && unavailable.alternatives.length > 0,
  "busy slots should return alternatives",
);
assert.ok(
  JSON.stringify(unavailable).includes("private") === false,
  "availability result must contain no private event data",
);

assert.deepEqual(
  validateBookingCalendarConfiguration("primary", { requireDedicated: true }),
  { status: "primary_calendar_not_allowed" },
  "production-like configuration must reject the primary calendar",
);
assert.deepEqual(
  validateBookingCalendarConfiguration("vs-web-studio-booking", {
    requireDedicated: true,
  }),
  { status: "configured" },
  "an explicit dedicated calendar ID must be accepted",
);
assert.deepEqual(validateBookingCalendarConfiguration(undefined), {
  status: "configuration_missing",
});

const outsideHours = await service.getAvailability({
  ...availabilityInput,
  startTime: "08:30",
});
assert.equal(outsideHours.status, "outside_working_hours");

gateway.busyPeriods = [
  {
    start: "2026-09-25T14:30:00+02:00",
    end: "2026-09-25T15:00:00+02:00",
  },
];
const bufferOverlap = await service.getAvailability({
  ...availabilityInput,
  startTime: "15:10",
});
assert.equal(bufferOverlap.status, "unavailable");

gateway.busyPeriods = [
  {
    start: "2026-09-25T14:00:00+02:00",
    end: "2026-09-25T14:30:00+02:00",
  },
];
const insideThirtyMinuteBuffer = await service.getAvailability({
  ...availabilityInput,
  startTime: "14:45",
});
assert.equal(insideThirtyMinuteBuffer.status, "unavailable");
const exactBufferBoundary = await service.getAvailability({
  ...availabilityInput,
  startTime: "15:00",
});
assert.equal(exactBufferBoundary.status, "available");

gateway.busyPeriods = [];
const dstResult = await service.getAvailability({
  date: "2026-03-30",
  startTime: "15:00",
  durationMinutes: 30,
  timezone: "Europe/Berlin",
});
assert.equal(dstResult.status, "available");
assert.equal(
  dstResult.status === "available" ? dstResult.requestedSlot?.start : null,
  "2026-03-30T15:00:00+02:00",
);

const bookingInput = {
  contactName: "Test Customer",
  companyName: "Example GmbH",
  meetingMode: "GOOGLE_MEET",
  start: "2026-09-25T15:00:00+02:00",
  end: "2026-09-25T15:30:00+02:00",
  timezone: "Europe/Berlin",
  confirmation: true,
  reason: "Website redesign",
  currentSituation: "Existing website is outdated",
  desiredOutcome: "A modern lead-generating website",
  notes: "Discuss automation",
  idempotencyKey: "test-booking-20260925-1500",
} as const;

assert.equal(bookMeetingInputSchema.safeParse(bookingInput).success, true);
assert.equal(
  bookMeetingInputSchema.safeParse({
    ...bookingInput,
    start: "2026-09-25T15:00:00Z",
    end: "2026-09-25T15:30:00Z",
  }).success,
  false,
  "wrong Berlin offset must be rejected",
);
assert.equal(
  bookMeetingInputSchema.safeParse({
    ...bookingInput,
    meetingMode: "PHONE",
    phone: null,
  }).success,
  false,
  "phone meetings require a confirmed phone number",
);
assert.equal(
  bookMeetingInputSchema.safeParse({
    ...bookingInput,
    meetingMode: "PHONE",
    phone: "+49 30 1234567",
  }).success,
  true,
);
assert.equal(
  bookMeetingInputSchema.safeParse({
    ...bookingInput,
    meetingMode: "IN_PERSON",
    location: null,
  }).success,
  false,
  "in-person meetings require a location",
);
assert.equal(
  bookMeetingInputSchema.safeParse({
    ...bookingInput,
    meetingMode: "IN_PERSON",
    location: "Customer office, Berlin",
  }).success,
  true,
);

const noConfirmation = await service.bookMeeting({
  ...bookingInput,
  confirmation: false,
});
assert.equal(noConfirmation.status, "confirmation_required");
assert.equal(gateway.insertCount, 0);

const missingConfirmation = await service.bookMeeting({
  ...bookingInput,
  confirmation: undefined,
});
assert.equal(missingConfirmation.status, "confirmation_required");
assert.equal(gateway.insertCount, 0);

const firstBooking = await service.bookMeeting(bookingInput);
assert.equal(firstBooking.status, "confirmed");
assert.equal(gateway.insertCount, 1);
assert.equal(
  personalCalendarGateway.insertCount,
  0,
  "booking must never write to an unrelated personal calendar",
);
assert.equal(
  gateway.insertedEvents[0]?.privateProperties.vsAiSource,
  "emma",
  "bookings must preserve Emma ownership metadata",
);
assert.equal(firstBooking.status === "confirmed" ? firstBooking.meetingMode : null, "GOOGLE_MEET");
assert.ok(firstBooking.status === "confirmed" && firstBooking.meetUrl);
assert.ok(gateway.insertedEvents[0]?.conferenceRequestId, "Meet creation request is required");
assert.equal(gateway.insertedEvents[0]?.meetingMode, "GOOGLE_MEET");
assert.match(gateway.insertedEvents[0]?.description ?? "", /Kontakt:\nTest Customer/u);
assert.match(gateway.insertedEvents[0]?.description ?? "", /Firma:\nExample GmbH/u);
assert.match(gateway.insertedEvents[0]?.description ?? "", /Gesprächsart:\nGoogle Meet/u);
assert.match(gateway.insertedEvents[0]?.description ?? "", /Aktuelle Situation:/u);
assert.match(gateway.insertedEvents[0]?.description ?? "", /Ziel:/u);
assert.equal(gateway.insertedEvents[0]?.summary, "VS Web Studio – Beratung – Example GmbH");

const secondMeetGateway = new MockCalendarGateway();
const secondMeetService = new GoogleCalendarService(secondMeetGateway, settings);
const secondMeetBooking = await secondMeetService.bookMeeting({
  ...bookingInput,
  idempotencyKey: "second-meet-booking-20260925-1500",
});
assert.equal(secondMeetBooking.status, "confirmed");
assert.notEqual(
  secondMeetGateway.insertedEvents[0]?.conferenceRequestId,
  gateway.insertedEvents[0]?.conferenceRequestId,
  "different events must use different Meet creation request IDs",
);

const duplicateBooking = await service.bookMeeting(bookingInput);
assert.equal(duplicateBooking.status, "confirmed");
assert.equal(
  duplicateBooking.status === "confirmed" && duplicateBooking.duplicate,
  true,
);
assert.equal(gateway.insertCount, 1, "duplicate must not create a second event");

const conflictingDuplicate = await service.bookMeeting({
  ...bookingInput,
  reason: "A different request using the same key",
});
assert.equal(conflictingDuplicate.status, "duplicate_conflict");
assert.equal(gateway.insertCount, 1);

const phoneGateway = new MockCalendarGateway();
const phoneService = new GoogleCalendarService(phoneGateway, settings);
const phoneBooking = await phoneService.bookMeeting({
  ...bookingInput,
  meetingMode: "PHONE",
  phone: "+49 30 1234567",
  idempotencyKey: "phone-booking-20260925-1500",
});
assert.equal(phoneBooking.status, "confirmed");
assert.equal(phoneGateway.insertedEvents[0]?.conferenceRequestId, undefined);
assert.match(phoneGateway.insertedEvents[0]?.description ?? "", /Gesprächsart:\nTelefon/u);
assert.match(phoneGateway.insertedEvents[0]?.description ?? "", /Telefon:\n\+49 30 1234567/u);

const inPersonGateway = new MockCalendarGateway();
const inPersonService = new GoogleCalendarService(inPersonGateway, settings);
const inPersonBooking = await inPersonService.bookMeeting({
  ...bookingInput,
  meetingMode: "IN_PERSON",
  location: "Customer office, Berlin",
  idempotencyKey: "in-person-booking-20260925-1500",
});
assert.equal(inPersonBooking.status, "confirmed");
assert.equal(inPersonGateway.insertedEvents[0]?.location, "Customer office, Berlin");
assert.match(inPersonGateway.insertedEvents[0]?.description ?? "", /Gesprächsart:\nPersönlich/u);

if (
  firstBooking.status !== "confirmed" ||
  phoneBooking.status !== "confirmed" ||
  inPersonBooking.status !== "confirmed"
) {
  throw new Error("Expected all meeting-mode bookings to succeed");
}
const meetUrlBeforeReschedule = gateway.events.get(firstBooking.calendarEventId)?.meetUrl;
const meetReschedule = await service.rescheduleMeeting({
  meetingRef: `emma_${Buffer.from(firstBooking.calendarEventId).toString("base64url")}`,
  newStart: "2026-09-28T16:00:00+02:00",
  newEnd: "2026-09-28T16:30:00+02:00",
  timezone: "Europe/Berlin",
  confirmation: true,
  idempotencyKey: "preserve-meet-details",
});
assert.equal(meetReschedule.status, "rescheduled");
assert.equal(gateway.events.get(firstBooking.calendarEventId)?.meetUrl, meetUrlBeforeReschedule);
assert.equal(
  gateway.events.get(firstBooking.calendarEventId)?.privateProperties.vsAiMeetingMode,
  "GOOGLE_MEET",
);

const phoneDescriptionBefore = phoneGateway.events.get(phoneBooking.calendarEventId)?.description;
await phoneService.rescheduleMeeting({
  meetingRef: `emma_${Buffer.from(phoneBooking.calendarEventId).toString("base64url")}`,
  newStart: "2026-09-28T13:00:00+02:00",
  newEnd: "2026-09-28T13:30:00+02:00",
  timezone: "Europe/Berlin",
  confirmation: true,
  idempotencyKey: "preserve-phone-details",
});
assert.equal(phoneGateway.events.get(phoneBooking.calendarEventId)?.description, phoneDescriptionBefore);

await inPersonService.rescheduleMeeting({
  meetingRef: `emma_${Buffer.from(inPersonBooking.calendarEventId).toString("base64url")}`,
  newStart: "2026-09-28T12:00:00+02:00",
  newEnd: "2026-09-28T12:30:00+02:00",
  timezone: "Europe/Berlin",
  confirmation: true,
  idempotencyKey: "preserve-location-details",
});
assert.equal(
  inPersonGateway.events.get(inPersonBooking.calendarEventId)?.location,
  "Customer office, Berlin",
);

const raceGateway = new MockCalendarGateway();
raceGateway.busyPeriods = [
  {
    start: bookingInput.start,
    end: bookingInput.end,
  },
];
const raceService = new GoogleCalendarService(raceGateway, settings);
const changedSlot = await raceService.bookMeeting({
  ...bookingInput,
  idempotencyKey: "race-check-20260925-1500",
});
assert.equal(changedSlot.status, "slot_no_longer_available");
assert.equal(raceGateway.busyQueryCount, 1, "booking must re-check availability");
assert.equal(raceGateway.insertCount, 0);

assert.equal(findEmmaMeetingsInputSchema.safeParse({}).success, true);

const lifecycleGateway = new MockCalendarGateway();
const lifecycleService = new GoogleCalendarService(lifecycleGateway, settings);
const managedEvent: StoredCalendarEvent = {
  id: "managed-event-1",
  summary: "VS Web Studio consultation",
  description: "Contact: Erika Muster\nCompany: Muster GmbH\nPhone: +49 30 7654321\nReason: Website relaunch\nSource: VS AI Voice Agent / Emma",
  start: "2026-09-25T15:00:00+02:00",
  end: "2026-09-25T15:30:00+02:00",
  timezone: "Europe/Berlin",
  recurring: false,
  hasConference: false,
  privateProperties: {
    vsAiSource: "emma",
    vsAiRequestHash: "original-hash",
    vsAiMeetingMode: "PHONE",
  },
};
const unmanagedEvent: StoredCalendarEvent = {
  ...managedEvent,
  id: "personal-event-1",
  description: "Contact: Private Person",
  privateProperties: {},
};
lifecycleGateway.events.set(managedEvent.id, managedEvent);
lifecycleGateway.events.set(unmanagedEvent.id, unmanagedEvent);

const oneMeeting = await lifecycleService.findEmmaMeetings({ contactName: "Erika" });
assert.equal(oneMeeting.status, "meeting_found");
assert.equal(oneMeeting.status === "meeting_found" ? oneMeeting.meetings.length : 0, 1);
assert.equal(JSON.stringify(oneMeeting).includes("personal-event-1"), false);
assert.equal(JSON.stringify(oneMeeting).includes("vsAiRequestHash"), false);
assert.equal(JSON.stringify(oneMeeting).includes("managed-event-1"), false, "raw event ID must be opaque");
if (oneMeeting.status !== "meeting_found") throw new Error("Expected one meeting");
const meetingRef = oneMeeting.meetings[0]?.meetingRef;
if (!meetingRef) throw new Error("Expected opaque meeting reference");

const noMeeting = await lifecycleService.findEmmaMeetings({ contactName: "Nobody" });
assert.equal(noMeeting.status, "no_meetings");

lifecycleGateway.events.set("managed-event-2", {
  ...managedEvent,
  id: "managed-event-2",
  start: "2026-09-30T16:00:00+02:00",
  end: "2026-09-30T16:30:00+02:00",
});
const multipleMeetings = await lifecycleService.findEmmaMeetings({ companyName: "Muster" });
assert.equal(multipleMeetings.status, "multiple_meetings");
assert.equal(multipleMeetings.status === "multiple_meetings" ? multipleMeetings.meetings.length : 0, 2);

const rescheduleInput = {
  meetingRef,
  newStart: "2026-09-28T14:00:00+02:00",
  newEnd: "2026-09-28T14:30:00+02:00",
  timezone: "Europe/Berlin",
  confirmation: true,
  idempotencyKey: "reschedule-managed-event-1",
} as const;
assert.equal(rescheduleMeetingInputSchema.safeParse(rescheduleInput).success, true);
assert.equal(
  rescheduleMeetingInputSchema.safeParse({ ...rescheduleInput, confirmation: false }).success,
  false,
);
assert.equal(
  cancelMeetingInputSchema.safeParse({
    meetingRef,
    confirmation: false,
    idempotencyKey: "cancel-managed-event-1",
  }).success,
  false,
);

const rescheduleWithoutConfirmation = await lifecycleService.rescheduleMeeting({
  ...rescheduleInput,
  confirmation: false,
});
assert.equal(rescheduleWithoutConfirmation.status, "confirmation_required");
assert.equal(lifecycleGateway.updateCount, 0);

const unmanagedRef = `emma_${Buffer.from(unmanagedEvent.id).toString("base64url")}`;
const unmanagedReschedule = await lifecycleService.rescheduleMeeting({
  ...rescheduleInput,
  meetingRef: unmanagedRef,
  idempotencyKey: "reschedule-personal-event-1",
});
assert.equal(unmanagedReschedule.status, "not_managed_by_emma");
const unmanagedCancel = await lifecycleService.cancelMeeting({
  meetingRef: unmanagedRef,
  confirmation: true,
  idempotencyKey: "cancel-personal-event-1",
});
assert.equal(unmanagedCancel.status, "not_managed_by_emma");

const recurringEvent = {
  ...managedEvent,
  id: "managed-recurring-event",
  recurring: true,
};
lifecycleGateway.events.set(recurringEvent.id, recurringEvent);
const recurringRef = `emma_${Buffer.from(recurringEvent.id).toString("base64url")}`;
const recurringReschedule = await lifecycleService.rescheduleMeeting({
  ...rescheduleInput,
  meetingRef: recurringRef,
  idempotencyKey: "reschedule-recurring-event",
});
assert.equal(recurringReschedule.status, "recurring_event_not_supported");
const recurringCancel = await lifecycleService.cancelMeeting({
  meetingRef: recurringRef,
  confirmation: true,
  idempotencyKey: "cancel-recurring-event",
});
assert.equal(recurringCancel.status, "recurring_event_not_supported");

lifecycleGateway.busyPeriods = [{
  start: managedEvent.start as string,
  end: managedEvent.end as string,
  eventId: managedEvent.id,
}];
const rescheduled = await lifecycleService.rescheduleMeeting(rescheduleInput);
assert.equal(rescheduled.status, "rescheduled");
assert.equal(lifecycleGateway.exclusionQueryCount, 1, "reschedule must re-check availability");
assert.equal(lifecycleGateway.updateCount, 1);
assert.equal(
  lifecycleGateway.events.get(managedEvent.id)?.privateProperties.vsAiSource,
  "emma",
  "Emma ownership metadata must survive reschedule",
);
assert.equal(
  lifecycleGateway.events.get(managedEvent.id)?.privateProperties.vsAiRequestHash,
  "original-hash",
  "booking metadata must survive reschedule",
);
assert.match(
  lifecycleGateway.events.get(managedEvent.id)?.description ?? "",
  /Website relaunch/u,
  "reschedule must preserve contextual description",
);
assert.equal(
  lifecycleGateway.events.get(managedEvent.id)?.privateProperties.vsAiMeetingMode,
  "PHONE",
  "reschedule must preserve meeting mode",
);

const duplicateReschedule = await lifecycleService.rescheduleMeeting(rescheduleInput);
assert.equal(duplicateReschedule.status, "rescheduled");
assert.equal(
  duplicateReschedule.status === "rescheduled" && duplicateReschedule.duplicate,
  true,
);
assert.equal(lifecycleGateway.updateCount, 1, "duplicate must not update twice");

const conflictReschedule = await lifecycleService.rescheduleMeeting({
  ...rescheduleInput,
  newStart: "2026-09-28T15:00:00+02:00",
  newEnd: "2026-09-28T15:30:00+02:00",
});
assert.equal(conflictReschedule.status, "duplicate_conflict");

const busyGateway = new MockCalendarGateway();
busyGateway.events.set(managedEvent.id, managedEvent);
busyGateway.busyPeriods = [{
  start: rescheduleInput.newStart,
  end: rescheduleInput.newEnd,
  eventId: "another-event",
}];
const busyService = new GoogleCalendarService(busyGateway, settings);
const busyReschedule = await busyService.rescheduleMeeting(rescheduleInput);
assert.equal(busyReschedule.status, "slot_no_longer_available");
assert.equal(busyGateway.exclusionQueryCount, 1);
assert.equal(busyGateway.updateCount, 0);

assert.equal(
  updateMeetingDetailsInputSchema.safeParse({
    meetingRef,
    companyName: "Updated GmbH",
    notes: "Also discuss automation",
  }).success,
  true,
);
const updatedContext = await lifecycleService.updateMeetingDetails({
  meetingRef,
  contactName: "Erika Beispiel",
  companyName: "Updated GmbH",
  notes: "Also discuss automation",
});
assert.equal(updatedContext.status, "details_updated");
const contextEvent = lifecycleGateway.events.get(managedEvent.id);
assert.equal(contextEvent?.start, rescheduleInput.newStart);
assert.equal(contextEvent?.end, rescheduleInput.newEnd);
assert.equal(contextEvent?.summary, "VS Web Studio – Beratung – Updated GmbH");
assert.match(contextEvent?.description ?? "", /Kontakt:\nErika Beispiel/u);
assert.match(contextEvent?.description ?? "", /Zusätzliche Notizen:\nAlso discuss automation/u);
assert.equal(contextEvent?.privateProperties.vsAiRequestHash, "original-hash");
assert.ok(contextEvent?.privateProperties.vsAiLastMutationKey);

const unmanagedDetailsUpdate = await lifecycleService.updateMeetingDetails({
  meetingRef: unmanagedRef,
  notes: "Must not be written",
});
assert.equal(unmanagedDetailsUpdate.status, "not_managed_by_emma");

const phoneToMeet = await lifecycleService.updateMeetingDetails({
  meetingRef,
  meetingMode: "GOOGLE_MEET",
});
assert.equal(phoneToMeet.status, "details_updated");
assert.equal(lifecycleGateway.detailsUpdates.at(-1)?.conferenceAction, "create");
assert.ok(lifecycleGateway.detailsUpdates.at(-1)?.conferenceRequestId);
assert.equal(lifecycleGateway.events.get(managedEvent.id)?.hasConference, true);
assert.equal(lifecycleGateway.events.get(managedEvent.id)?.location, undefined);
const firstMeetUrl = lifecycleGateway.events.get(managedEvent.id)?.meetUrl;
const meetNoteUpdate = await lifecycleService.updateMeetingDetails({
  meetingRef,
  notes: "Keep the same Meet while adding this note",
});
assert.equal(meetNoteUpdate.status, "details_updated");
assert.equal(lifecycleGateway.detailsUpdates.at(-1)?.conferenceAction, "preserve");
assert.equal(lifecycleGateway.detailsUpdates.at(-1)?.conferenceRequestId, undefined);
assert.equal(lifecycleGateway.events.get(managedEvent.id)?.meetUrl, firstMeetUrl);

const meetToPhone = await lifecycleService.updateMeetingDetails({
  meetingRef,
  meetingMode: "PHONE",
  phone: "+49 30 1111111",
});
assert.equal(meetToPhone.status, "details_updated");
assert.equal(lifecycleGateway.detailsUpdates.at(-1)?.conferenceAction, "clear");
assert.equal(lifecycleGateway.events.get(managedEvent.id)?.hasConference, false);
assert.match(
  lifecycleGateway.events.get(managedEvent.id)?.description ?? "",
  /Telefon:\n\+49 30 1111111/u,
);

const phoneToInPerson = await lifecycleService.updateMeetingDetails({
  meetingRef,
  meetingMode: "IN_PERSON",
  location: "Musterstraße 1, Berlin",
});
assert.equal(phoneToInPerson.status, "details_updated");
assert.equal(lifecycleGateway.events.get(managedEvent.id)?.location, "Musterstraße 1, Berlin");
assert.equal(
  (lifecycleGateway.events.get(managedEvent.id)?.description ?? "").includes("Telefon:\n"),
  false,
);

const inPersonToMeet = await lifecycleService.updateMeetingDetails({
  meetingRef,
  meetingMode: "GOOGLE_MEET",
});
assert.equal(inPersonToMeet.status, "details_updated");
assert.equal(lifecycleGateway.detailsUpdates.at(-1)?.conferenceAction, "create");
assert.equal(lifecycleGateway.events.get(managedEvent.id)?.location, undefined);
assert.equal(lifecycleGateway.events.get(managedEvent.id)?.hasConference, true);

const cancelWithoutConfirmation = await lifecycleService.cancelMeeting({
  meetingRef,
  confirmation: false,
  idempotencyKey: "cancel-managed-event-1",
});
assert.equal(cancelWithoutConfirmation.status, "confirmation_required");
const cancelled = await lifecycleService.cancelMeeting({
  meetingRef,
  confirmation: true,
  idempotencyKey: "cancel-managed-event-1",
});
assert.equal(cancelled.status, "cancelled");
assert.equal(lifecycleGateway.deleteCount, 1);
assert.equal(
  personalCalendarGateway.deleteCount,
  0,
  "cancellation must never touch an unrelated personal calendar",
);
const repeatedCancel = await lifecycleService.cancelMeeting({
  meetingRef,
  confirmation: true,
  idempotencyKey: "cancel-managed-event-1",
});
assert.equal(repeatedCancel.status, "not_found_or_already_cancelled");
assert.equal(lifecycleGateway.deleteCount, 1);

const nearestGateway = new MockCalendarGateway();
const nearestService = new GoogleCalendarService(nearestGateway, settings);
const currentDaySlots = await nearestService.getNextAvailableMeetingSlots(
  { durationMinutes: 30, timezone: "Europe/Berlin" },
  DateTime.fromISO("2026-10-01T10:07:00+02:00", { setZone: true }),
);
assert.equal(currentDaySlots.status, "available");
if (currentDaySlots.status === "available") {
  assert.equal(currentDaySlots.slots[0]?.start, "2026-10-01T10:15:00+02:00");
  assert.equal(currentDaySlots.slots.length, 3);
}
const exactQuarterSlots = await nearestService.getNextAvailableMeetingSlots(
  { durationMinutes: 30, timezone: "Europe/Berlin" },
  DateTime.fromISO("2026-10-01T10:15:00+02:00", { setZone: true }),
);
assert.equal(exactQuarterSlots.status, "available");
if (exactQuarterSlots.status === "available") {
  assert.equal(exactQuarterSlots.slots[0]?.start, "2026-10-01T10:30:00+02:00");
}
assert.equal(nearestGateway.busyQueryCount, 2);
assert.equal(personalCalendarGateway.busyQueryCount, 0);

const afterHoursSlots = await nearestService.getNextAvailableMeetingSlots(
  { durationMinutes: 30, timezone: "Europe/Berlin" },
  DateTime.fromISO("2026-10-02T18:00:00+02:00", { setZone: true }),
);
assert.equal(afterHoursSlots.status, "available");
if (afterHoursSlots.status === "available") {
  assert.equal(afterHoursSlots.slots[0]?.start, "2026-10-05T09:00:00+02:00");
}
const weekendSlots = await nearestService.getNextAvailableMeetingSlots(
  { durationMinutes: 30, timezone: "Europe/Berlin" },
  DateTime.fromISO("2026-10-03T10:00:00+02:00", { setZone: true }),
);
assert.equal(weekendSlots.status, "available");
if (weekendSlots.status === "available") {
  assert.equal(weekendSlots.slots[0]?.start, "2026-10-05T09:00:00+02:00");
}

const bufferedGateway = new MockCalendarGateway();
bufferedGateway.busyPeriods = [
  {
    start: "2026-10-01T09:00:00+02:00",
    end: "2026-10-01T09:30:00+02:00",
  },
];
const bufferedService = new GoogleCalendarService(bufferedGateway, settings);
const bufferedSlots = await bufferedService.getNextAvailableMeetingSlots(
  { durationMinutes: 30, timezone: "Europe/Berlin" },
  DateTime.fromISO("2026-10-01T08:30:00+02:00", { setZone: true }),
);
assert.equal(bufferedSlots.status, "available");
if (bufferedSlots.status === "available") {
  assert.equal(bufferedSlots.slots[0]?.start, "2026-10-01T10:00:00+02:00");
}

const transcriptGateway = new MockCalendarGateway();
const transcriptService = new GoogleCalendarService(transcriptGateway, settings);
const transcriptBookingInput = {
  contactName: "Transcript Customer",
  companyName: "Transcript GmbH",
  start: "2026-10-01T14:00:00+02:00",
  end: "2026-10-01T14:30:00+02:00",
  timezone: "Europe/Berlin" as const,
  meetingMode: "GOOGLE_MEET" as const,
  confirmation: true as const,
  idempotencyKey: "transcript-booking-1",
};
const transcriptBooking = await transcriptService.bookMeeting(
  transcriptBookingInput,
  {
    callTaskId: "call-task-transcript-1",
    conversationId: "00000000-0000-4000-8000-000000000123",
  },
);
assert.equal(transcriptBooking.status, "confirmed");
if (transcriptBooking.status !== "confirmed") {
  throw new Error("Expected confirmed transcript booking");
}
const transcriptEventBefore = transcriptGateway.events.get(
  transcriptBooking.calendarEventId,
);
assert.ok(transcriptEventBefore?.privateProperties.vsAiCallTaskRef);
assert.equal(
  JSON.stringify(transcriptEventBefore?.privateProperties).includes(
    "call-task-transcript-1",
  ),
  false,
  "canonical CallTask ID must be stored only as a derived private reference",
);
const crossTaskDuplicate = await transcriptService.bookMeeting(
  transcriptBookingInput,
  {
    callTaskId: "unrelated-call-task",
    conversationId: "00000000-0000-4000-8000-000000000999",
  },
);
assert.equal(
  crossTaskDuplicate.status,
  "duplicate_conflict",
  "an idempotency collision must not bind another task to the existing event",
);
const mirrorSegments = [
  { speaker: "CUSTOMER" as const, delta: "Guten Tag" },
  { speaker: "EMMA" as const, delta: "Guten Tag, mein Name ist Emma." },
];
const mirrored = await transcriptService.mirrorTranscriptForConversation(
  {
    callTaskId: "call-task-transcript-1",
    conversationId: "00000000-0000-4000-8000-000000000123",
  },
  mirrorSegments,
);
assert.equal(mirrored.status, "mirrored");
const transcriptEventAfter = transcriptGateway.events.get(
  transcriptBooking.calendarEventId,
);
assert.equal(transcriptEventAfter?.summary, transcriptEventBefore?.summary);
assert.equal(transcriptEventAfter?.start, transcriptEventBefore?.start);
assert.equal(transcriptEventAfter?.end, transcriptEventBefore?.end);
assert.match(
  transcriptEventAfter?.description ?? "",
  /--- Automatic call transcript ---[\s\S]*Customer:\nGuten Tag[\s\S]*Emma:/u,
);
const detailsUpdatesAfterMirror = transcriptGateway.detailsUpdateCount;
const repeatedMirror = await transcriptService.mirrorTranscriptForConversation(
  {
    callTaskId: "call-task-transcript-1",
    conversationId: "00000000-0000-4000-8000-000000000123",
  },
  mirrorSegments,
);
assert.equal(repeatedMirror.status, "already_mirrored");
assert.equal(transcriptGateway.detailsUpdateCount, detailsUpdatesAfterMirror);

const mismatchedTask = await transcriptService.mirrorTranscriptForConversation(
  {
    callTaskId: "unrelated-call-task",
    conversationId: "00000000-0000-4000-8000-000000000123",
  },
  mirrorSegments,
);
assert.equal(mismatchedTask.status, "call_task_mismatch");
assert.equal(transcriptGateway.detailsUpdateCount, detailsUpdatesAfterMirror);

if (transcriptEventAfter) {
  transcriptGateway.events.set(transcriptBooking.calendarEventId, {
    ...transcriptEventAfter,
    privateProperties: {
      ...transcriptEventAfter.privateProperties,
      vsAiSource: "unrelated-system",
    },
  });
}
transcriptGateway.includeUnmanagedInList = true;
const unmanagedMirror = await transcriptService.mirrorTranscriptForConversation(
  {
    callTaskId: "call-task-transcript-1",
    conversationId: "00000000-0000-4000-8000-000000000123",
  },
  [...mirrorSegments, { speaker: "EMMA" as const, delta: " Mehr Text" }],
);
assert.equal(unmanagedMirror.status, "not_managed_by_emma");
assert.equal(transcriptGateway.detailsUpdateCount, detailsUpdatesAfterMirror);
if (transcriptEventAfter) {
  transcriptGateway.events.set(transcriptBooking.calendarEventId, transcriptEventAfter);
}
transcriptGateway.includeUnmanagedInList = false;

const noMeetingMirror = await transcriptService.mirrorTranscriptForConversation(
  {
    callTaskId: "call-task-transcript-1",
    conversationId: "00000000-0000-4000-8000-000000000999",
  },
  mirrorSegments,
);
assert.equal(noMeetingMirror.status, "no_matching_meeting");

transcriptGateway.failDetailsUpdate = true;
const failedMirror = await transcriptService.mirrorTranscriptForConversation(
  {
    callTaskId: "call-task-transcript-1",
    conversationId: "00000000-0000-4000-8000-000000000123",
  },
  [...mirrorSegments, { speaker: "CUSTOMER" as const, delta: " Mehr Text" }],
);
assert.equal(failedMirror.status, "calendar_transcript_mirror_failed");
assert.equal(
  transcriptGateway.events.get(transcriptBooking.calendarEventId)?.description,
  transcriptEventAfter?.description,
);

console.log("Calendar checks passed (dedicated-calendar isolation, nearest-slot business-day search, buffer/max-three policy, rich bookings, lifecycle, confirmation, CallTask binding, idempotent transcript mirror, and mirror-failure isolation).");
