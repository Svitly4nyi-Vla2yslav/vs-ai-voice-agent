import type { FunctionTool } from "openai/resources/live/live";

import {
  bookMeeting,
  bookMeetingInputSchema,
  cancelMeeting,
  cancelMeetingInputSchema,
  findEmmaMeetings,
  findEmmaMeetingsInputSchema,
  getCalendarAvailability,
  getCalendarAvailabilityInputSchema,
  rescheduleMeeting,
  rescheduleMeetingInputSchema,
  updateMeetingDetails,
  updateMeetingDetailsInputSchema,
} from "./calendar.js";
import {
  prepareNextStep,
  prepareNextStepInputSchema,
} from "./prepare-next-step.js";
import type { AgentToolResult } from "./types.js";

const nullableString = { type: ["string", "null"] } as const;

export const prepareNextStepToolDefinition = {
  type: "function",
  name: "prepareNextStep",
  description:
    "Validate and normalize a callback, information request, human handoff, or an initial meeting request. This tool never performs an external action. For real meeting availability and booking, use the Calendar tools.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      type: {
        type: "string",
        enum: [
          "BOOK_MEETING",
          "CALLBACK_REQUESTED",
          "SEND_INFORMATION",
          "HUMAN_HANDOFF",
        ],
      },
      contactName: nullableString,
      companyName: nullableString,
      date: {
        type: ["string", "null"],
        description: "Unambiguous calendar date in YYYY-MM-DD format.",
      },
      time: {
        type: ["string", "null"],
        description: "Unambiguous local time in 24-hour HH:MM format.",
      },
      timeWindow: nullableString,
      email: nullableString,
      phone: nullableString,
      reason: nullableString,
      notes: nullableString,
    },
    required: [
      "type",
      "contactName",
      "companyName",
      "date",
      "time",
      "timeWindow",
      "email",
      "phone",
      "reason",
      "notes",
    ],
  },
} satisfies FunctionTool;

export const getCalendarAvailabilityToolDefinition = {
  type: "function",
  name: "getCalendarAvailability",
  description:
    "Check the private VS Web Studio Google Calendar for free/busy availability. Returns only requested slots and a maximum of three free alternatives; never returns private event contents.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      date: {
        type: "string",
        description: "A fully resolved date in YYYY-MM-DD format.",
      },
      startTime: {
        type: ["string", "null"],
        description: "Exact local start time in 24-hour HH:MM format.",
      },
      endTime: {
        type: ["string", "null"],
        description: "Optional exact local end time in 24-hour HH:MM format.",
      },
      timeWindow: {
        type: ["string", "null"],
        enum: ["morning", "afternoon", "evening", null],
      },
      durationMinutes: {
        type: ["integer", "null"],
        minimum: 15,
        maximum: 120,
        description: "Meeting duration; use 30 when the customer gave none.",
      },
      timezone: { type: "string", enum: ["Europe/Berlin"] },
    },
    required: [
      "date",
      "startTime",
      "endTime",
      "timeWindow",
      "durationMinutes",
      "timezone",
    ],
  },
} satisfies FunctionTool;

export const bookMeetingToolDefinition = {
  type: "function",
  name: "bookMeeting",
  description:
    "Create a real VS Web Studio Google Calendar meeting only after the customer explicitly confirmed the exact available slot. The confirmation argument must reflect an explicit confirmation, never an inference.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      contactName: nullableString,
      companyName: nullableString,
      start: {
        type: "string",
        description:
          "Confirmed RFC3339 start including the correct Europe/Berlin UTC offset.",
      },
      end: {
        type: "string",
        description:
          "Confirmed RFC3339 end including the correct Europe/Berlin UTC offset.",
      },
      timezone: { type: "string", enum: ["Europe/Berlin"] },
      customerEmail: nullableString,
      meetingMode: {
        type: "string",
        enum: ["GOOGLE_MEET", "PHONE", "IN_PERSON"],
        description: "Confirmed synchronous meeting mode. Email is not a meeting mode.",
      },
      phone: nullableString,
      useCurrentCallNumber: {
        type: ["boolean", "null"],
        description: "Use only when a verified telephony context supplies the current caller number; false/null in the browser MVP.",
      },
      location: nullableString,
      reason: nullableString,
      currentSituation: nullableString,
      desiredOutcome: nullableString,
      notes: nullableString,
      confirmation: {
        type: "boolean",
        description:
          "True only after the customer explicitly confirmed this exact slot.",
      },
      idempotencyKey: {
        type: "string",
        description:
          "Stable correlation key for this booking intent. Reuse it for every retry of the same confirmed slot.",
      },
    },
    required: [
      "contactName",
      "companyName",
      "start",
      "end",
      "timezone",
      "customerEmail",
      "meetingMode",
      "phone",
      "useCurrentCallNumber",
      "location",
      "reason",
      "currentSituation",
      "desiredOutcome",
      "notes",
      "confirmation",
      "idempotencyKey",
    ],
  },
} satisfies FunctionTool;

