import "dotenv/config";

import { DateTime, IANAZone } from "luxon";

import {
  CALENDAR_TIMEZONE,
  CalendarProviderError,
  createGoogleCalendarGateway,
  type CalendarFailureResult,
  type CalendarSettings,
} from "../services/google-calendar.js";

const value = (name: string): string | undefined => {
  const candidate = process.env[name]?.trim();
  return candidate ? candidate : undefined;
};

const calendarId = value("GOOGLE_CALENDAR_ID");
const clientId = value("GOOGLE_CLIENT_ID");
const clientSecret = value("GOOGLE_CLIENT_SECRET");
const refreshToken = value("GOOGLE_REFRESH_TOKEN");
const configuredTimezone = value("CALENDAR_TIMEZONE") ?? CALENDAR_TIMEZONE;
const safeCalendarName = (summary: string | undefined): string =>
  summary?.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 120) ||
  "accessible";

console.log("Google Calendar diagnostics\n");
console.log("Environment:");
console.log(`GOOGLE_CALENDAR_ID: ${calendarId ? "configured" : "missing"}`);
console.log(`GOOGLE_CLIENT_ID: ${clientId ? "configured" : "missing"}`);
console.log(`GOOGLE_CLIENT_SECRET: ${clientSecret ? "configured" : "missing"}`);
console.log(`GOOGLE_REFRESH_TOKEN: ${refreshToken ? "configured" : "missing"}`);

if (calendarId === "primary") {
  console.warn(
    "GOOGLE_CALENDAR_ID points to primary. Personal busy events will block customer bookings. VS Web Studio should use its dedicated booking calendar.",
  );
}

if (!calendarId || !clientId || !clientSecret || !refreshToken) {
  console.error("\nDiagnostics stopped: configuration_error.");
  process.exitCode = 1;
} else if (
  configuredTimezone !== CALENDAR_TIMEZONE ||
  !IANAZone.isValidZone(configuredTimezone)
) {
  console.error("\nDiagnostics stopped: configuration_error (invalid timezone).");
  process.exitCode = 1;
} else {
  const settings: CalendarSettings = {
    calendarId,
    timezone: CALENDAR_TIMEZONE,
    workingHoursStart: "10:30",
    workingHoursEnd: "18:00",
    defaultDurationMinutes: 30,
    bufferMinutes: 15,
  };
  const gateway = createGoogleCalendarGateway(settings, {
    clientId,
    clientSecret,
    refreshToken,
  });

  const diagnosticReason = (error: unknown): string => {
    const reason: CalendarFailureResult["reason"] =
      error instanceof CalendarProviderError ? error.reason : "unavailable";
    if (reason === "authentication") return "authentication_error";
    if (reason === "rate_limited") return "rate_limited";
    if (reason === "configuration") return "configuration_error";
    return "provider_unavailable";
  };

  try {
    await gateway.authenticate();
    console.log("\nOAuth authentication: OK");
  } catch (error) {
    console.error(`\nOAuth authentication: FAILED (${diagnosticReason(error)})`);
    process.exitCode = 1;
  }

  if (!process.exitCode) {
    try {
      const calendar = await gateway.checkCalendarAccess();
      console.log(`Configured calendar: ${safeCalendarName(calendar.summary)}`);
      console.log("Configured calendar access: OK");
    } catch (error) {
      console.error("Configured calendar access: FAILED (calendar_not_accessible)");
      process.exitCode = 1;
    }
  }

  if (!process.exitCode) {
    try {
      const now = DateTime.now().setZone(CALENDAR_TIMEZONE);
      const timeMin = now.toISO({ suppressMilliseconds: true });
      const timeMax = now.plus({ hours: 1 }).toISO({ suppressMilliseconds: true });
      if (!timeMin || !timeMax) throw new Error("Invalid diagnostic interval");
      await gateway.getBusyPeriods(timeMin, timeMax);
      console.log("Free/busy API: OK");
    } catch (error) {
      console.error(`Free/busy API: FAILED (${diagnosticReason(error)})`);
      process.exitCode = 1;
    }
  }

  console.log(`Timezone: ${configuredTimezone}`);
}
