import { Injectable } from "@nestjs/common";
import { ChatMessage, parseSearchIntent, sanitizeGuideReply } from "@smartbuy/ai";
import { ChatModelService } from "./chat-model.service";
import { RetrievalService, RetrievedProduct } from "./retrieval.service";

@Injectable()
export class AiOrchestratorService {
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly chat: ChatModelService,
  ) {}

  async guide(input: {
    merchant: { id: string; name: string; description: string | null };
    question: string;
    history: ChatMessage[];
  }): Promise<{ reply: string; products: RetrievedProduct[] }> {
    const intent = parseSearchIntent(input.question);
    const retrieved = await this.retrieval.search(input.merchant.id, intent);
    const candidates = retrieved.map((item) => item.candidate);
    if (candidates.length === 0) {
      return {
        reply: "暂时没有找到相关商品，你可以换个关键词试试。",
        products: [],
      };
    }
    let rawReply;
    try {
      rawReply = await this.chat.reply(
        input.merchant,
        input.question,
        input.history,
        candidates,
      );
    } catch {
      rawReply = {
        reply:
          candidates.length > 0
            ? "找到了一些比较匹配的商品，你可以看看："
            : "导购助手暂时开小差了，请稍后再试。",
        productIds: candidates.slice(0, 3).map((item) => item.id),
      };
    }
    const reply = sanitizeGuideReply(rawReply, candidates);
    const selected = new Set(reply.productIds);
    return {
      reply: reply.reply,
      products: retrieved.filter((item) => selected.has(item.row.id)),
    };
  }
}
