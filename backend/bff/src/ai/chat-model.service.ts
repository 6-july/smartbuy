import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppEnv } from "../config/env";
import {
  buildDeterministicReply,
  ChatMessage,
  getCandidatePriceOptions,
  GuideReply,
  ProductCandidate,
  SearchIntent,
} from "./domain";
import { buildSystemPrompt } from "./prompt-template";

@Injectable()
export class ChatModelService {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  async reply(
    merchant: { name: string; description: string | null; phone?: string | null; industry?: string },
    question: string,
    history: ChatMessage[],
    candidates: ProductCandidate[],
    totalProducts = 0,
    intent?: SearchIntent,
    categories: string[] = [],
  ): Promise<GuideReply> {
    const apiUrl = this.config.get("aiChatApiUrl", { infer: true });
    const apiKey = this.config.get("aiChatApiKey", { infer: true });
    const model = this.config.get("aiChatModel", { infer: true });
    if (!apiUrl || !apiKey || !model) return buildDeterministicReply(candidates, intent);

    const system = buildSystemPrompt({
      merchantName: merchant.name,
      industry: merchant.industry || "综合零售",
      description: merchant.description || "",
      phone: merchant.phone ?? null,
      totalProducts,
      categories,
      hasCandidates: candidates.length > 0,
      candidatesJson: JSON.stringify(
        candidates.map((c) => ({
          id: c.id,
          title: c.title,
          price: c.displayPrice,
          minPrice: c.minPrice,
          maxPrice: c.maxPrice,
          category: c.category,
          description: c.description,
          tags: c.tags,
          details: trimPromptText(c.aiText),
          priceOptions: getCandidatePriceOptions(c),
        })),
      ),
    });

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: "system", content: system },
          ...history.slice(-6),
          { role: "user", content: question },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Chat API returned ${response.status}: ${errText}`);
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content?.trim();
    if (!content) {
      console.warn("[ChatModel] empty content, full body:", JSON.stringify(body));
      throw new Error("Chat API returned empty content");
    }
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = normalizeGuideReply(JSON.parse(jsonMatch[0]));
        if (parsed) return parsed;
      } catch { /* fall through to text reply */ }
    }
    return { reply: stripMarkdown(content), productIds: [] };
  }
}

function trimPromptText(value: string, maxLength = 1500): string {
  const normalized = value.trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength)}...`;
}

export function normalizeGuideReply(value: unknown): GuideReply | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.reply !== "string" || !record.reply.trim()) return null;
  const productIds = Array.isArray(record.productIds)
    ? record.productIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  return {
    reply: stripMarkdown(record.reply),
    productIds: [...new Set(productIds)],
  };
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1");
}
