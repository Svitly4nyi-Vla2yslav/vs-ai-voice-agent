export const nextStepActions = [
  "BOOK_MEETING",
  "CALLBACK_REQUESTED",
  "SEND_INFORMATION",
  "HUMAN_HANDOFF",
] as const;

export type NextStepAction = (typeof nextStepActions)[number];

export const nextStepDataFields = [
  "contactName",
  "companyName",
  "date",
  "time",
  "timeWindow",
  "email",
  "phone",
  "reason",
  "notes",
] as const;

export type NextStepDataField = (typeof nextStepDataFields)[number];

export type PreparedNextStepData = Partial<
  Record<NextStepDataField, string>
>;

export type PrepareNextStepResult =
  | {
      status: "prepared_only";
      action: NextStepAction;
      data: PreparedNextStepData;
      externalActionPerformed: false;
    }
  | {
      status: "needs_clarification";
      action: NextStepAction;
      missing: Array<"date" | "time" | "email">;
      externalActionPerformed: false;
    };

export type ToolFailureResult = {
  status: "tool_error";
  error: "unknown_tool" | "invalid_arguments" | "execution_failed";
  externalActionPerformed: false;
};

export type AgentToolResult =
  | PrepareNextStepResult
  | AvailabilityResult
  | NextAvailableMeetingSlotsResult
  | BookingResult
  | FindEmmaMeetingsResult
  | RescheduleMeetingResult
  | CancelMeetingResult
  | UpdateMeetingDetailsResult
  | SyncLeadFlowInteractionResult
  | ToolFailureResult;
import type {
  AvailabilityResult,
  BookingResult,
  CancelMeetingResult,
  FindEmmaMeetingsResult,
  NextAvailableMeetingSlotsResult,
  RescheduleMeetingResult,
  UpdateMeetingDetailsResult,
} from "../services/google-calendar.js";
import type { SyncLeadFlowInteractionResult } from "./leadflow.js";
