import { z } from "zod";

const isoTimestamp = z.string().datetime({ offset: true });
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Invalid calendar date");
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const nullToUndefined = (value: unknown): unknown =>
  value === null ? undefined : value;

export const leadFlowOutcomes = [
  "NO_ANSWER",
  "CALL_COMPLETED",
  "CALLBACK_REQUESTED",
  "MEETING_BOOKED",
  "SEND_INFORMATION_REQUESTED",
  "HUMAN_HANDOFF_REQUESTED",
  "NOT_INTERESTED",
  "DO_NOT_CONTACT",
] as const;

export const leadFlowLostReasons = [
  "kein Bedarf",
  "kein Budget",
  "keine Antwort nach Follow-ups",
  "eigene Agentur / interner Entwickler",
  "Konzern / keine lokale Entscheidungsbefugnis",
  "Geschäft nicht mehr aktiv",
  "falsche Zielgruppe",
  "sonstiger Grund",
] as const;

export const nextActionSchema = z
  .object({
    type: z.enum([
      "NONE",
      "CALLBACK",
      "FOLLOW_UP",
      "MEETING",
      "SEND_INFORMATION",
      "HUMAN_HANDOFF",
    ]),
    confirmed: z.boolean(),
    dueAt: z.preprocess(nullToUndefined, isoTimestamp.optional()),
    note: z.preprocess(nullToUndefined, boundedText(1_000).optional()),
  })
  .strict();

export const followUpSchema = z
  .object({
    requested: z.boolean(),
    confirmed: z.boolean(),
    date: z.preprocess(nullToUndefined, dateOnly.optional()),
    dueAt: z.preprocess(nullToUndefined, isoTimestamp.optional()),
    timeWindow: z.preprocess(nullToUndefined, boundedText(200).optional()),
    reason: z.preprocess(nullToUndefined, boundedText(1_000).optional()),
  })
  .strict();

export const leadFlowCalendarSchema = z
  .object({
    confirmed: z.boolean(),
    eventId: z.preprocess(nullToUndefined, boundedText(500).optional()),
    start: z.preprocess(nullToUndefined, isoTimestamp.optional()),
    end: z.preprocess(nullToUndefined, isoTimestamp.optional()),
    meetingMode: z.preprocess(
      nullToUndefined,
      z.enum(["GOOGLE_MEET", "PHONE", "IN_PERSON"]).optional(),
    ),
  })
  .strict();

export const syncLeadFlowInteractionInputSchema = z
  .object({
    outcome: z.enum(leadFlowOutcomes),
    summary: boundedText(2_000),
    nextAction: z.preprocess(nullToUndefined, nextActionSchema.optional()),
    followUp: z.preprocess(nullToUndefined, followUpSchema.optional()),
    calendar: z.preprocess(nullToUndefined, leadFlowCalendarSchema.optional()),
    lostReason: z.preprocess(
      nullToUndefined,
      z.enum(leadFlowLostReasons).optional(),
    ),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.calendar?.confirmed &&
      (!value.calendar.eventId || !value.calendar.start || !value.calendar.end)
    ) {
      context.addIssue({
        code: "custom",
        path: ["calendar"],
        message: "Confirmed calendar requires eventId, start and end",
      });
    }
    if (
      value.calendar?.start &&
      value.calendar.end &&
      Date.parse(value.calendar.end) <= Date.parse(value.calendar.start)
    ) {
      context.addIssue({
        code: "custom",
        path: ["calendar", "end"],
        message: "Calendar end must be after start",
      });
    }
    if (value.outcome === "MEETING_BOOKED" && value.calendar?.confirmed !== true) {
      context.addIssue({
        code: "custom",
        path: ["calendar"],
        message: "MEETING_BOOKED requires confirmed calendar data",
      });
    }
    if (value.calendar?.confirmed && value.outcome !== "MEETING_BOOKED") {
      context.addIssue({
        code: "custom",
        path: ["calendar"],
        message: "Confirmed calendar is only valid for MEETING_BOOKED",
      });
    }
    if (
      value.followUp?.confirmed &&
      (!value.followUp.requested || (!value.followUp.date && !value.followUp.dueAt))
    ) {
      context.addIssue({
        code: "custom",
        path: ["followUp"],
        message: "Confirmed follow-up requires requested=true and date or dueAt",
      });
    }
    if (
      value.lostReason &&
      value.outcome !== "NOT_INTERESTED" &&
      value.outcome !== "DO_NOT_CONTACT"
    ) {
      context.addIssue({
        code: "custom",
        path: ["lostReason"],
        message: "lostReason is only valid for a confirmed negative outcome",
      });
    }
  });

