import assert from "node:assert/strict";

import {
  GoogleCalendarService,
  type BusyPeriod,
  type CalendarEventToInsert,
  type CalendarGateway,
  type CalendarSettings,
  type StoredCalendarEvent,
} from "../services/google-calendar.js";
import {
  bookMeetingInputSchema,
  cancelMeetingInputSchema,
  findEmmaMeetingsInputSchema,
  rescheduleMeetingInputSchema,
} from "../tools/calendar.js";

const settings: CalendarSettings = {
  calendarId: "test-calendar",
  timezone: "Europe/Berlin",
  workingHoursStart: "10:30",
  workingHoursEnd: "18:00",
  defaultDurationMinutes: 30,
  bufferMinutes: 15,
};

class MockCalendarGateway implements CalendarGateway {
  busyPeriods: Array<BusyPeriod & { eventId?: string }> = [];
  events = new Map<string, StoredCalendarEvent>();
  insertCount = 0;
  busyQueryCount = 0;
  exclusionQueryCount = 0;
  updateCount = 0;
  deleteCount = 0;

  async authenticate(): Promise<void> {}

  async checkCalendarAccess(): Promise<void> {}

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
      (event) => event.privateProperties.vsAiSource === "emma",
    );
  }

  async insertEvent(event: CalendarEventToInsert): Promise<StoredCalendarEvent> {
    this.insertCount += 1;
    const stored: StoredCalendarEvent = {
      id: event.id,
      summary: event.summary,
      description: event.description,
      start: event.start,
      end: event.end,
      timezone: event.timezone,
      recurring: false,
      privateProperties: event.privateProperties,
    };
    this.events.set(event.id, stored);
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
const service = new GoogleCalendarService(gateway, settings);

const available = await service.getAvailability(availabilityInput);
assert.equal(available.status, "available");
assert.deepEqual(
  available.status === "available" ? available.requestedSlot : null,
  {
    start: "2026-09-25T15:00:00+02:00",
    end: "2026-09-25T15:30:00+02:00",
  },
);

gateway.busyPeriods = [
  {
    start: "2026-09-25T15:00:00+02:00",
    end: "2026-09-25T15:30:00+02:00",
  },
];
const unavailable = await service.getAvailability(availabilityInput);
assert.equal(unavailable.status, "unavailable");
assert.ok(
  unavailable.status === "unavailable" && unavailable.alternatives.length > 0,
  "busy slots should return alternatives",
);
assert.ok(
  JSON.stringify(unavailable).includes("private") === false,
  "availability result must contain no private event data",
);

const outsideHours = await service.getAvailability({
  ...availabilityInput,
  startTime: "10:00",
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
  start: "2026-09-25T15:00:00+02:00",
  end: "2026-09-25T15:30:00+02:00",
  timezone: "Europe/Berlin",
  confirmation: true,
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
  description: "Contact: Erika Muster\nCompany: Muster GmbH\nReason: Website relaunch\nSource: VS AI Voice Agent / Emma",
  start: "2026-09-25T15:00:00+02:00",
  end: "2026-09-25T15:30:00+02:00",
  timezone: "Europe/Berlin",
  recurring: false,
  privateProperties: { vsAiSource: "emma", vsAiRequestHash: "original-hash" },
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
const repeatedCancel = await lifecycleService.cancelMeeting({
  meetingRef,
  confirmation: true,
  idempotencyKey: "cancel-managed-event-1",
});
assert.equal(repeatedCancel.status, "not_found_or_already_cancelled");
assert.equal(lifecycleGateway.deleteCount, 1);

console.log("Calendar checks passed (booking plus managed find/reschedule/cancel lifecycle, privacy, ownership, confirmation, availability re-check, idempotency, metadata preservation).");
