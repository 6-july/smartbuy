import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  buildDeterministicReply,
  ChatMessage,
  GuideReply,
  ProductCandidate,
} from "@smartbuy/ai";
import { AppEnv } from "../config/env";

@Injectable()
export class ChatModelService {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  async reply(
    merchant: { name: string; description: string | null },
    question: string,
    history: ChatMessage[],
    candidates: ProductCandidate[],
  ): Promise<GuideReply> {
    const apiUrl = this.config.get("aiChatApiUrl", { infer: true });
    const apiKey = this.config.get("aiChatApiKey", { infer: true });
    const model = this.config.get("aiChatModel", { infer: true });
    if (!apiUrl || !apiKey || !model) return buildDeterministicReply(candidates);

    const system = [
      `你是${merchant.name}的智能导购。`,
      merchant.description || "",
      "只能从候选商品中推荐，不能编造商品、价格、规格、库存或跳转信息。",
      "返回严格 JSON：{\"reply\":\"文本\",\"productIds\":[\"候选ID\"]}。",
      `候选商品：${JSON.stringify(candidates)}`,
    ]
      .filter(Boolean)
      .join("\n");
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          ...history,
          { role: "user", content: question },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Chat API returned ${response.status}`);
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("Chat API returned empty content");
    return JSON.parse(content.replace(/^```json\s*|\s*```$/g, "")) as GuideReply;
  }
}
