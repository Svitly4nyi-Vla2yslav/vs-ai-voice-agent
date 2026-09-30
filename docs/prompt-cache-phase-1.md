# Prompt Cache Optimization — Phase 1

## Current architecture

`gpt-live-1` owns speech, conversational behavior, interruption handling, disclosure, and delegation. Managed Responses delegation uses `OPENAI_AGENT_MODEL` for backend reasoning and tool selection. The application executes the registered functions and returns verified results to the delegated response.

Prompt content is classified as follows:

- **Global/stable:** Emma's backend role, security and privacy boundaries, LeadFlow writeback rules, Calendar policy, outcome truth conditions, tool-use policy, reasoning/text settings, and canonical tool definitions.
- **Session-stable:** selected Live voice/model, selected backend model, authenticated conversation mode, and verified LeadFlow context for one call.
- **Customer-specific:** company, contact person, sanitized Call Brief, call objective, Emma Focus, offer focus, and other CRM business data.
- **Turn-specific:** the Live-managed conversation, the current delegated request, corrections, function calls, and verified tool results.

The backend prompt is composed only as:

```text
STATIC_BACKEND_INSTRUCTIONS
+ deterministic delegation.responses.tools
+ SESSION-/KUNDENSPEZIFISCHER KONTEXT
+ Live-managed conversation
```

`STATIC_BACKEND_INSTRUCTIONS` is an exported, deterministic string. `composeBackendInstructions` is the only composition boundary used by the Live route. Verified LeadFlow data is appended after the named boundary and remains explicitly marked as untrusted business data. It never contains LeadFlow IDs or CallTask IDs.

Tool definitions are created once at module initialization, sorted by an explicit tool order, recursively canonicalized by JSON object key, and frozen against runtime mutation. Arrays with semantic order, such as `required` and `enum`, retain their authored order.

## Managed caching and telemetry

Phase 1 uses stable prefixes and managed/implicit prompt caching. A nested delegated `response.completed` event may contain:

- `usage.input_tokens`
- `usage.input_tokens_details.cached_tokens`
- `usage.input_tokens_details.cache_write_tokens`

The browser relays only these non-negative counts to a same-origin backend endpoint. The backend logs only the safe fields and computes `hitRate = cachedTokens / inputTokens` when `inputTokens > 0`. Missing fields remain missing; no counts are inferred. Hit rate is a reuse measure, not a direct savings claim, because cache writes and reads have different pricing.

The operator-only Voice Quality Lab shows `Backend cache: N% reused` after usable completion data arrives, or `No usage data yet`. Nothing is added to the spoken conversation.

## Explicit cache-control support boundary

The installed `openai` SDK's Live `ResponsesDelegationConfig` supports the backend model, instructions, tools, tool choice, parallel tool calls, output limit, service tier, reasoning, and text settings. It does **not** expose standalone Responses fields such as `prompt_cache_options` or content `prompt_cache_breakpoint`. No unsupported field is cast into the managed delegation configuration.

**Explicit GPT-6 cache breakpoints require a future client-delegation/direct Responses implementation.** This matches the official guidance that Live managed Responses delegation supports a subset of standalone Responses settings: [Delegation and tools in GPT-Live](https://developers.openai.com/api/docs/guides/live-delegation). Direct Responses caching controls are documented in [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

## Manual backend-model A/B checklist

Run the same representative, consented test set first with:

```dotenv
OPENAI_AGENT_MODEL=gpt-5.4-mini
```

Then restart with:

```dotenv
OPENAI_AGENT_MODEL=gpt-6-luna
```

Use identical scenarios and starting state:

1. Website lead discovery
2. Objection handling
3. Calendar availability
4. Confirmed Google Meet
5. Callback request
6. Hard stop / do-not-contact
7. LeadFlow writeback

For each scenario record success, exact tool selection/arguments, end-to-end and delegated latency, `inputTokens`, `cachedTokens`, `cacheWriteTokens`, booking reliability, and LeadFlow reliability. Use repeated runs to distinguish cold cache writes from reuse. Do not choose production solely by price; confirmation safety, tool correctness, latency, and integration reliability remain gating criteria.

`OPENAI_AGENT_MODEL` remains environment-configurable and defaults to the baseline. `npm run check:prompt-cache` validates both recommended identifiers without calling OpenAI. `npm run check:openai` continues to validate the configured environment and OpenAI connectivity.

## Phase 2: possible client delegation

The future architecture is documentation-only in this phase:

```text
GPT-Live
→ client delegation
→ our backend
→ direct Responses API
→ gpt-6-luna / gpt-6-sol
```

The application would then own transcript/task context, request construction, backend connections, tool continuation, result validation, and the updates returned to GPT-Live. That direct request path can use `prompt_cache_options`, `prompt_cache_breakpoint`, and `comparison_response_id` when supported by the selected model/API.

For GPT-5.6+ / GPT-6 direct Responses diagnostics, retain the prior response ID and request:

```ts
prompt_cache_options: {
  comparison_response_id: previousResponseId,
}
```

Read `prompt_cache_diagnostics` on the next response (or the streamed `response.completed` event). Misses can identify `model_changed`, `tools_changed`, or `input_changed`; configuration changes may be reported with a setting-specific reason such as reasoning effort, verbosity, text format, service tier, or cache key changes. Treat `settings_changed` as the general diagnostic category rather than assuming every SDK/API version emits that exact string. Diagnostics compare cache-sensitive configuration only; they do not restore conversation state or change caching behavior. See [Prompt cache diagnostics](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics).

Before Phase 2, add server-owned conversation history, idempotent delegation correlation, direct Responses streaming/tool continuation, result filtering, retry/failure handling, and eval coverage proving parity with the current managed delegation behavior.
