import type { realtimeVoices } from "../config/env.js";

export type RealtimeVoice = (typeof realtimeVoices)[number];

export const salesConversationStates = [
  "OPENING",
  "DISCOVERY",
  "NEED_IDENTIFIED",
  "OBJECTION",
  "NEXT_STEP",
  "CLOSING",
] as const;

export type SalesConversationState =
  (typeof salesConversationStates)[number];

export const salesConversationOutcomes = [
  "BOOK_MEETING",
  "CALLBACK_REQUESTED",
  "SEND_INFORMATION",
  "HUMAN_HANDOFF",
  "NOT_INTERESTED",
  "DO_NOT_CONTACT",
] as const;

export type SalesConversationOutcome =
  (typeof salesConversationOutcomes)[number];

export interface VoiceAgentConfiguration {
  model: string;
  voice: RealtimeVoice;
  instructions: string;
}
