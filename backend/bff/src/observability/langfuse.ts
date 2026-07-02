import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { CallbackHandler } from "@langfuse/langchain";

export interface LangfuseCallbackOptions {
  userId?: string;
  sessionId?: string;
  tags?: string[];
  version?: string;
  traceMetadata?: Record<string, unknown>;
}

export function createLangfuseCallbacks(
  options: LangfuseCallbackOptions = {},
): BaseCallbackHandler[] | undefined {
  if (!hasLangfuseKeys()) return undefined;
  return [new CallbackHandler(options)];
}

function hasLangfuseKeys(): boolean {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY?.trim() &&
    process.env.LANGFUSE_SECRET_KEY?.trim(),
  );
}