export type SyncLeadFlowInteractionInput = z.infer<
  typeof syncLeadFlowInteractionInputSchema
>;

export const voiceAgentInteractionV1Schema = z
  .object({
    contractVersion: z.literal("1.0"),
    eventId: z.string().uuid(),
    source: z.literal("vs-ai-voice-agent"),
    leadRef: z.object({ leadId: boundedText(200) }).strict(),
    occurredAt: isoTimestamp,
    interaction: z
      .object({
        channel: z.literal("phone/cold call"),
        direction: z.literal("out"),
        summary: boundedText(2_000),
        outcome: z.enum(leadFlowOutcomes),
      })
      .strict(),
    nextAction: nextActionSchema.optional(),
    followUp: followUpSchema.optional(),
    calendar: leadFlowCalendarSchema.optional(),
    lostReason: z.enum(leadFlowLostReasons).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.calendar?.confirmed &&
      (!value.calendar.eventId || !value.calendar.start || !value.calendar.end)
    ) {
      context.addIssue({
        code: "custom",
        path: ["calendar"],
        message: "Confirmed calendar requires eventId, start and end",
      });
    }
    if (
      value.calendar?.start &&
      value.calendar.end &&
      Date.parse(value.calendar.end) <= Date.parse(value.calendar.start)
    ) {
      context.addIssue({
        code: "custom",
        path: ["calendar", "end"],
        message: "Calendar end must be after start",
      });
    }
    if (
      value.interaction.outcome === "MEETING_BOOKED" &&
      value.calendar?.confirmed !== true
    ) {
      context.addIssue({
        code: "custom",
        path: ["calendar"],
        message: "MEETING_BOOKED requires confirmed calendar data",
      });
    }
    if (
      value.calendar?.confirmed &&
      value.interaction.outcome !== "MEETING_BOOKED"
    ) {
      context.addIssue({
        code: "custom",
        path: ["calendar"],
        message: "Confirmed calendar is only valid for MEETING_BOOKED",
      });
    }
    if (
      value.followUp?.confirmed &&
      (!value.followUp.requested || (!value.followUp.date && !value.followUp.dueAt))
    ) {
      context.addIssue({
        code: "custom",
        path: ["followUp"],
        message: "Confirmed follow-up requires requested=true and date or dueAt",
      });
    }
    if (
      value.lostReason &&
      value.interaction.outcome !== "NOT_INTERESTED" &&
      value.interaction.outcome !== "DO_NOT_CONTACT"
    ) {
      context.addIssue({
        code: "custom",
        path: ["lostReason"],
        message: "lostReason is only valid for a confirmed negative outcome",
      });
    }
  });

export type VoiceAgentInteractionV1 = z.infer<typeof voiceAgentInteractionV1Schema>;

export const leadFlowSuccessResponseSchema = z
  .object({
    ok: z.literal(true),
    duplicate: z.boolean(),
    interactionId: z.string().min(1),
    leadId: z.string().min(1),
    crmStatusBefore: z.string().min(1),
    crmStatusAfter: z.string().min(1),
    appliedChanges: z.array(z.string()),
  })
  .strict();

export type LeadFlowSuccessResponse = z.infer<typeof leadFlowSuccessResponseSchema>;
