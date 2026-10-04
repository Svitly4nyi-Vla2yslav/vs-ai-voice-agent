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

// Синхронізує валідовану взаємодію з указаним leadId через переданий або стандартний LeadFlow-клієнт.
// Повертає явний статус і ознаку зовнішньої дії; без leadId чи після помилки віддалений успіх не декларується.
// Успішний і повторно прийнятий запити вважаються виконаною зовнішньою дією, а результат журналюється без payload.
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