export const findEmmaMeetingsToolDefinition = {
  type: "function",
  name: "findEmmaMeetings",
  description:
    "Find up to three sanitized candidate meetings created by Emma in a bounded date window. Use this before any reschedule or cancellation and clarify when multiple meetings are returned.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      dateFrom: { type: ["string", "null"], description: "Optional YYYY-MM-DD lower bound." },
      dateTo: { type: ["string", "null"], description: "Optional YYYY-MM-DD upper bound." },
      contactName: nullableString,
      companyName: nullableString,
      approximateDate: { type: ["string", "null"], description: "Optional approximate YYYY-MM-DD date." },
    },
    required: ["dateFrom", "dateTo", "contactName", "companyName", "approximateDate"],
  },
} satisfies FunctionTool;

export const rescheduleMeetingToolDefinition = {
  type: "function",
  name: "rescheduleMeeting",
  description:
    "Move one selected Emma-managed meeting after its new time was checked and the customer explicitly confirmed the exact change. Re-checks availability server-side before updating.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      meetingRef: { type: "string", description: "Opaque reference returned by findEmmaMeetings." },
      newStart: { type: "string", description: "Confirmed RFC3339 start with Europe/Berlin offset." },
      newEnd: { type: "string", description: "Confirmed RFC3339 end with Europe/Berlin offset." },
      timezone: { type: "string", enum: ["Europe/Berlin"] },
      confirmation: { type: "boolean", enum: [true], description: "Must be true only after explicit final confirmation." },
      idempotencyKey: { type: "string", description: "Stable key reused for retries of this exact change." },
    },
    required: ["meetingRef", "newStart", "newEnd", "timezone", "confirmation", "idempotencyKey"],
  },
} satisfies FunctionTool;

export const cancelMeetingToolDefinition = {
  type: "function",
  name: "cancelMeeting",
  description:
    "Cancel one selected Emma-managed meeting only after the customer explicitly confirms cancellation.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      meetingRef: { type: "string", description: "Opaque reference returned by findEmmaMeetings." },
      confirmation: { type: "boolean", enum: [true], description: "Must be true only after explicit final confirmation." },
      idempotencyKey: { type: "string", description: "Stable correlation key for the cancellation request." },
    },
    required: ["meetingRef", "confirmation", "idempotencyKey"],
  },
} satisfies FunctionTool;

export const updateMeetingDetailsToolDefinition = {
  type: "function",
  name: "updateMeetingDetails",
  description:
    "Add or change contextual details or meeting mode on one selected Emma-managed meeting without changing its start or end time.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      meetingRef: { type: "string", description: "Opaque reference returned by findEmmaMeetings." },
      contactName: nullableString,
      companyName: nullableString,
      meetingMode: {
        type: ["string", "null"],
        enum: ["GOOGLE_MEET", "PHONE", "IN_PERSON", null],
      },
      phone: nullableString,
      location: nullableString,
      reason: nullableString,
      currentSituation: nullableString,
      desiredOutcome: nullableString,
      notes: nullableString,
    },
    required: [
      "meetingRef",
      "contactName",
      "companyName",
      "meetingMode",
      "phone",
      "location",
      "reason",
      "currentSituation",
      "desiredOutcome",
      "notes",
    ],
  },
} satisfies FunctionTool;

