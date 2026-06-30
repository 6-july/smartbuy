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

@Injectable()
export class ChatModelService {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  async reply(
    merchant: { name: string; description: string | null },
    question: string,
    history: ChatMessage[],
    candidates: ProductCandidate[],
    totalProducts = 0,
    intent?: SearchIntent,
  ): Promise<GuideReply> {
    const apiUrl = this.config.get("aiChatApiUrl", { infer: true });
    const apiKey = this.config.get("aiChatApiKey", { infer: true });
    const model = this.config.get("aiChatModel", { infer: true });
    if (!apiUrl || !apiKey || !model) return buildDeterministicReply(candidates, intent);

    const systemParts = [
      `你是「${merchant.name}」的智能导购助手，热情、专业、简洁。`,
      merchant.description || "",
      totalProducts > 0 ? `店铺共有 ${totalProducts} 款商品在售。` : "",
      candidates.length > 0
        ? [
            "下面是根据用户需求检索到的候选商品，严格只能提及和推荐下面列表中的商品，不要提及之前对话中出现过但不在当前候选列表中的商品。不能编造商品、价格、规格、库存或跳转信息。",
            `候选商品：${JSON.stringify(candidates.map((c) => ({ id: c.id, title: c.title, price: c.displayPrice, minPrice: c.minPrice, maxPrice: c.maxPrice, category: c.category, priceOptions: getCandidatePriceOptions(c) })))}`,
          ].join("\n")
        : "当前没有检索到候选商品。如果用户在闲聊或打招呼，请友好回应并引导用户描述想要的商品类型、口味或预算。如果用户在找具体商品但没有匹配结果，请告知暂无相关商品并建议换个关键词或浏览热门推荐。",
      "如果用户提到预算、价格上限或价格区间，回复必须明确指出候选商品里哪些具体规格/尺寸符合预算；不要只说「找到了一些商品」或只展示价格区间。",
      "如果商品有多个规格价，优先推荐符合预算的规格，例如「4寸 ¥128、5寸 ¥188」，超出预算的规格不要作为符合预算推荐。",
      "当用户询问最贵、最便宜或价格排序时，除了推荐商品外，还要追问用户的具体需求（如口味偏好、用途场景、食用人数等），帮助他们选到更合适的，而不是简单罗列价格。",
      "严格禁止编造任何不在候选商品数据中的信息，包括但不限于：配送范围、配送时间、原料成分、过敏原、保质期、库存数量、营业时间、门店地址。遇到此类问题请回答「这个我不太确定，建议您直接联系店铺客服确认哦」。",
      "回复要自然、拟人、有温度，像真人店员一样对话，避免机械罗列。适当使用语气词（呢、哦、呀）和表情，但不要过度。",
      "返回严格 JSON：{\"reply\":\"文本\",\"productIds\":[\"候选ID\"]}。productIds 为空数组时也必须返回。",
    ];
    const system = systemParts.filter(Boolean).join("\n");
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
        return JSON.parse(jsonMatch[0]) as GuideReply;
      } catch { /* fall through to text reply */ }
    }
    return { reply: content, productIds: [] };
  }
}
