import assert from "node:assert/strict";
import { DateTime } from "luxon";

import {
  VS_WEB_STUDIO_AGENT_INSTRUCTIONS,
  VS_WEB_STUDIO_BACKEND_INSTRUCTIONS,
  VS_WEB_STUDIO_BOOKING_CONVERSATION_POLICY,
  VS_WEB_STUDIO_LIVE_INSTRUCTIONS,
} from "../agent/instructions.js";
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

const phoneBookingWithoutNumber = await service.bookMeeting({
  contactName: "Alex",
  start: "2026-10-09T12:00:00+02:00",
  end: "2026-10-09T12:30:00+02:00",
  timezone: "Europe/Berlin",
  meetingMode: "PHONE",
  confirmation: true,
  idempotencyKey: "booking-policy-phone-1",
});
assert.deepEqual(
  phoneBookingWithoutNumber,
  { status: "details_required", externalActionPerformed: false },
  "choosing PHONE without a confirmed callback number must not be bookable",
);

for (const instructions of [
  VS_WEB_STUDIO_AGENT_INSTRUCTIONS,
  VS_WEB_STUDIO_BACKEND_INSTRUCTIONS,
  VS_WEB_STUDIO_LIVE_INSTRUCTIONS,
]) {
  assert.ok(
    instructions.includes(VS_WEB_STUDIO_BOOKING_CONVERSATION_POLICY),
    "every production instruction path includes the shared booking conversation policy",
  );
}
assert.match(
  VS_WEB_STUDIO_BOOKING_CONVERSATION_POLICY,
  /"Telefon" bestaetigt nur die Gespraechsart, niemals die Rueckrufnummer/,
);
assert.match(
  VS_WEB_STUDIO_BOOKING_CONVERSATION_POLICY,
  /Soll der Rueckruf unter der bereits angegebenen Nummer erfolgen\?/,
);
assert.match(
  VS_WEB_STUDIO_BOOKING_CONVERSATION_POLICY,
  /vollstaendige Nummer nicht aus/,
);
assert.match(
  VS_WEB_STUDIO_BOOKING_CONVERSATION_POLICY,
  /Erfinde, errate oder vervollstaendige niemals eine Telefonnummer/,
);

for (const flexibleUtterance of [
  "Egal.",
  "Mir ist der Tag egal.",
  "Nehmen Sie einfach den naechsten Termin.",
]) {
  assert.ok(
    VS_WEB_STUDIO_BOOKING_CONVERSATION_POLICY.includes(`"${flexibleUtterance}"`),
    `${flexibleUtterance} is explicitly covered by nearest-slot behavior`,
  );
}
assert.match(
  VS_WEB_STUDIO_BOOKING_CONVERSATION_POLICY,
  /getNextAvailableMeetingSlots aufgerufen wird/,
);
assert.match(
  VS_WEB_STUDIO_BOOKING_CONVERSATION_POLICY,
  /Frage dann nicht erneut "Welcher Tag passt Ihnen\?"/,
);

assert.match(
  VS_WEB_STUDIO_BOOKING_CONVERSATION_POLICY,
  /unavailable, outside_working_hours und slot_no_longer_available.*erfolgreicher Kalenderpruefung nicht buchbar/s,
  "slot outcomes retain unavailable semantics",
);
assert.match(
  VS_WEB_STUDIO_BOOKING_CONVERSATION_POLICY,
  /calendar_error, tool_error sowie Transport- oder Backend-Ausfaelle sind technische Fehler und beweisen niemals, dass der Slot belegt ist/,
  "technical failures cannot be described as slot conflicts",
);
assert.match(
  VS_WEB_STUDIO_BOOKING_CONVERSATION_POLICY,
  /Kalenderaktion hoechstens einmal/,
  "a technical Calendar operation can be retried at most once",
);
assert.match(
  VS_WEB_STUDIO_BOOKING_CONVERSATION_POLICY,
  /genau einen menschlichen Rueckruf- oder Follow-up-Pfad/,
  "technical failure terminates in one human fallback instead of an alternative-time loop",
);

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

console.log("Booking policy checks passed (personal classification, client conflicts, 30-minute buffer, outside-hours alternatives, flexible nearest-slot routing, confirmed PHONE callback number, technical-failure semantics, retry limit, human fallback, and in-person place persistence).");
