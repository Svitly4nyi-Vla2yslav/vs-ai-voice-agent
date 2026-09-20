import { createHash } from "node:crypto";

import { env } from "../config/env.js";
import {
  createGoogleCalendarGateway,
  GoogleCalendarService,
  type CalendarSettings,
} from "../services/google-calendar.js";
import { bookMeetingInputSchema } from "../tools/calendar.js";

const argumentsMap = new Map(
  process.argv.slice(2).flatMap((argument) => {
    const [key, ...value] = argument.split("=");
    return key ? [[key, value.join("=")]] : [];
  }),
);

if (!process.argv.includes("--confirm-write")) {
  throw new Error(
    "Refusing to write. Add --confirm-write with explicit --start and --end values.",
  );
}

const start = argumentsMap.get("--start");
const end = argumentsMap.get("--end");
if (!start || !end) {
  throw new Error(
    "Provide --start=<RFC3339 Europe/Berlin time> and --end=<RFC3339 Europe/Berlin time>.",
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
const service = new GoogleCalendarService(
  createGoogleCalendarGateway(settings, {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: env.GOOGLE_REFRESH_TOKEN,
  }),
  settings,
);
const parsed = bookMeetingInputSchema.safeParse({
  contactName: "Calendar integration test",
  companyName: null,
  start,
  end,
  timezone: "Europe/Berlin",
  customerEmail: null,
  phone: null,
  reason: "Explicit manual integration test",
  notes: null,
  confirmation: true,
  idempotencyKey: `manual-test-${createHash("sha256")
    .update(`${start}:${end}`)
    .digest("hex")
    .slice(0, 24)}`,
});
if (!parsed.success) throw new Error("Invalid manual test start/end values.");

const result = await service.bookMeeting(parsed.data, { testTitle: true });
console.log(JSON.stringify(result, null, 2));
if (result.status === "confirmed") {
  console.log(
    "Delete the [TEST] event in Google Calendar after verification. The event ID above is printed only for the operator running this explicit test.",
  );
}
