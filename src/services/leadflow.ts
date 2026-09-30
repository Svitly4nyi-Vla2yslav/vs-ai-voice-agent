import { randomUUID } from "node:crypto";

import {
  leadFlowHandoffResponseSchema,
  leadFlowSuccessResponseSchema,
  leadFlowTranscriptSuccessResponseSchema,
  voiceAgentInteractionV1Schema,
  voiceAgentTranscriptV1Schema,
  type LeadFlowHandoffResponse,
  type LeadFlowSuccessResponse,
  type SyncLeadFlowInteractionInput,
  type VoiceAgentInteractionV1,
  type VoiceAgentTranscriptCheckpointInput,
  type VoiceAgentTranscriptV1,
} from "../contracts/leadflow.js";
import { env } from "../config/env.js";

export type LeadFlowErrorCode =
  | "configuration_missing"
  | "authentication_failure"
  | "leadflow_unavailable"
  | "lead_not_found"
  | "invalid_payload"
  | "event_conflict"
  | "timeout"
  | "provider_error";

export type LeadFlowHandoffErrorCode =
  | "configuration_missing"
  | "authentication_failure"
  | "handoff_invalid"
  | "handoff_expired"
  | "lead_not_found"
  | "task_context_missing"
  | "leadflow_unavailable"
  | "timeout"
  | "provider_error";

export type SafeHandoffFailureReason = Exclude<
  LeadFlowHandoffErrorCode,
  "timeout"
> | "task_context_missing";

export const safeHandoffFailureReason = (
  reason: string,
): SafeHandoffFailureReason => {
  switch (reason) {
    case "configuration_missing":
    case "authentication_failure":
    case "handoff_invalid":
    case "handoff_expired":
    case "lead_not_found":
    case "task_context_missing":
    case "provider_error":
      return reason;
    case "leadflow_unavailable":
    case "timeout":
      return "leadflow_unavailable";
    default:
      return "provider_error";
  }
};

export type LeadFlowDiagnosticReason =
  | "configuration_missing"
  | "invalid_base_url"
  | "leadflow_unavailable"
  | "authentication_failure"
  | "integration_health_unavailable"
  | "provider_error"
  | "ok";

export type LeadFlowDiagnosticResult = {
  configured: boolean;
  reachable: boolean;
  authentication: "ok" | "failure" | "not_checked";
  reason: LeadFlowDiagnosticReason;
};

export type LeadFlowConfigurationStatus = {
  configured: boolean;
  baseUrlConfigured: boolean;
  integrationTokenConfigured: boolean;
  leadFlowOrigin?: string;
};

export type LeadFlowClientResult =
  | { ok: true; data: LeadFlowSuccessResponse; eventId: string }
  | { ok: false; error: LeadFlowErrorCode; eventId: string };

export type LeadFlowHandoffResult =
  | { ok: true; data: LeadFlowHandoffResponse }
  | { ok: false; error: LeadFlowHandoffErrorCode };

export type LeadFlowTranscriptResult =
  | { ok: true; duplicate: boolean; eventId: string }
  | { ok: false; error: LeadFlowErrorCode; eventId: string };

type FetchImplementation = typeof fetch;

export interface LeadFlowClientOptions {
  baseUrl?: string | undefined;
  token?: string | undefined;
  fetchImplementation?: FetchImplementation | undefined;
  timeoutMs?: number | undefined;
  maxTransportRetries?: number | undefined;
  createEventId?: (() => string) | undefined;
  now?: (() => Date) | undefined;
}

interface ResolvedLeadFlowClientOptions {
  baseUrl: string | undefined;
  token: string | undefined;
  fetchImplementation: FetchImplementation;
  timeoutMs: number;
  maxTransportRetries: number;
  createEventId: () => string;
  now: () => Date;
}

export const normalizeLeadFlowBaseUrl = (value: string): string => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Unsupported LeadFlow URL protocol");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
};

