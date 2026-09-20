import type { FunctionTool } from "openai/resources/live/live";

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
    "Validate and normalize a requested meeting, callback, information request, or human handoff. This only prepares the next step and never performs an external action. Ask for critical missing details instead of guessing them.",
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

const registeredTools = {
  prepareNextStep: {
    schema: prepareNextStepInputSchema,
    execute: prepareNextStep,
  },
} as const;

export const agentTools = [prepareNextStepToolDefinition] satisfies FunctionTool[];

export const executeAgentTool = (
  name: string,
  rawArguments: unknown,
): AgentToolResult => {
  const safeToolName = name === "prepareNextStep" ? name : "unknown";
  console.info("[Agent Tool] requested", { tool: safeToolName });

  if (name !== "prepareNextStep") {
    console.warn("[Agent Tool] rejected", {
      tool: safeToolName,
      status: "unknown_tool",
    });
    return {
      status: "tool_error",
      error: "unknown_tool",
      externalActionPerformed: false,
    };
  }

  let argumentsValue = rawArguments;
  if (typeof rawArguments === "string") {
    try {
      argumentsValue = JSON.parse(rawArguments);
    } catch {
      console.warn("[Agent Tool] rejected", {
        tool: name,
        status: "invalid_arguments",
      });
      return {
        status: "tool_error",
        error: "invalid_arguments",
        externalActionPerformed: false,
      };
    }
  }

  const parsedArguments = registeredTools.prepareNextStep.schema.safeParse(
    argumentsValue,
  );
  if (!parsedArguments.success) {
    console.warn("[Agent Tool] rejected", {
      tool: name,
      status: "invalid_arguments",
    });
    return {
      status: "tool_error",
      error: "invalid_arguments",
      externalActionPerformed: false,
    };
  }

  console.info("[Agent Tool] validated", {
    tool: name,
    action: parsedArguments.data.type,
  });

  try {
    const result = registeredTools.prepareNextStep.execute(parsedArguments.data);
    const activity =
      result.status === "needs_clarification"
        ? "clarification required"
        : "completed";
    console.info(`[Agent Tool] ${activity}`, {
      tool: name,
      status: result.status,
      action: result.action,
    });
    return result;
  } catch {
    console.error("[Agent Tool] failed", {
      tool: name,
      status: "execution_failed",
      action: parsedArguments.data.type,
    });
    return {
      status: "tool_error",
      error: "execution_failed",
      externalActionPerformed: false,
    };
  }
};
