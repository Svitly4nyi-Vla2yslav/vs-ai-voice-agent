import type { realtimeVoices } from "../config/env.js";

export type RealtimeVoice = (typeof realtimeVoices)[number];

export const voiceLabVoices = ["shimmer", "coral", "marin"] as const;

export type VoiceLabVoice = (typeof voiceLabVoices)[number];

// INBOUND_RECEPTION can be added here in a later phase without changing how
// authenticated session context selects and supplies a conversation mode.
export const OUTBOUND_SALES_CONVERSATION_MODE = "OUTBOUND_SALES" as const;
export const conversationModes = [OUTBOUND_SALES_CONVERSATION_MODE] as const;

export type ConversationMode = (typeof conversationModes)[number];

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

export interface LiveAgentConfiguration {
  model: "gpt-live-1";
  instructions: string;
  backendModel: string;
}
