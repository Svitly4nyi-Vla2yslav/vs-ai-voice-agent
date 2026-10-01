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

export const transcriptSpeakerSchema = z.enum(["CUSTOMER", "EMMA"]);

export const transcriptSegmentSchema = z
  .object({
    speaker: transcriptSpeakerSchema,
    delta: z.string().min(1).max(4_000),
    startMs: z.number().int().nonnegative().optional(),
    endMs: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.startMs !== undefined &&
      value.endMs !== undefined &&
      value.endMs < value.startMs
    ) {
      context.addIssue({
        code: "custom",
        path: ["endMs"],
        message: "Transcript segment end must not precede its start",
      });
    }
  });

export const voiceAgentTranscriptCheckpointInputSchema = z
  .object({
    revision: z.number().int().positive(),
    state: z.enum(["PARTIAL", "FINAL"]),
    startedAt: isoTimestamp,
    endedAt: isoTimestamp.optional(),
    segments: z.array(transcriptSegmentSchema).max(2_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === "FINAL" && !value.endedAt) {
      context.addIssue({
        code: "custom",
        path: ["endedAt"],
        message: "FINAL transcript requires endedAt",
      });
    }
    const characters = value.segments.reduce(
      (total, segment) => total + segment.delta.length,
      0,
    );
    if (characters > 250_000) {
      context.addIssue({
        code: "custom",
        path: ["segments"],
        message: "Transcript exceeds the validated text limit",
      });
    }
  });

export type VoiceAgentTranscriptCheckpointInput = z.infer<
  typeof voiceAgentTranscriptCheckpointInputSchema
>;

export const leadFlowTranscriptSegmentSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    speaker: transcriptSpeakerSchema,
    text: z.string().min(1).max(4_000),
    startMs: z.number().int().nonnegative().optional(),
    endMs: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.startMs !== undefined &&
      value.endMs !== undefined &&
      value.endMs < value.startMs
    ) {
      context.addIssue({
        code: "custom",
        path: ["endMs"],
        message: "Transcript segment end must not precede its start",
      });
    }
  });

export const voiceAgentTranscriptV1Schema = z
  .object({
    contractVersion: z.literal("1.0"),
    eventId: z.string().uuid(),
    leadRef: z.object({ leadId: boundedText(200) }).strict(),
    callTaskRef: z.object({ callTaskId: boundedText(200) }).strict(),
    conversationId: z.string().uuid(),
    revision: z.number().int().positive(),
    state: z.enum(["PARTIAL", "FINAL"]),
    startedAt: isoTimestamp,
    endedAt: isoTimestamp.optional(),
    segments: z.array(leadFlowTranscriptSegmentSchema).max(2_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === "FINAL" && !value.endedAt) {
      context.addIssue({
        code: "custom",
        path: ["endedAt"],
        message: "FINAL transcript requires endedAt",
      });
    }
    const characters = value.segments.reduce(
      (total, segment) => total + segment.text.length,
      0,
    );
    if (characters > 250_000) {
      context.addIssue({
        code: "custom",
        path: ["segments"],
        message: "Transcript exceeds the validated text limit",
      });
    }
    for (let index = 0; index < value.segments.length; index += 1) {
      if (value.segments[index]?.sequence !== index) {
        context.addIssue({
          code: "custom",
          path: ["segments", index, "sequence"],
          message: "Transcript sequence must be contiguous and zero-based",
        });
      }
    }
  });

export type VoiceAgentTranscriptV1 = z.infer<
  typeof voiceAgentTranscriptV1Schema
>;

export const leadFlowTranscriptSuccessResponseSchema = z
  .object({
    ok: z.literal(true),
    duplicate: z.boolean().optional(),
  })
  .passthrough();

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

const optionalContactText = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .nullable()
  .optional()
  .transform((value) => value ?? null);

const optionalContactEmail = z
  .string()
  .trim()
  .email()
  .max(254)
  .nullable()
  .optional()
  .transform((value) => value ?? null);

export const leadFlowLeadSchema = z
  .object({
    id: boundedText(200),
    company: boundedText(500),
    contactPerson: optionalContactText,
    phone: optionalContactText,
    email: optionalContactEmail,
    crmStatus: z.enum([
      "NEW",
      "AUDITED",
      "CONTACTED",
      "REPLY",
      "CALL",
      "OFFER",
      "FOLLOW-UP",
      "WON",
      "LOST",
    ]),
  })
  .strict();

const optionalBriefText = (maximum = 2_000) =>
  z.string().trim().min(1).max(maximum).optional();

export const leadFlowCallBriefSchema = z
  .object({
    leadId: boundedText(200),
    company: boundedText(500),
    contactPerson: optionalBriefText(500),
    phone: optionalBriefText(500),
    email: z.string().trim().email().max(254).optional(),
    website: optionalBriefText(2_000),
    branche: optionalBriefText(500),
    ort: optionalBriefText(500),
    preferredLanguage: z.enum(["de", "uk", "ru", "en"]).optional(),
    decisionMaker: optionalBriefText(),
    currentSituation: optionalBriefText(),
    painPoints: optionalBriefText(),
    auditProblem: optionalBriefText(),
    proposedSolution: optionalBriefText(),
    emmaFocus: optionalBriefText(),
    doNotMention: optionalBriefText(),
    callObjective: boundedText(2_000),
    offerFocus: optionalBriefText(),
    operatorNote: optionalBriefText(5_000),
  })
  .strict();

export const leadFlowLegacyHandoffResponseSchema = z
  .object({
    ok: z.literal(true),
    lead: leadFlowLeadSchema,
  })
  .strict();

export const leadFlowTaskAwareHandoffResponseSchema = z
  .object({
    ok: z.literal(true),
    lead: leadFlowLeadSchema,
    callTask: z
      .object({
        id: boundedText(200),
        status: z.literal("READY"),
        scheduledAt: z.preprocess(nullToUndefined, isoTimestamp.optional()),
      })
      .strict(),
    callBrief: leadFlowCallBriefSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.callBrief.leadId !== value.lead.id) {
      context.addIssue({
        code: "custom",
        path: ["callBrief", "leadId"],
        message: "Call Brief lead must match canonical lead",
      });
    }
    if (value.callBrief.company !== value.lead.company) {
      context.addIssue({
        code: "custom",
        path: ["callBrief", "company"],
        message: "Call Brief company must match canonical lead",
      });
    }
    if (
      value.callBrief.contactPerson !== undefined &&
      value.callBrief.contactPerson !== value.lead.contactPerson
    ) {
      context.addIssue({
        code: "custom",
        path: ["callBrief", "contactPerson"],
        message: "Call Brief contact must match canonical lead",
      });
    }
  });

export const leadFlowHandoffResponseSchema = z.union([
  leadFlowTaskAwareHandoffResponseSchema,
  leadFlowLegacyHandoffResponseSchema,
]);

export type LeadFlowCallBrief = z.infer<typeof leadFlowCallBriefSchema>;
export type LeadFlowTaskAwareHandoffResponse = z.infer<
  typeof leadFlowTaskAwareHandoffResponseSchema
>;
export type LeadFlowLegacyHandoffResponse = z.infer<
  typeof leadFlowLegacyHandoffResponseSchema
>;

export type LeadFlowHandoffResponse = z.infer<
  typeof leadFlowHandoffResponseSchema
>;
