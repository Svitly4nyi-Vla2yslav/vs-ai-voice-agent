import assert from "node:assert/strict";

import {
  GoogleCalendarService,
  type BusyPeriod,
  type CalendarEventToInsert,
  type CalendarGateway,
  type CalendarSettings,
  type StoredCalendarEvent,
} from "../services/google-calendar.js";
import { bookMeetingInputSchema } from "../tools/calendar.js";

const settings: CalendarSettings = {
  calendarId: "test-calendar",
  timezone: "Europe/Berlin",
  workingHoursStart: "10:30",
  workingHoursEnd: "18:00",
  defaultDurationMinutes: 30,
  bufferMinutes: 15,
};

class MockCalendarGateway implements CalendarGateway {
  busyPeriods: BusyPeriod[] = [];
  events = new Map<string, StoredCalendarEvent>();
  insertCount = 0;
  busyQueryCount = 0;

  async getBusyPeriods(): Promise<BusyPeriod[]> {
    this.busyQueryCount += 1;
    return this.busyPeriods;
  }

  async getEvent(eventId: string): Promise<StoredCalendarEvent | null> {
    return this.events.get(eventId) ?? null;
  }

  async insertEvent(event: CalendarEventToInsert): Promise<StoredCalendarEvent> {
    this.insertCount += 1;
    const stored: StoredCalendarEvent = {
      id: event.id,
      start: event.start,
      end: event.end,
      timezone: event.timezone,
      privateProperties: event.privateProperties,
    };
    this.events.set(event.id, stored);
    return stored;
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

console.log("Calendar checks passed (availability, privacy, DST, confirmation, idempotency, race, hours, buffer).");
