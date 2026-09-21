import { createHash } from "node:crypto";

import { env } from "../config/env.js";
import {
  createGoogleCalendarGateway,
  GoogleCalendarService,
  type CalendarSettings,
} from "../services/google-calendar.js";
import {
  bookMeetingInputSchema,
  rescheduleMeetingInputSchema,
} from "../tools/calendar.js";

const argumentsMap = new Map(
  process.argv.slice(2).flatMap((argument) => {
    const [key, ...value] = argument.split("=");
    return key ? [[key, value.join("=")]] : [];
  }),
);

if (!process.argv.includes("--confirm-write")) {
  throw new Error(
    "Refusing to write. Add --confirm-write with explicit --start, --end, --new-start, and --new-end values.",
  );
}

const start = argumentsMap.get("--start");
const end = argumentsMap.get("--end");
const newStart = argumentsMap.get("--new-start");
const newEnd = argumentsMap.get("--new-end");
if (!start || !end || !newStart || !newEnd) {
  throw new Error(
    "Provide --start, --end, --new-start, and --new-end as RFC3339 Europe/Berlin date-times.",
  );
}

if (
  !env.GOOGLE_CALENDAR_ID ||
  !env.GOOGLE_CLIENT_ID ||
  !env.GOOGLE_CLIENT_SECRET ||
  !env.GOOGLE_REFRESH_TOKEN
) {
  throw new Error("Google Calendar environment variables are not configured.");
}

const settings: CalendarSettings = {
  calendarId: env.GOOGLE_CALENDAR_ID,
  timezone: env.CALENDAR_TIMEZONE,
  workingHoursStart: env.CALENDAR_WORKING_HOURS_START,
  workingHoursEnd: env.CALENDAR_WORKING_HOURS_END,
  defaultDurationMinutes: env.CALENDAR_DEFAULT_DURATION_MINUTES,
  bufferMinutes: env.CALENDAR_BUFFER_MINUTES,
};
const gateway = createGoogleCalendarGateway(settings, {
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  refreshToken: env.GOOGLE_REFRESH_TOKEN,
});
const service = new GoogleCalendarService(gateway, settings);
const correlation = createHash("sha256")
  .update(`${start}:${end}:${newStart}:${newEnd}`)
  .digest("hex")
  .slice(0, 24);

const booking = bookMeetingInputSchema.safeParse({
  contactName: "AI Lifecycle Test",
  companyName: null,
  start,
  end,
  timezone: "Europe/Berlin",
  customerEmail: null,
  phone: null,
  reason: "Explicit operator lifecycle integration test",
  notes: null,
  confirmation: true,
  idempotencyKey: `manual-lifecycle-create-${correlation}`,
});
if (!booking.success) throw new Error("Invalid lifecycle test start/end values.");

const created = await service.bookMeeting(booking.data, {
  testTitle: "[TEST] VS Web Studio – AI Lifecycle",
});
if (created.status !== "confirmed") {
  throw new Error(`Create failed: ${created.status}`);
}
console.log("1/6 created");

const eventAfterCreate = await gateway.getEvent(created.calendarEventId);
if (!eventAfterCreate || eventAfterCreate.privateProperties.vsAiSource !== "emma") {
  throw new Error("2/6 verification failed: managed event not found after create");
}
console.log("2/6 verified create");

const lifecycleDates = [start.slice(0, 10), newStart.slice(0, 10)].sort();
const found = await service.findEmmaMeetings({
  dateFrom: lifecycleDates[0],
  dateTo: lifecycleDates[1],
  contactName: "AI Lifecycle Test",
});
if (found.status !== "meeting_found" || found.meetings.length !== 1) {
  throw new Error(`Managed test event lookup was not unique: ${found.status}`);
}

const reschedule = rescheduleMeetingInputSchema.safeParse({
  meetingRef: found.meetings[0]?.meetingRef,
  newStart,
  newEnd,
  timezone: "Europe/Berlin",
  confirmation: true,
  idempotencyKey: `manual-lifecycle-move-${correlation}`,
});
if (!reschedule.success) throw new Error("Invalid lifecycle test new start/end values.");
const moved = await service.rescheduleMeeting(reschedule.data);
if (moved.status !== "rescheduled") throw new Error(`3/6 reschedule failed: ${moved.status}`);
console.log("3/6 rescheduled");

const eventAfterMove = await gateway.getEvent(created.calendarEventId);
if (!eventAfterMove || eventAfterMove.start !== newStart || eventAfterMove.end !== newEnd) {
  throw new Error("4/6 verification failed: event did not retain the requested new time");
}
console.log("4/6 verified reschedule");

const cancelled = await service.cancelMeeting({
  meetingRef: found.meetings[0]?.meetingRef ?? "",
  confirmation: true,
  idempotencyKey: `manual-lifecycle-cancel-${correlation}`,
});
if (cancelled.status !== "cancelled") throw new Error(`5/6 cancellation failed: ${cancelled.status}`);
console.log("5/6 cancelled");

const eventAfterCancel = await gateway.getEvent(created.calendarEventId);
if (eventAfterCancel) throw new Error("6/6 verification failed: event still exists after cancellation");
console.log("6/6 verified deletion; lifecycle integration test passed");