export const agentTools = [
  prepareNextStepToolDefinition,
  getCalendarAvailabilityToolDefinition,
  bookMeetingToolDefinition,
  findEmmaMeetingsToolDefinition,
  rescheduleMeetingToolDefinition,
  cancelMeetingToolDefinition,
  updateMeetingDetailsToolDefinition,
] satisfies FunctionTool[];

const registeredToolNames = new Set(agentTools.map((tool) => tool.name));

const parseArguments = (rawArguments: unknown): unknown => {
  if (typeof rawArguments !== "string") return rawArguments;
  return JSON.parse(rawArguments);
};

const failure = (
  error: "unknown_tool" | "invalid_arguments" | "execution_failed",
): AgentToolResult => ({
  status: "tool_error",
  error,
  externalActionPerformed: false,
});

export const executeAgentTool = async (
  name: string,
  rawArguments: unknown,
): Promise<AgentToolResult> => {
  const safeToolName = registeredToolNames.has(name) ? name : "unknown";
  console.info("[Agent Tool] requested", { tool: safeToolName });

  if (!registeredToolNames.has(name)) {
    console.warn("[Agent Tool] rejected", {
      tool: safeToolName,
      status: "unknown_tool",
    });
    return failure("unknown_tool");
  }

  let argumentsValue: unknown;
  try {
    argumentsValue = parseArguments(rawArguments);
  } catch {
    console.warn("[Agent Tool] rejected", {
      tool: safeToolName,
      status: "invalid_arguments",
    });
    return failure("invalid_arguments");
  }

  try {
    let result: AgentToolResult;
    if (name === "prepareNextStep") {
      const parsed = prepareNextStepInputSchema.safeParse(argumentsValue);
      if (!parsed.success) return failure("invalid_arguments");
      console.info("[Agent Tool] validated", {
        tool: name,
        action: parsed.data.type,
      });
      result = prepareNextStep(parsed.data);
    } else if (name === "getCalendarAvailability") {
      const parsed = getCalendarAvailabilityInputSchema.safeParse(argumentsValue);
      if (!parsed.success) return failure("invalid_arguments");
      console.info("[Agent Tool] validated", { tool: name });
      result = await getCalendarAvailability(parsed.data);
    } else if (name === "bookMeeting") {
      const parsed = bookMeetingInputSchema.safeParse(argumentsValue);
      if (!parsed.success) return failure("invalid_arguments");
      console.info("[Agent Tool] validated", { tool: name });
      result = await bookMeeting(parsed.data);
    } else if (name === "findEmmaMeetings") {
      const parsed = findEmmaMeetingsInputSchema.safeParse(argumentsValue);
      if (!parsed.success) return failure("invalid_arguments");
      console.info("[Agent Tool] validated", { tool: name });
      result = await findEmmaMeetings(parsed.data);
    } else if (name === "rescheduleMeeting") {
      const parsed = rescheduleMeetingInputSchema.safeParse(argumentsValue);
      if (!parsed.success) return failure("invalid_arguments");
      console.info("[Agent Tool] validated", { tool: name });
      result = await rescheduleMeeting(parsed.data);
    } else if (name === "cancelMeeting") {
      const parsed = cancelMeetingInputSchema.safeParse(argumentsValue);
      if (!parsed.success) return failure("invalid_arguments");
      console.info("[Agent Tool] validated", { tool: name });
      result = await cancelMeeting(parsed.data);
    } else {
      const parsed = updateMeetingDetailsInputSchema.safeParse(argumentsValue);
      if (!parsed.success) return failure("invalid_arguments");
      console.info("[Agent Tool] validated", { tool: name });
      result = await updateMeetingDetails(parsed.data);
    }

    console.info("[Agent Tool] completed", {
      tool: safeToolName,
      status: result.status,
    });
    return result;
  } catch {
    console.error("[Agent Tool] failed", {
      tool: safeToolName,
      status: "execution_failed",
    });
    return failure("execution_failed");
  }
};
