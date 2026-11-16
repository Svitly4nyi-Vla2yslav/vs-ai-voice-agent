import { syncLeadFlowInteractionInputSchema, type SyncLeadFlowInteractionInput } from "../contracts/leadflow.js";
import {
  getLeadFlowClient,
  type LeadFlowClient,
  type LeadFlowErrorCode,
} from "../services/leadflow.js";

export { syncLeadFlowInteractionInputSchema };
export type { SyncLeadFlowInteractionInput };

export type SyncLeadFlowInteractionResult =
  | {
      status: "synced" | "duplicate_accepted";
      externalActionPerformed: true;
    }
  | {
      status: "leadflow_error";
      reason: LeadFlowErrorCode;
      externalActionPerformed: false;
    };

/**
 * Синхронізує валідовану взаємодію з указаним leadId через переданий або стандартний LeadFlow-клієнт.
 * @param input — уже перевірені дані взаємодії.
 * @param leadId — ідентифікатор ліда; без нього мережевий виклик не виконується.
 * @param client — мінімальний LeadFlow-клієнт, який можна підмінити в тестах.
 * @returns Явний статус і ознаку зовнішньої дії; duplicate також вважається прийнятим записом.
 * @sideEffects Може виконати зовнішній запит і журналює лише результат без payload.
 */
export const syncLeadFlowInteraction = async (
  input: SyncLeadFlowInteractionInput,
  leadId: string | undefined,
  client: Pick<LeadFlowClient, "send"> = getLeadFlowClient(),
): Promise<SyncLeadFlowInteractionResult> => {
  if (!leadId) {
    return {
      status: "leadflow_error",
      reason: "invalid_payload",
      externalActionPerformed: false,
    };
  }
  const result = await client.send(leadId, input);
  if (!result.ok) {
    console.info("[LeadFlow] sync failed", { reason: result.error });
    return {
      status: "leadflow_error",
      reason: result.error,
      externalActionPerformed: false,
    };
  }
  console.info("[LeadFlow] sync completed", {
    duplicate: result.data.duplicate,
  });
  return {
    status: result.data.duplicate ? "duplicate_accepted" : "synced",
    externalActionPerformed: true,
  };
};
