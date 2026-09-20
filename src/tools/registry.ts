import type { FunctionTool } from "openai/resources/live/live";

import {
  bookMeeting,
  bookMeetingInputSchema,
  getCalendarAvailability,
  getCalendarAvailabilityInputSchema,
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
      phone: nullableString,
      reason: nullableString,
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
      "phone",
      "reason",
      "notes",
      "confirmation",
      "idempotencyKey",
    ],
  },
} satisfies FunctionTool;

export const agentTools = [
  prepareNextStepToolDefinition,
  getCalendarAvailabilityToolDefinition,
  bookMeetingToolDefinition,
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
    } else {
      const parsed = bookMeetingInputSchema.safeParse(argumentsValue);
      if (!parsed.success) return failure("invalid_arguments");
      console.info("[Agent Tool] validated", { tool: name });
      result = await bookMeeting(parsed.data);
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
