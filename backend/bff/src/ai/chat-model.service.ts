import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  buildDeterministicReply,
  ChatMessage,
  getCandidatePriceOptions,
  GuideReply,
  ProductCandidate,
  SearchIntent,
} from "@smartbuy/ai";
import { AppEnv } from "../config/env";
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
        const parsed = JSON.parse(jsonMatch[0]) as GuideReply;
        parsed.reply = stripMarkdown(parsed.reply);
        return parsed;
      } catch { /* fall through to text reply */ }
    }
    return { reply: stripMarkdown(content), productIds: [] };
  }
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1");
}
