/** Допустимі бізнес-дії, які агент може лише підготувати або уточнити. */
export const nextStepActions = [
  "BOOK_MEETING",
  "CALLBACK_REQUESTED",
  "SEND_INFORMATION",
  "HUMAN_HANDOFF",
] as const;

export type NextStepAction = (typeof nextStepActions)[number];

/** Поля, які дозволено переносити з перевіреного вводу до підготовленого наступного кроку. */
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

/** Частковий нормалізований payload без довільних додаткових ключів. */
export type PreparedNextStepData = Partial<
  Record<NextStepDataField, string>
>;

/**
 * Результат підготовки дії: готовий локальний payload або явний перелік даних для уточнення.
 * externalActionPerformed завжди false, бо цей етап нічого не надсилає і не бронює.
 */
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

/** Контрольована помилка диспетчера без твердження про виконану зовнішню дію. */
export type ToolFailureResult = {
  status: "tool_error";
  error: "unknown_tool" | "invalid_arguments" | "execution_failed";
  externalActionPerformed: false;
};

/** Об'єднання всіх результатів, які може повернути реєстр інструментів агента. */
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
