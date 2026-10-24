import type { realtimeVoices } from "../config/env.js";

// Типи цього модуля є спільною межею між конфігурацією середовища,
// realtime-сеансом і UI. Вони не виконують запитів і не мають побічних ефектів.
// RealtimeVoice виводиться з дозволеного списку, тому конфіг не прийме довільне ім'я.
export type RealtimeVoice = (typeof realtimeVoices)[number];

export const voiceLabVoices = ["shimmer", "coral", "marin"] as const;

// VoiceLabVoice звужує загальний список до голосів, доступних у Voice Lab.
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

// SalesConversationState описує етап вихідної розмови для UI та оркестратора.
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

// SalesConversationOutcome фіксує контрольований підсумок завершеної розмови.
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
