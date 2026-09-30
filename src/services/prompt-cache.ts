export type PromptCacheUsage = {
  inputTokens?: number | undefined;
  cachedTokens?: number | undefined;
  cacheWriteTokens?: number | undefined;
};

export type PromptCacheTelemetry = PromptCacheUsage & {
  hitRate?: number;
};

export const cacheHitRate = (
  inputTokens: number | undefined,
  cachedTokens: number | undefined,
): number | undefined =>
  typeof inputTokens === "number" &&
  inputTokens > 0 &&
  typeof cachedTokens === "number"
    ? cachedTokens / inputTokens
    : undefined;

export const promptCacheTelemetry = (
  usage: PromptCacheUsage,
): PromptCacheTelemetry => {
  const hitRate = cacheHitRate(usage.inputTokens, usage.cachedTokens);
  return {
    ...(usage.inputTokens !== undefined
      ? { inputTokens: usage.inputTokens }
      : {}),
    ...(usage.cachedTokens !== undefined
      ? { cachedTokens: usage.cachedTokens }
      : {}),
    ...(usage.cacheWriteTokens !== undefined
      ? { cacheWriteTokens: usage.cacheWriteTokens }
      : {}),
    ...(hitRate !== undefined ? { hitRate } : {}),
  };
};

export const logPromptCacheTelemetry = (usage: PromptCacheUsage): void => {
  console.info("[Prompt Cache]", promptCacheTelemetry(usage));
};
