export type BookingCalendarConfigurationStatus =
  | "configuration_missing"
  | "primary_calendar_not_allowed"
  | "configured";

export interface BookingCalendarConfigurationResult {
  status: BookingCalendarConfigurationStatus;
}

/**
 * Перевіряє ідентифікатор календаря бронювань після trim.
 *
 * @param calendarId — значення з конфігурації середовища.
 * @param options — політика окремого календаря; за замовчуванням забороняє primary.
 * @returns Статус: відсутня конфігурація, primary не дозволено або все налаштовано.
 *
 * Функція не розкриває calendarId у результаті й не звертається до зовнішніх сервісів.
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
