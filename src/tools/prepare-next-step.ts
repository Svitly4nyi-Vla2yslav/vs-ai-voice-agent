import { z } from "zod";

import {
  nextStepActions,
  nextStepDataFields,
  type PrepareNextStepResult,
} from "./types.js";

const optionalTrimmedString = (maximumLength: number) =>
  z.preprocess(
    (value) =>
      value === null || (typeof value === "string" && value.trim() === "")
        ? undefined
        : value,
    z.string().trim().min(1).max(maximumLength).optional(),
  );

const isCalendarDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

export const prepareNextStepInputSchema = z
  .object({
    type: z.enum(nextStepActions),
    contactName: optionalTrimmedString(120),
    companyName: optionalTrimmedString(160),
    date: z.preprocess(
      (value) =>
        value === null || (typeof value === "string" && value.trim() === "")
          ? undefined
          : value,
      z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine(isCalendarDate)
        .optional(),
    ),
    time: z.preprocess(
      (value) =>
        value === null || (typeof value === "string" && value.trim() === "")
          ? undefined
          : value,
      z
        .string()
        .trim()
        .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
        .optional(),
    ),
    timeWindow: optionalTrimmedString(120),
    email: z.preprocess(
      (value) =>
        value === null || (typeof value === "string" && value.trim() === "")
          ? undefined
          : value,
      z.string().trim().email().max(254).optional(),
    ),
    phone: optionalTrimmedString(50),
    reason: optionalTrimmedString(500),
    notes: optionalTrimmedString(1_000),
  })
  .strict();

export type PrepareNextStepInput = z.infer<
  typeof prepareNextStepInputSchema
>;

export const prepareNextStep = (
  input: PrepareNextStepInput,
): PrepareNextStepResult => {
  const missing: Array<"date" | "time" | "email"> = [];

  if (
    input.type === "BOOK_MEETING" ||
    input.type === "CALLBACK_REQUESTED"
  ) {
    if (!input.date) missing.push("date");
    if (!input.time && !input.timeWindow) missing.push("time");
  }

  if (input.type === "SEND_INFORMATION" && !input.email) {
    missing.push("email");
  }

  if (missing.length > 0) {
    return {
      status: "needs_clarification",
      action: input.type,
      missing,
      externalActionPerformed: false,
    };
  }

  const data = Object.fromEntries(
    nextStepDataFields.flatMap((field) =>
      input[field] === undefined ? [] : [[field, input[field]]],
    ),
  );

  return {
    status: "prepared_only",
    action: input.type,
    data,
    externalActionPerformed: false,
  };
};