const errorFromStatus = async (response: Response): Promise<LeadFlowErrorCode> => {
  if (response.status === 401 || response.status === 403) {
    return "authentication_failure";
  }
  if (response.status === 404) return "lead_not_found";
  if (response.status === 400 || response.status === 422) return "invalid_payload";
  if (response.status === 409) return "event_conflict";
  if (response.status >= 500) return "leadflow_unavailable";
  return "provider_error";
};

const handoffErrorFromResponse = async (
  response: Response,
): Promise<LeadFlowHandoffErrorCode> => {
  let errorName = "";
  try {
    const body = (await response.json()) as unknown;
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      errorName = body.error;
    }
  } catch {
    // Status mapping remains sufficient; raw provider bodies are never exposed.
  }
  if (response.status === 410 || errorName.includes("expired")) {
    return "handoff_expired";
  }
  if (
    errorName === "call_task_not_found" ||
    errorName === "call_task_mismatch" ||
    errorName === "call_task_not_ready"
  ) {
    return "task_context_missing";
  }
  if (errorName === "lead_not_found" || response.status === 404) {
    return "lead_not_found";
  }
  if (
    errorName.includes("handoff") ||
    response.status === 400 ||
    response.status === 422
  ) {
    return "handoff_invalid";
  }
  if (response.status === 401 || response.status === 403) {
    return "authentication_failure";
  }
  if (response.status >= 500) return "leadflow_unavailable";
  return "provider_error";
};

export class LeadFlowClient {
  readonly #options: ResolvedLeadFlowClientOptions;

