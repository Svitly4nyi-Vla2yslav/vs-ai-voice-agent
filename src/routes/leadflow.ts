import { Router } from "express";
import { z } from "zod";

import { OUTBOUND_SALES_CONVERSATION_MODE } from "../agent/types.js";
import { transcriptSegmentSchema } from "../contracts/leadflow.js";
import { env, runtimeEnvironment } from "../config/env.js";
import { isSameOriginRequest } from "../http/same-origin.js";
import {
  getLeadFlowClient,
  safeHandoffFailureReason,
} from "../services/leadflow.js";
import {
  createLeadFlowSessionToken,
  readLeadFlowSessionToken,
  sanitizeCallBrief,
} from "../services/leadflow-session.js";
import { mirrorTranscriptToManagedMeeting } from "../tools/calendar.js";

export const leadFlowRouter = Router();

// Приймає лише одноразовий handoff-токен і відхиляє зайві поля запиту.
const handoffRequestSchema = z
  .object({ handoffToken: z.string().trim().min(1).max(8_192) })
  .strict();

/**
 * Перевіряє контрольну точку транскрипту: FINAL потребує endedAt,
 * а сукупний текст обмежено 250 000 символами незалежно від кількості сегментів.
 */
const transcriptCheckpointRequestSchema = z
  .object({
    leadFlowSession: z.string().trim().min(1).max(65_536),
    revision: z.number().int().positive(),
    state: z.enum(["PARTIAL", "FINAL"]),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }).optional(),
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

// Повертає без кешування лише стан конфігурації інтеграції та середовище виконання.
leadFlowRouter.get("/api/leadflow/status", (_request, response) => {
  response.set("Cache-Control", "no-store");
  const configuration = getLeadFlowClient().configurationStatus();
  response.status(200).json({
    ...configuration,
    manualFallbackEnabled: env.LEADFLOW_ALLOW_MANUAL_LEAD_ID,
    environment: runtimeEnvironment(),
  });
});

// Запускає діагностику провайдера тільки для запиту з дозволеного origin.
leadFlowRouter.get("/api/leadflow/diagnostic", async (request, response) => {
  response.set("Cache-Control", "no-store");
  if (!isSameOriginRequest(request)) {
    response.status(403).json({ error: "Unexpected request origin" });
    return;
  }
  response.status(200).json(await getLeadFlowClient().diagnose());
});

/**
 * Обмінює handoff-токен на короткоживучу зашифровану сесію.
 * У відповідь повертає лише безпечний контекст дзвінка, а причини відмови нормалізує перед логуванням.
 */
leadFlowRouter.post("/api/leadflow/handoff", async (request, response) => {
  response.set("Cache-Control", "no-store");
  if (!isSameOriginRequest(request)) {
    response.status(403).json({ error: "Unexpected request origin" });
    return;
  }
  const parsed = handoffRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "LeadFlow connection failed",
      reason: "handoff_invalid",
    });
    return;
  }

  const result = await getLeadFlowClient().resolveHandoff(
    parsed.data.handoffToken,
  );
  if (
    !result.ok ||
    !env.LEADFLOW_INTEGRATION_TOKEN ||
    !("callTask" in result.data)
  ) {
    const safeReason = safeHandoffFailureReason(result.ok
      ? env.LEADFLOW_INTEGRATION_TOKEN
        ? "task_context_missing"
        : "configuration_missing"
      : result.error);
    console.info("[LeadFlow] handoff resolution failed", {
      reason: safeReason,
    });
    response.status(401).json({
      error: "LeadFlow connection failed",
      reason: safeReason,
    });
    return;
  }

  const sessionToken = createLeadFlowSessionToken(
    {
      leadId: result.data.lead.id,
      callTaskId: result.data.callTask.id,
      company: result.data.lead.company,
      contactPerson: result.data.lead.contactPerson,
      callBrief: sanitizeCallBrief(result.data.callBrief),
    },
    env.LEADFLOW_INTEGRATION_TOKEN,
  );
  console.info("[LeadFlow] handoff resolved");
  response.status(200).json({
    ok: true,
    sessionToken,
    context: {
      conversationMode: OUTBOUND_SALES_CONVERSATION_MODE,
      company: result.data.lead.company,
      contactPerson: result.data.lead.contactPerson,
      callStatus: "Ready",
      callObjective: result.data.callBrief.callObjective.slice(0, 240),
    },
  });
});

/**
 * Автентифікує task-aware сесію й передає версіоновану контрольну точку транскрипту в LeadFlow.
 * Для фінального непорожнього транскрипту додатково запускає дзеркалювання в керовану зустріч календаря.
 */
leadFlowRouter.post("/api/leadflow/transcript", async (request, response) => {
  response.set("Cache-Control", "no-store");
  if (!isSameOriginRequest(request)) {
    response.status(403).json({ error: "Unexpected request origin" });
    return;
  }
  const parsed = transcriptCheckpointRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ status: "invalid_payload" });
    return;
  }
  if (!env.LEADFLOW_INTEGRATION_TOKEN) {
    response.status(503).json({ status: "provider_error" });
    return;
  }
  const session = readLeadFlowSessionToken(
    parsed.data.leadFlowSession,
    env.LEADFLOW_INTEGRATION_TOKEN,
  );
  if (!session || session.version !== 2) {
    response.status(401).json({ status: "authentication_failure" });
    return;
  }

  const { leadFlowSession: _sessionToken, ...checkpoint } = parsed.data;
  const persistence = await getLeadFlowClient().sendTranscript(
    {
      leadId: session.leadId,
      callTaskId: session.callTaskId,
      conversationId: session.conversationId,
    },
    checkpoint,
  );
  const characterCount = checkpoint.segments.reduce(
    (total, segment) => total + segment.delta.length,
    0,
  );
  if (!persistence.ok) {
    console.warn("[Transcript] checkpoint failed", {
      revision: checkpoint.revision,
      state: checkpoint.state,
      segmentCount: checkpoint.segments.length,
      characterCount,
      status: persistence.error,
    });
    response.status(502).json({
      status: persistence.error === "timeout"
        ? "leadflow_unavailable"
        : persistence.error === "configuration_missing"
          ? "provider_error"
          : persistence.error,
    });
    return;
  }

  let calendarMirrorStatus = "not_requested";
  if (checkpoint.state === "FINAL" && checkpoint.segments.length > 0) {
    const mirror = await mirrorTranscriptToManagedMeeting(
      {
        callTaskId: session.callTaskId,
        conversationId: session.conversationId,
      },
      checkpoint.segments,
    );
    calendarMirrorStatus = mirror.status;
  }
  console.info("[Transcript] checkpoint persisted", {
    revision: checkpoint.revision,
    state: checkpoint.state,
    segmentCount: checkpoint.segments.length,
    characterCount,
    duplicate: persistence.duplicate,
    calendarMirrorStatus,
  });
  response.status(202).json({
    status: persistence.duplicate ? "duplicate_accepted" : "persisted",
    calendarMirrorStatus,
  });
});
