import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";

const quotaErrorCodes = new Set([
  "billing_hard_limit_reached",
  "insufficient_quota",
]);

const reportFailure = (error: unknown): void => {
  if (error instanceof Error && error.message.includes("OPENAI_API_KEY")) {
    console.error("OpenAI connectivity check failed: OPENAI_API_KEY is missing.");
    return;
  }

  if (error instanceof AuthenticationError) {
    console.error(
      "OpenAI connectivity check failed: authentication was rejected. Check OPENAI_API_KEY.",
    );
    return;
  }

  if (error instanceof RateLimitError) {
    const message = quotaErrorCodes.has(error.code ?? "")
      ? "OpenAI connectivity check failed: API billing or quota is unavailable."
      : "OpenAI connectivity check failed: the API rate limit was reached.";
    console.error(message);
    return;
  }

  if (error instanceof NotFoundError) {
    console.error(
      "OpenAI connectivity check failed: the requested OpenAI API resource was not found.",
    );
    return;
  }

  if (error instanceof PermissionDeniedError) {
    console.error(
      "OpenAI connectivity check failed: the API key lacks permission for this project or model.",
    );
    return;
  }

  if (error instanceof APIConnectionError) {
    console.error(
      "OpenAI connectivity check failed: unable to reach the OpenAI API.",
    );
    return;
  }

  if (error instanceof APIError) {
    console.error(
      `OpenAI connectivity check failed: the API returned status ${error.status ?? "unknown"}.`,
    );
    return;
  }

  console.error("OpenAI connectivity check failed: unexpected local error.");
};

const checkOpenAI = async (): Promise<void> => {
  try {
    const { openAIClient } = await import("../services/openai.js");

    await openAIClient.models.list();

    console.log(
      "OpenAI API connectivity verified. Environment loaded, SDK initialized, and authentication succeeded.",
    );
  } catch (error: unknown) {
    reportFailure(error);
    process.exitCode = 1;
  }
};

await checkOpenAI();
