import { Injectable } from "@nestjs/common";
import {
  buildDeterministicReply,
  ChatMessage,
  parseSearchIntent,
  sanitizeGuideReply,
} from "@smartbuy/ai";
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
    const [retrieved, totalProducts] = await Promise.all([
      this.retrieval.search(input.merchant.id, intent),
      this.retrieval.countProducts(input.merchant.id),
    ]);
    const candidates = retrieved.map((item) => item.candidate);
    let rawReply;
    try {
      rawReply = await this.chat.reply(
        input.merchant,
        input.question,
        input.history,
        candidates,
        totalProducts,
        intent,
      );
    } catch (err) {
      console.error("[AiOrchestrator] chat.reply failed:", err);
      rawReply = buildDeterministicReply(candidates, intent);
    }
    const reply = sanitizeGuideReply(rawReply, candidates);
    const selected = new Set(reply.productIds);
    const selectedCandidates = candidates.filter((candidate) => selected.has(candidate.id));
    const finalReply = isGenericReply(reply.reply) && selectedCandidates.length > 0
      ? buildDeterministicReply(selectedCandidates, intent).reply
      : reply.reply;
    return {
      reply: finalReply,
      products: retrieved.filter((item) => selected.has(item.row.id)),
    };
  }
}

function isGenericReply(reply: string): boolean {
  const normalized = reply.replace(/\s/g, "");
  return (
    normalized.length <= 28 ||
    /找到.*匹配.*商品/.test(normalized) ||
    /可以看看/.test(normalized) ||
    /下面这些商品/.test(normalized)
  );
}
