import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { CallbackHandler } from "@langfuse/langchain";
import {
  propagateAttributes,
  startActiveObservation,
  type LangfuseGeneration,
  type LangfuseSpan,
  type LangfuseTool,
} from "@langfuse/tracing";

export { propagateAttributes, startActiveObservation };
export type { LangfuseGeneration, LangfuseSpan, LangfuseTool };

const MAX_OBSERVATION_TEXT_LENGTH = 2_000;

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

export function trimObservationText(value: string, maxLength = MAX_OBSERVATION_TEXT_LENGTH): string {
  const normalized = value.trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

export function compactError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorObservation(error: unknown): {
  level: "ERROR";
  statusMessage: string;
} {
  return {
    level: "ERROR",
    statusMessage: compactError(error),
  };
}

function hasLangfuseKeys(): boolean {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY?.trim() &&
    process.env.LANGFUSE_SECRET_KEY?.trim(),
  );
}
