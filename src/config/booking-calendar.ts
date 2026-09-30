export type BookingCalendarConfigurationStatus =
  | "configuration_missing"
  | "primary_calendar_not_allowed"
  | "configured";

export interface BookingCalendarConfigurationResult {
  status: BookingCalendarConfigurationStatus;
}

/**
 * Перевіряє наявність календаря та за потреби забороняє використання primary.
 *
 * @param calendarId — ідентифікатор календаря з конфігурації середовища.
 * @param options — політика, що визначає обов'язковість окремого booking-календаря.
 * @returns Контрольований статус конфігурації без розкриття самого calendarId.
 */
export const validateBookingCalendarConfiguration = (
  calendarId: string | undefined,
  options: { requireDedicated: boolean } = { requireDedicated: true },
): BookingCalendarConfigurationResult => {
  const normalizedCalendarId = calendarId?.trim();
  if (!normalizedCalendarId) return { status: "configuration_missing" };
  if (
    options.requireDedicated &&
    normalizedCalendarId.toLocaleLowerCase("en-US") === "primary"
  ) {
    return { status: "primary_calendar_not_allowed" };
  }
  return { status: "configured" };
};
