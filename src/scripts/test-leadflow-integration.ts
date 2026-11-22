import { LeadFlowClient } from "../services/leadflow.js";

// Скрипт виконує реальний тестовий запис у LeadFlow, тому потребує одночасно явного lead id
// і прапорця --confirm-write; без обох значень завершується до створення клієнта чи HTTP-запиту.
const argumentsSet = new Set(process.argv.slice(2));
const leadArgument = process.argv.slice(2).find((value) => value.startsWith("--lead-id="));
const leadFlagIndex = process.argv.indexOf("--lead-id");
const leadId =
  leadArgument?.slice("--lead-id=".length).trim() ||
  (leadFlagIndex >= 0 ? process.argv[leadFlagIndex + 1]?.trim() : undefined);

if (!argumentsSet.has("--confirm-write") || !leadId) {
  console.error(
    "Refusing write. Use --lead-id=<LeadFlow ID> together with --confirm-write.",
  );
  process.exitCode = 1;
} else {
  // Нуль повторів робить один контрольований запит і не дублює запис через автоматичний transport retry.
  const result = await new LeadFlowClient({ maxTransportRetries: 0 }).send(leadId, {
    outcome: "CALL_COMPLETED",
    summary:
      "Lokaler Integrationstest: Kunde bestätigt Interesse an einer Beratung für eine neue Webseite.",
    nextAction: {
      type: "HUMAN_HANDOFF",
      confirmed: true,
      note: "Vladyslav soll den Kontakt prüfen.",
    },
  });

  if (!result.ok) {
    console.error("LeadFlow write failed", { reason: result.error });
    process.exitCode = 1;
  } else {
    console.log("LeadFlow write confirmed", {
      duplicate: result.data.duplicate,
      interactionId: result.data.interactionId,
      leadId: result.data.leadId,
    });
  }
}
