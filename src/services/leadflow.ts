import { randomUUID } from "node:crypto";

import {
  leadFlowSuccessResponseSchema,
  voiceAgentInteractionV1Schema,
  type LeadFlowSuccessResponse,
  type SyncLeadFlowInteractionInput,
  type VoiceAgentInteractionV1,
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

export type LeadFlowClientResult =
  | { ok: true; data: LeadFlowSuccessResponse; eventId: string }
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
    return Boolean(this.#options.baseUrl && this.#options.token);
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
}

let leadFlowClient: LeadFlowClient | undefined;

export const getLeadFlowClient = (): LeadFlowClient => {
  leadFlowClient ??= new LeadFlowClient();
  return leadFlowClient;
};