  constructor(options: LeadFlowClientOptions = {}) {
    this.#options = {
      baseUrl: options.baseUrl ?? env.LEADFLOW_BASE_URL,
      token: options.token ?? env.LEADFLOW_INTEGRATION_TOKEN,
      fetchImplementation: options.fetchImplementation ?? fetch,
      timeoutMs: options.timeoutMs ?? 8_000,
      maxTransportRetries: options.maxTransportRetries ?? 1,
      createEventId: options.createEventId ?? randomUUID,
      now: options.now ?? (() => new Date()),
    };
  }

  isConfigured(): boolean {
    return this.configurationStatus().configured;
  }

  configurationStatus(): LeadFlowConfigurationStatus {
    const baseUrlConfigured = Boolean(this.#options.baseUrl);
    const integrationTokenConfigured = Boolean(this.#options.token);
    let leadFlowOrigin: string | undefined;
    if (this.#options.baseUrl) {
      try {
        leadFlowOrigin = new URL(
          normalizeLeadFlowBaseUrl(this.#options.baseUrl),
        ).origin;
      } catch {
        // Presence and validity are intentionally reported separately via configured.
      }
    }
    return {
      configured:
        baseUrlConfigured &&
        integrationTokenConfigured &&
        Boolean(leadFlowOrigin),
      baseUrlConfigured,
      integrationTokenConfigured,
      ...(leadFlowOrigin ? { leadFlowOrigin } : {}),
    };
  }

  async diagnose(): Promise<LeadFlowDiagnosticResult> {
    const configuration = this.configurationStatus();
    if (!configuration.baseUrlConfigured || !configuration.integrationTokenConfigured) {
      return {
        configured: false,
        reachable: false,
        authentication: "not_checked",
        reason: "configuration_missing",
      };
    }

    let baseUrl: string;
    try {
      baseUrl = normalizeLeadFlowBaseUrl(this.#options.baseUrl as string);
    } catch {
      return {
        configured: false,
        reachable: false,
        authentication: "not_checked",
        reason: "invalid_base_url",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#options.timeoutMs);
    try {
      const response = await this.#options.fetchImplementation(
        `${baseUrl}/api/integrations/voice-agent/health`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.#options.token}`,
          },
          signal: controller.signal,
        },
      );
      if (response.status === 401 || response.status === 403) {
        return {
          configured: true,
          reachable: true,
          authentication: "failure",
          reason: "authentication_failure",
        };
      }
      if (response.status === 404 || response.status === 405) {
        return {
          configured: true,
          reachable: true,
          authentication: "not_checked",
          reason: "integration_health_unavailable",
        };
      }
      if (response.status >= 500) {
        return {
          configured: true,
          reachable: false,
          authentication: "not_checked",
          reason: "leadflow_unavailable",
        };
      }
      if (!response.ok) {
        return {
          configured: true,
          reachable: true,
          authentication: "not_checked",
          reason: "provider_error",
        };
      }
      return {
        configured: true,
        reachable: true,
        authentication: "ok",
        reason: "ok",
      };
    } catch {
      return {
        configured: true,
        reachable: false,
        authentication: "not_checked",
        reason: "leadflow_unavailable",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  createPayload(
    leadId: string,
    input: SyncLeadFlowInteractionInput,
    eventId = this.#options.createEventId(),
  ): VoiceAgentInteractionV1 {
    return voiceAgentInteractionV1Schema.parse({
      contractVersion: "1.0",
      eventId,
      source: "vs-ai-voice-agent",
      leadRef: { leadId },
      occurredAt: this.#options.now().toISOString(),
      interaction: {
        channel: "phone/cold call",
        direction: "out",
        summary: input.summary,
        outcome: input.outcome,
      },
      ...(input.nextAction ? { nextAction: input.nextAction } : {}),
      ...(input.followUp ? { followUp: input.followUp } : {}),
      ...(input.calendar ? { calendar: input.calendar } : {}),
      ...(input.lostReason ? { lostReason: input.lostReason } : {}),
    });
  }

  createTranscriptPayload(
    context: {
      leadId: string;
      callTaskId: string;
      conversationId: string;
    },
    input: VoiceAgentTranscriptCheckpointInput,
    eventId = this.#options.createEventId(),
  ): VoiceAgentTranscriptV1 {
    return voiceAgentTranscriptV1Schema.parse({
      contractVersion: "1.0",
      eventId,
      source: "vs-ai-voice-agent",
      leadRef: { leadId: context.leadId },
      callTaskRef: { callTaskId: context.callTaskId },
      conversationId: context.conversationId,
      ...input,
    });
  }

  async resolveHandoff(handoffToken: string): Promise<LeadFlowHandoffResult> {
    if (!this.#options.baseUrl || !this.#options.token) {
      return { ok: false, error: "configuration_missing" };
    }
    let baseUrl: string;
    try {
      baseUrl = normalizeLeadFlowBaseUrl(this.#options.baseUrl);
    } catch {
      return { ok: false, error: "configuration_missing" };
    }
    if (!handoffToken.trim() || handoffToken.length > 8_192) {
      return { ok: false, error: "handoff_invalid" };
    }

    for (let attempt = 0; attempt <= this.#options.maxTransportRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#options.timeoutMs);
      try {
        const response = await this.#options.fetchImplementation(
          `${baseUrl}/api/integrations/voice-agent/resolve-handoff`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${this.#options.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ handoffToken }),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          const error = await handoffErrorFromResponse(response);
          if (error === "leadflow_unavailable" && attempt < this.#options.maxTransportRetries) {
            continue;
          }
          return { ok: false, error };
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return { ok: false, error: "provider_error" };
        }
        const parsed = leadFlowHandoffResponseSchema.safeParse(body);
        return parsed.success
          ? { ok: true, data: parsed.data }
          : { ok: false, error: "provider_error" };
      } catch {
        const timedOut = controller.signal.aborted;
        if (attempt < this.#options.maxTransportRetries) continue;
        return {
          ok: false,
          error: timedOut ? "timeout" : "leadflow_unavailable",
        };
      } finally {
        clearTimeout(timeout);
      }
    }
    return { ok: false, error: "leadflow_unavailable" };
  }

  async send(
    leadId: string,
    input: SyncLeadFlowInteractionInput,
  ): Promise<LeadFlowClientResult> {
    const eventId = this.#options.createEventId();
    if (!this.#options.baseUrl || !this.#options.token) {
      return { ok: false, error: "configuration_missing", eventId };
    }

    let baseUrl: string;
    let payload: VoiceAgentInteractionV1;
    try {
      baseUrl = normalizeLeadFlowBaseUrl(this.#options.baseUrl);
      payload = this.createPayload(leadId, input, eventId);
    } catch {
      return { ok: false, error: "invalid_payload", eventId };
    }

    for (let attempt = 0; attempt <= this.#options.maxTransportRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#options.timeoutMs);
      try {
        const response = await this.#options.fetchImplementation(
          `${baseUrl}/api/integrations/voice-agent/interactions`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${this.#options.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const error = await errorFromStatus(response);
          if (error === "leadflow_unavailable" && attempt < this.#options.maxTransportRetries) {
            continue;
          }
          return { ok: false, error, eventId };
        }

        let responseBody: unknown;
        try {
          responseBody = await response.json();
        } catch {
          return { ok: false, error: "provider_error", eventId };
        }
        const parsed = leadFlowSuccessResponseSchema.safeParse(responseBody);
        if (!parsed.success || parsed.data.leadId !== leadId) {
          return { ok: false, error: "provider_error", eventId };
        }
        return { ok: true, data: parsed.data, eventId };
      } catch (error) {
        const timedOut = controller.signal.aborted;
        if (attempt < this.#options.maxTransportRetries) continue;
        return {
          ok: false,
          error: timedOut ? "timeout" : "leadflow_unavailable",
          eventId,
        };
      } finally {
        clearTimeout(timeout);
      }
    }

    return { ok: false, error: "leadflow_unavailable", eventId };
  }

  async sendTranscript(
    context: {
      leadId: string;
      callTaskId: string;
      conversationId: string;
    },
    input: VoiceAgentTranscriptCheckpointInput,
  ): Promise<LeadFlowTranscriptResult> {
    const eventId = this.#options.createEventId();
    if (!this.#options.baseUrl || !this.#options.token) {
      return { ok: false, error: "configuration_missing", eventId };
    }

    let baseUrl: string;
    let payload: VoiceAgentTranscriptV1;
    try {
      baseUrl = normalizeLeadFlowBaseUrl(this.#options.baseUrl);
      payload = this.createTranscriptPayload(context, input, eventId);
    } catch {
      return { ok: false, error: "invalid_payload", eventId };
    }

    for (let attempt = 0; attempt <= this.#options.maxTransportRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#options.timeoutMs);
      try {
        const response = await this.#options.fetchImplementation(
          `${baseUrl}/api/integrations/voice-agent/call-transcript`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${this.#options.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          const error = await errorFromStatus(response);
          if (error === "leadflow_unavailable" && attempt < this.#options.maxTransportRetries) {
            continue;
          }
          return { ok: false, error, eventId };
        }
        if (response.status === 204) {
          return { ok: true, duplicate: false, eventId };
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return { ok: false, error: "provider_error", eventId };
        }
        const parsed = leadFlowTranscriptSuccessResponseSchema.safeParse(body);
        return parsed.success
          ? { ok: true, duplicate: parsed.data.duplicate ?? false, eventId }
          : { ok: false, error: "provider_error", eventId };
      } catch {
        const timedOut = controller.signal.aborted;
        if (attempt < this.#options.maxTransportRetries) continue;
        return {
          ok: false,
          error: timedOut ? "timeout" : "leadflow_unavailable",
          eventId,
        };
      } finally {
        clearTimeout(timeout);
      }
    }
    return { ok: false, error: "leadflow_unavailable", eventId };
  }
}

let leadFlowClient: LeadFlowClient | undefined;

export const getLeadFlowClient = (): LeadFlowClient => {
  leadFlowClient ??= new LeadFlowClient();
  return leadFlowClient;
};
