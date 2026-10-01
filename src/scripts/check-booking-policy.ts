import assert from "node:assert/strict";
import { DateTime } from "luxon";

import {
  GoogleCalendarService,
  formatCalendarTranscript,
  isBlockingClientEvent,
  type CalendarEventToInsert,
  type CalendarGateway,
  type CalendarSettings,
  type StoredCalendarEvent,
} from "../services/google-calendar.js";

const settings: CalendarSettings = {
  calendarId: "booking@example.com",
  timezone: "Europe/Berlin",
  workingHoursStart: "09:00",
  workingHoursEnd: "17:00",
  defaultDurationMinutes: 30,
  bufferMinutes: 30,
};

const event = (privateProperties: Record<string, string>): StoredCalendarEvent => ({
  id: "event-1",
  start: "2026-10-09T10:30:00+02:00",
  end: "2026-10-09T11:00:00+02:00",
  hasConference: false,
  recurring: false,
  privateProperties,
});

assert.equal(isBlockingClientEvent(event({ vsAiSource: "emma" })), true);
assert.equal(isBlockingClientEvent(event({ vsAiBookingCategory: "client_meeting" })), true);
assert.equal(isBlockingClientEvent(event({ personalCategory: "duolingo" })), false);
assert.equal(isBlockingClientEvent(event({ type: "reminder" })), false);

let busy = [{ start: "2026-10-09T10:30:00+02:00", end: "2026-10-09T11:00:00+02:00" }];
let inserted: CalendarEventToInsert | undefined;
const gateway: CalendarGateway = {
  async authenticate() {},
  async checkCalendarAccess() { return {}; },
  async getBusyPeriods() { return busy; },
  async getBusyPeriodsExcludingEvent() { return busy; },
  async getEvent() { return null; },
  async listManagedEvents() { return []; },
  async insertEvent(value) {
    inserted = value;
    return {
      id: value.id,
      start: value.start,
      end: value.end,
      ...(value.location ? { location: value.location } : {}),
      hasConference: false,
      recurring: false,
      privateProperties: value.privateProperties,
    };
  },
  async updateEvent() { throw new Error("not used"); },
  async updateEventDetails() { throw new Error("not used"); },
  async deleteEvent() {},
};
const service = new GoogleCalendarService(gateway, settings);

const buffered = await service.getAvailability({
  date: "2026-10-09", startTime: "10:00", endTime: "10:30",
  durationMinutes: 30, timezone: "Europe/Berlin",
});
assert.equal(buffered.status, "unavailable", "client meetings enforce the 30-minute buffer");

const exactlyBuffered = await service.getAvailability({
  date: "2026-10-09", startTime: "09:30", endTime: "10:00",
  durationMinutes: 30, timezone: "Europe/Berlin",
});
assert.equal(exactlyBuffered.status, "available", "a full 30-minute gap is valid");

busy = [];
const outside = await service.getAvailability({
  date: "2026-10-09", startTime: "18:00", endTime: "18:30",
  durationMinutes: 30, timezone: "Europe/Berlin",
});
assert.equal(outside.status, "outside_working_hours");
assert.equal(outside.alternatives.length, 3, "outside-hours requests include nearest valid alternatives");
assert.match(outside.alternatives[0]?.start ?? "", /^2026-10-12T09:00:00/);

const nearest = await service.getNextAvailableMeetingSlots(
  { durationMinutes: 30, timezone: "Europe/Berlin" },
  // Flexible customers should receive the next valid slot, not another question.
  DateTime.fromISO("2026-10-09T08:00:00+02:00", { setZone: true }),
);
assert.equal(nearest.status, "available");
assert.match(nearest.slots[0]?.start ?? "", /^2026-10-09T09:00:00/);

const booking = await service.bookMeeting({
  contactName: "Alex",
  start: "2026-10-09T12:00:00+02:00",
  end: "2026-10-09T12:30:00+02:00",
  timezone: "Europe/Berlin",
  meetingMode: "IN_PERSON",
  location: "Entrance near Arneken Gallery",
  confirmation: true,
  idempotencyKey: "booking-policy-in-person-1",
});
assert.equal(booking.status, "confirmed");
assert.equal(inserted?.location, "Entrance near Arneken Gallery");
assert.match(inserted?.description ?? "", /Entrance near Arneken Gallery/);
assert.equal(inserted?.privateProperties.vsAiBookingCategory, "client_meeting");

assert.equal(
  formatCalendarTranscript([
    { speaker: "CUSTOMER", delta: "Guten" },
    { speaker: "CUSTOMER", delta: "Tag." },
    { speaker: "EMMA", delta: "Hallo!" },
  ]),
  "--- Automatic call transcript ---\n\nCustomer:\nGuten Tag.\n\nEmma:\nHallo!",
  "Calendar mirrors use the same readable speaker-turn format",
);

console.log("Booking policy checks passed (personal classification, client conflicts, 30-minute buffer, outside-hours alternatives, flexible nearest slot, and in-person place persistence).");
