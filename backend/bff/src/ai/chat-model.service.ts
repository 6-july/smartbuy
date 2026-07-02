import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { AppEnv } from "../config/env";

export interface PlainModelLatencyRound {
  index: number;
  latencyMs: number;
  status: number;
  content?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  error?: string;
}

export interface PlainModelLatencyResult {
  model: string;
  thinkingEnabled?: boolean;
  prompt: string;
  rounds: number;
  averageLatencyMs: number | null;
  successAverageLatencyMs: number | null;
  results: PlainModelLatencyRound[];
}

@Injectable()
export class ChatModelService {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get("aiChatApiUrl", { infer: true }) &&
      this.config.get("aiChatApiKey", { infer: true }) &&
      this.config.get("aiChatModel", { infer: true }),
    );
  }

  async invokeAgentTurn(
    messages: BaseMessage[],
    tools: OpenAiToolDefinition[],
    options: { toolChoice?: OpenAiToolChoice } = {},
  ): Promise<AIMessage> {
    const apiUrl = this.config.get("aiChatApiUrl", { infer: true });
    const apiKey = this.config.get("aiChatApiKey", { infer: true });
    const model = this.config.get("aiChatModel", { infer: true });
    const thinkingEnabled = this.config.get("aiChatThinkingEnabled", { infer: true });
    if (!apiUrl || !apiKey || !model) {
      throw new Error("AI chat model is not configured");
    }

    const requestMessages = messages.map(toOpenAiMessage);
    const requestBody = {
      model,
      temperature: 0.2,
      messages: requestMessages,
      tools,
      tool_choice: options.toolChoice ?? "auto",
      ...(thinkingEnabled === undefined
        ? {}
        : { thinking: { type: thinkingEnabled ? "enabled" : "disabled" } }),
    };
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Chat API returned ${response.status}: ${errText}`);
    }
    const body = (await response.json()) as OpenAiChatCompletion;
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error("Chat API returned empty message");
    return toAiMessage(message);
  }

  async probePlainModelLatency(input: {
    prompt?: string;
    rounds?: number;
  }): Promise<PlainModelLatencyResult> {
    const apiUrl = this.config.get("aiChatApiUrl", { infer: true });
    const apiKey = this.config.get("aiChatApiKey", { infer: true });
    const model = this.config.get("aiChatModel", { infer: true });
    const thinkingEnabled = this.config.get("aiChatThinkingEnabled", { infer: true });
    if (!apiUrl || !apiKey || !model) {
      throw new Error("AI chat model is not configured");
    }

    const prompt = input.prompt?.trim() || "你好，只回复“收到”两个字。";
    const rounds = Math.min(Math.max(input.rounds ?? 1, 1), 10);
    const results: PlainModelLatencyRound[] = [];
    for (let index = 1; index <= rounds; index += 1) {
      const startedAt = Date.now();
      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            messages: [{ role: "user", content: prompt }],
            ...(thinkingEnabled === undefined
              ? {}
              : { thinking: { type: thinkingEnabled ? "enabled" : "disabled" } }),
          }),
          signal: AbortSignal.timeout(30_000),
        });
        const latencyMs = Date.now() - startedAt;
        const text = await response.text();
        const body = parseChatCompletion(text);
        const message = body?.choices?.[0]?.message;
        results.push({
          index,
          latencyMs,
          status: response.status,
          content: message?.content || undefined,
          promptTokens: body?.usage?.prompt_tokens,
          completionTokens: body?.usage?.completion_tokens,
          totalTokens: body?.usage?.total_tokens,
          reasoningTokens: body?.usage?.completion_tokens_details?.reasoning_tokens,
          ...(response.ok ? {} : { error: formatErrorBody(text) }),
        });
      } catch (error) {
        results.push({
          index,
          latencyMs: Date.now() - startedAt,
          status: 0,
          error: error instanceof Error ? error.message : "模型请求失败",
        });
      }
    }

    const allLatencies = results.map((result) => result.latencyMs);
    const successLatencies = results
      .filter((result) => result.status >= 200 && result.status < 300)
      .map((result) => result.latencyMs);
    return {
      model,
      thinkingEnabled,
      prompt,
      rounds,
      averageLatencyMs: average(allLatencies),
      successAverageLatencyMs: average(successLatencies),
      results,
    };
  }
}

interface OpenAiToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

type OpenAiToolChoice =
  | "auto"
  | {
      type: "function";
      function: {
        name: string;
      };
    };

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAiChatCompletion {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  } & Record<string, unknown>;
}

type OpenAiRequestMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

function toOpenAiMessage(message: BaseMessage): OpenAiRequestMessage {
  if (SystemMessage.isInstance(message)) {
    return { role: "system", content: stringifyContent(message.content) };
  }
  if (HumanMessage.isInstance(message)) {
    return { role: "user", content: stringifyContent(message.content) };
  }
  if (ToolMessage.isInstance(message)) {
    return {
      role: "tool",
      tool_call_id: message.tool_call_id,
      content: stringifyContent(message.content),
    };
  }
  if (AIMessage.isInstance(message)) {
    const toolCalls = message.tool_calls?.map((call) => ({
      id: call.id || `${call.name}-${Date.now()}`,
      type: "function" as const,
      function: {
        name: call.name,
        arguments: JSON.stringify(call.args || {}),
      },
    }));
    return {
      role: "assistant",
      content: stringifyContent(message.content) || null,
      ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
    };
  }
  return { role: "user", content: stringifyContent(message.content) };
}

function toAiMessage(message: NonNullable<OpenAiChatCompletion["choices"]>[number]["message"]): AIMessage {
  const toolCalls = message?.tool_calls?.map((call) => ({
    id: call.id,
    name: call.function.name,
    args: parseToolArguments(call.function.arguments),
    type: "tool_call" as const,
  }));
  return new AIMessage({
    content: message?.content || "",
    tool_calls: toolCalls,
    additional_kwargs: message?.tool_calls ? { tool_calls: message.tool_calls } : {},
  });
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return typeof parsed === "object" && parsed !== null
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseChatCompletion(raw: string): OpenAiChatCompletion | undefined {
  try {
    return JSON.parse(raw) as OpenAiChatCompletion;
  } catch {
    return undefined;
  }
}

function formatErrorBody(raw: string): string {
  const parsed = parseChatCompletion(raw) as unknown;
  if (
    parsed &&
    typeof parsed === "object" &&
    "error" in parsed &&
    parsed.error &&
    typeof parsed.error === "object" &&
    "message" in parsed.error &&
    typeof parsed.error.message === "string"
  ) {
    return parsed.error.message;
  }
  return raw.slice(0, 500);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function stringifyContent(content: BaseMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if ("text" in block && typeof block.text === "string") return block.text;
      return "";
    })
    .join("");
}
